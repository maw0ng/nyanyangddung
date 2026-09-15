"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { FacePaintSceneHandle } from "./FacePaintScene";
import {
  MORPH_CATEGORIES,
  REQUIRED_CUSTOM_EYE_NAMES,
  labelFor,
  type MorphCategoryId,
} from "./morphConfig";
import { MorphHistoryEngine, type MorphHistoryStatus } from "./morphHistoryEngine";

/**
 * Owns the "이목구비" (facial feature) Shape Key customizer's behavior:
 * categorizing the real morphTargetDictionary names, reading/writing
 * values through FacePaintSceneHandle's existing morph API (added in an
 * earlier pass - never re-implemented here), category/full reset against
 * the GLB's real baseline, and a small independent Undo/Redo stack for
 * morph edits. Renders nothing - MorphCustomizer.tsx is the UI.
 *
 * Deliberately reuses the SAME `morphValues`/`setMorphValues` React state
 * HairPaintPrototype already maintains for the existing raw "Body Morph"
 * debug panel, rather than a second parallel copy - both UIs always agree
 * on the live value, and CharacterPreset save/restore (which already
 * snapshots/restores the *entire* getMorphValues() map, see
 * gatherAppearance/applyCharacterAppearance) picks up edits from either
 * UI automatically with no changes needed there.
 */

export interface MorphCategoryUIState {
  id: MorphCategoryId;
  title: string;
  items: Array<{ morphName: string; label: string; value: number }>;
}

export interface AvatarMorphDiagnostics {
  bodyMeshName: string | null;
  totalMorphCount: number;
  categoryCounts: Record<MorphCategoryId, number>;
  missingCustomEyeNames: string[];
}

interface UseAvatarMorphsArgs {
  faceSceneRef: React.RefObject<FacePaintSceneHandle>;
  ready: boolean;
  morphNames: string[];
  morphValues: Record<string, number>;
  setMorphValues: (updater: (prev: Record<string, number>) => Record<string, number>) => void;
  markDirty: () => void;
}

export interface UseAvatarMorphsResult {
  categories: MorphCategoryUIState[];
  onDragStart: (names: string[]) => void;
  onChange: (name: string, value: number) => void;
  onCategoryReset: (categoryId: MorphCategoryId) => void;
  onResetAll: () => void;
  historyStatus: MorphHistoryStatus;
  undo: () => void;
  redo: () => void;
  /** Wipes the morph Undo/Redo stack without touching current values -
   * call this from the same place LayerStackEngine.clearHistory() is
   * called (character switch/creation), never on a ready-transition. */
  clearHistory: () => void;
  diagnostics: AvatarMorphDiagnostics;
}

