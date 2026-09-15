"use client";

import { useCallback, useRef, useState } from "react";
import type { RefObject } from "react";
import type { CosmeticAttachmentSceneHandle } from "./CosmeticAttachmentScene";
import { getCosmeticDefinition, type CosmeticTransform } from "./cosmeticRegistry";

type CosmeticHistoryEntry =
  | { kind: "transform"; before: CosmeticTransform; after: CosmeticTransform }
  | {
      kind: "equip";
      beforeId: string | null;
      beforeTransform: CosmeticTransform | null;
      afterId: string | null;
      afterTransform: CosmeticTransform | null;
    };

const MAX_COSMETIC_HISTORY = 30;

export interface UseCosmeticEditorOptions {
  attachmentRef: RefObject<CosmeticAttachmentSceneHandle>;
  markDirty: () => void;
}

/**
 * Equip state + a small DEDICATED undo/redo stack for cosmetic-level
 * actions (equip/unequip/transform change - section 9) - deliberately
 * separate from LayerStackEngine's own per-surface pixel undo stack (Paint
 * sub-mode's Ctrl+Z still goes through the EXISTING per-material engine,
 * completely unchanged - see CosmeticPaintScene.tsx), since transform TRS
 * data and canvas pixel history are structurally different things. The UX
 * (discrete steps, one entry per user action) matches the rest of the app;
 * the underlying stack is its own, matching this codebase's existing
 * "each concern gets its own small, dedicated piece of state" convention
 * (see useAvatarMorphs.ts).
 *
 * A single whole TransformControls drag is ONE undo entry (section 9's
 * "mouse down -> 여러 transform 변화 -> mouse up 전체를 Undo 1회로") -
 * `commitTransformChange` is called exactly once, on drag release, by
 * CosmeticTransformControls; nothing is pushed while dragging.
 */
export function useCosmeticEditor({ attachmentRef, markDirty }: UseCosmeticEditorOptions) {
  const [equippedId, setEquippedIdState] = useState<string | null>(null);
  // `undoStack`/`redoStack` are refs (not state) since their CONTENTS never
  // need to drive a diff - but a UI (undo/redo button disabled state) DOES
  // need to know when they go from empty<->non-empty, so `historyStatus`
  // is the one piece of actual React state, explicitly re-synced after
  // every push/pop below (mirrors LayerStackEngine's own separate
  // onHistoryChange callback for the exact same reason).
  const undoStack = useRef<CosmeticHistoryEntry[]>([]);
  const redoStack = useRef<CosmeticHistoryEntry[]>([]);
  const [historyStatus, setHistoryStatus] = useState({ canUndo: false, canRedo: false });
  const syncHistoryStatus = useCallback(() => {
    setHistoryStatus({ canUndo: undoStack.current.length > 0, canRedo: redoStack.current.length > 0 });
  }, []);
  /** Set by undo/redo when restoring an "equip" entry - the newly-attached
   * cosmetic's AttachmentRoot doesn't exist synchronously (GLB load is
   * async), so the transform restore is deferred until
   * `onAttachmentSettled` (wired to CosmeticAttachmentScene's
   * onAttachmentChange) fires next. */
  const pendingTransformRef = useRef<CosmeticTransform | null>(null);

  const clearCosmeticHistory = useCallback(() => {
    undoStack.current = [];
    redoStack.current = [];
    pendingTransformRef.current = null;
    syncHistoryStatus();
  }, [syncHistoryStatus]);

  const pushHistory = useCallback(
    (entry: CosmeticHistoryEntry) => {
      undoStack.current.push(entry);
      if (undoStack.current.length > MAX_COSMETIC_HISTORY) undoStack.current.shift();
      redoStack.current = [];
      syncHistoryStatus();
    },
    [syncHistoryStatus]
  );

  const equip = useCallback(
    (nextId: string | null) => {
      if (nextId === equippedId) return;
      const beforeTransform = attachmentRef.current?.getTransform() ?? null;
      const afterTransform = nextId ? getCosmeticDefinition(nextId)?.defaultTransform ?? null : null;
      pushHistory({ kind: "equip", beforeId: equippedId, beforeTransform, afterId: nextId, afterTransform });
      setEquippedIdState(nextId);
      markDirty();
    },
    [equippedId, attachmentRef, pushHistory, markDirty]
  );

  /** Loads a saved character's equipped cosmetic without touching history
   * (section 16 - character switch, not a user edit). `transform`, when
   * given, is the character's own saved AttachmentRoot TRS - applied once
   * the newly-attached cosmetic settles via the same `pendingTransformRef`/
   * `onAttachmentSettled` mechanism undo/redo already uses, since attach is
   * async and the AttachmentRoot doesn't exist synchronously here either. */
  const setEquippedFromPreset = useCallback(
    (id: string | null, transform?: CosmeticTransform | null) => {
      pendingTransformRef.current = transform ?? null;
      setEquippedIdState(id);
    },
    []
  );

  const commitTransformChange = useCallback(
    (before: CosmeticTransform, after: CosmeticTransform) => {
      pushHistory({ kind: "transform", before, after });
      markDirty();
    },
    [pushHistory, markDirty]
  );

  const resetTransform = useCallback(() => {
    if (!equippedId) return;
    const definition = getCosmeticDefinition(equippedId);
    const before = attachmentRef.current?.getTransform();
    if (!definition || !before) return;
    attachmentRef.current?.setTransform(definition.defaultTransform);
    pushHistory({ kind: "transform", before, after: definition.defaultTransform });
    markDirty();
  }, [equippedId, attachmentRef, pushHistory, markDirty]);

  /** Called once the CURRENTLY-equipped cosmetic's attachment has actually
   * settled (new meshes ready) - applies any transform an equip undo/redo
   * left pending, since it couldn't be applied synchronously. */
  const onAttachmentSettled = useCallback(() => {
    const pending = pendingTransformRef.current;
    if (pending) {
      pendingTransformRef.current = null;
      attachmentRef.current?.setTransform(pending);
    }
  }, [attachmentRef]);

  const undo = useCallback(() => {
    const entry = undoStack.current.pop();
    if (!entry) return;
    redoStack.current.push(entry);
    syncHistoryStatus();
    if (entry.kind === "transform") {
      attachmentRef.current?.setTransform(entry.before);
    } else {
      pendingTransformRef.current = entry.beforeId === null ? null : entry.beforeTransform;
      setEquippedIdState(entry.beforeId);
    }
  }, [attachmentRef, syncHistoryStatus]);

  const redo = useCallback(() => {
    const entry = redoStack.current.pop();
    if (!entry) return;
    undoStack.current.push(entry);
    syncHistoryStatus();
    if (entry.kind === "transform") {
      attachmentRef.current?.setTransform(entry.after);
    } else {
      pendingTransformRef.current = entry.afterId === null ? null : entry.afterTransform;
      setEquippedIdState(entry.afterId);
    }
  }, [attachmentRef, syncHistoryStatus]);

  return {
    equippedId,
    equip,
    setEquippedFromPreset,
    commitTransformChange,
    resetTransform,
    undo,
    redo,
    canUndo: historyStatus.canUndo,
    canRedo: historyStatus.canRedo,
    clearCosmeticHistory,
    onAttachmentSettled,
  };
}