export function useAvatarMorphs({
  faceSceneRef,
  ready,
  morphNames,
  morphValues,
  setMorphValues,
  markDirty,
}: UseAvatarMorphsArgs): UseAvatarMorphsResult {
  const [historyStatus, setHistoryStatus] = useState<MorphHistoryStatus>({
    canUndo: false,
    canRedo: false,
  });
  const historyRef = useRef<MorphHistoryEngine | null>(null);
  if (!historyRef.current) {
    historyRef.current = new MorphHistoryEngine(setHistoryStatus);
  }

  // A brand-new/just-switched Character must start with a clean morph
  // history, same rule as Layer Stack history (section 13 - Undo must
  // never reach back into a different character's state). Switching
  // characters does NOT toggle `ready` (Body stays mounted the whole
  // time), so this can't be driven by a ready-transition effect - instead
  // `clearHistory` below is called explicitly by HairPaintPrototype's
  // existing clearAllHistory(), the same function that already clears
  // every LayerStackEngine's history on character switch/creation.
  const clearHistory = useCallback(() => {
    historyRef.current?.clear();
  }, []);

  const categorized = useMemo(() => {
    const byCategory: Record<MorphCategoryId, string[]> = {
      customEye: [],
      eye: [],
      pupil: [],
      brow: [],
      mouth: [],
    };
    for (const name of morphNames) {
      const category = MORPH_CATEGORIES.find((c) => c.match(name));
      if (category) byCategory[category.id].push(name);
    }
    // custom-eye-1..4 must always be offered in that exact order.
    byCategory.customEye = REQUIRED_CUSTOM_EYE_NAMES.filter((n) => morphNames.includes(n));
    return byCategory;
  }, [morphNames]);

  const categories: MorphCategoryUIState[] = useMemo(
    () =>
      MORPH_CATEGORIES.map((cfg) => ({
        id: cfg.id,
        title: cfg.title,
        items: categorized[cfg.id].map((morphName) => ({
          morphName,
          label: labelFor(morphName),
          value: morphValues[morphName] ?? 0,
        })),
      })),
    [categorized, morphValues]
  );

  const allTrackedNames = useMemo(
    () => MORPH_CATEGORIES.flatMap((cfg) => categorized[cfg.id]),
    [categorized]
  );

  const onDragStart = useCallback(
    (names: string[]) => {
      const live = faceSceneRef.current?.getMorphValues() ?? {};
      const snapshot: Record<string, number> = {};
      for (const n of names) snapshot[n] = live[n] ?? 0;
      historyRef.current?.pushSnapshot(snapshot);
    },
    [faceSceneRef]
  );

  const onChange = useCallback(
    (name: string, value: number) => {
      faceSceneRef.current?.setMorphValue(name, value);
      setMorphValues((prev) => ({ ...prev, [name]: value }));
      markDirty();
    },
    [faceSceneRef, setMorphValues, markDirty]
  );

  const applyValues = useCallback(
    (values: Record<string, number>) => {
      faceSceneRef.current?.setMorphValues(values);
      setMorphValues((prev) => ({ ...prev, ...values }));
      markDirty();
    },
    [faceSceneRef, setMorphValues, markDirty]
  );

  const resetNames = useCallback(
    (names: string[]) => {
      if (names.length === 0) return;
      const live = faceSceneRef.current?.getMorphValues() ?? {};
      const defaults = faceSceneRef.current?.getDefaultMorphValues() ?? {};
      const before: Record<string, number> = {};
      const after: Record<string, number> = {};
      for (const n of names) {
        before[n] = live[n] ?? 0;
        after[n] = defaults[n] ?? 0;
      }
      historyRef.current?.pushSnapshot(before);
      applyValues(after);
    },
    [faceSceneRef, applyValues]
  );

  const onCategoryReset = useCallback(
    (categoryId: MorphCategoryId) => resetNames(categorized[categoryId]),
    [categorized, resetNames]
  );

  const onResetAll = useCallback(() => resetNames(allTrackedNames), [allTrackedNames, resetNames]);

  const currentValuesFor = useCallback(
    (names: string[]) => {
      const live = faceSceneRef.current?.getMorphValues() ?? {};
      const result: Record<string, number> = {};
      for (const n of names) result[n] = live[n] ?? 0;
      return result;
    },
    [faceSceneRef]
  );

  const undo = useCallback(() => {
    const restored = historyRef.current?.undo(currentValuesFor);
    if (restored) applyValues(restored);
  }, [currentValuesFor, applyValues]);

  const redo = useCallback(() => {
    const restored = historyRef.current?.redo(currentValuesFor);
    if (restored) applyValues(restored);
  }, [currentValuesFor, applyValues]);

  const diagnostics: AvatarMorphDiagnostics = useMemo(
    () => ({
      bodyMeshName: faceSceneRef.current?.getBodyMeshName() ?? null,
      totalMorphCount: morphNames.length,
      categoryCounts: {
        customEye: categorized.customEye.length,
        eye: categorized.eye.length,
        pupil: categorized.pupil.length,
        brow: categorized.brow.length,
        mouth: categorized.mouth.length,
      },
      missingCustomEyeNames: REQUIRED_CUSTOM_EYE_NAMES.filter((n) => !morphNames.includes(n)),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [faceSceneRef, morphNames, categorized]
  );

  return {
    categories,
    onDragStart,
    onChange,
    onCategoryReset,
    onResetAll,
    historyStatus,
    undo,
    redo,
    clearHistory,
    diagnostics,
  };
}
