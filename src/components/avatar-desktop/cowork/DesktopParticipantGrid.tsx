"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import type { DesktopAvatarLayout } from "../desktopAvatarLayout";
import { computeGridWindowSize, flattenParticipantGrid, type PositionedParticipant } from "./desktopParticipantLayout";
import { useCoworkLocalLayout } from "./useCoworkLocalLayout";
import type { LayoutPosition } from "./coworkLocalLayoutStorage";
import type { DesktopParticipant } from "./desktopParticipant";
import RemoteAvatarCanvas from "./RemoteAvatarCanvas";
import type { CoworkPublicTimerState, NetworkAppearanceManifest } from "../../../lib/supabase/database.types";

export interface DesktopParticipantGridHandle {
  /** Applies THIS FRAME's screen-space delta to Local's own layout position
   * - called from DesktopAvatarScene's DesktopInteractionLayer wiring, since
   * Local's interaction layer lives inside `localSlotContent` (a sibling
   * subtree passed in from the parent), not inside this component. Imperative
   * (mutates the cell's own DOM style directly, same as the window-drag rAF
   * pattern it replaces in CoWork mode) rather than React state, so a fast
   * drag never lags a render behind. */
  applyLocalDragDelta: (dx: number, dy: number) => void;
  /** Commits Local's current live-dragged position to the persisted local
   * layout (coworkLocalLayoutStorage.ts) - called once on pointer-up. */
  commitLocalDrag: () => void;
}

/**
 * Arranges the current Room's participants into the on-screen grid
 * (sections 13-17) - Local's own existing Canvas/HUD/TimerHUD content
 * (passed through as `localSlotContent`, completely unmodified - section
 * 1/4) occupies whichever slot assignParticipantGrid gives it, and each
 * remote participant gets its own RemoteAvatarCanvas slot alongside it.
 *
 * Aggregates hover/dragging across ALL remote slots (section 21) - click-
 * through must consider the whole grid, not just Local's own canvas, or
 * the transparent gaps around/between remote avatars would stop being
 * click-through-able. Local's own hover/dragging is combined with this
 * aggregate one level up, in DesktopAvatarScene.tsx.
 *
 * Free-placement (feature request - "다른 사람 캐릭터를 내 화면에서 자유롭게
 * 이동"): `flattenParticipantGrid`'s {x,y} is only the DEFAULT position for
 * a participant nobody has dragged yet (via useCoworkLocalLayout). Once
 * dragged, a participant's cell renders at its saved LOCAL-ONLY override
 * instead, regardless of how the grid math would have placed it - and stays
 * there across participant-count changes (section 19/20), since the default
 * is only ever consulted for participants with no override at all. Dragging
 * never touches Supabase/NetworkAppearanceManifest/CharacterPreset (section
 * 18's server-save prohibition) - see coworkLocalLayoutStorage.ts.
 */
function DesktopParticipantGrid(
  {
    participants,
    memberStates,
    appearances,
    layout,
    roomId,
    localSlotContent,
    onRemoteHoverChange,
    onRemoteDraggingChange,
  }: {
    participants: DesktopParticipant[];
    /** Current Room's member timer/status states, keyed by userId (section
     * 1/23 of the cowork-timer-sync brief) - `undefined` for a participant
     * with no row yet is treated as idle throughout (RemoteAvatarCanvas/
     * RemoteTimerHUD/RemoteAvatarInstance all accept `null`). */
    memberStates: Map<string, CoworkPublicTimerState>;
    /** Current Room's REMOTE participants' Network Appearance Snapshot
     * manifests, keyed by userId (section 33/34 of the avatar-appearance-
     * sync brief) - `undefined`/missing means "never published, use default
     * appearance" (section 42). */
    appearances: Map<string, NetworkAppearanceManifest>;
    layout: DesktopAvatarLayout;
    /** The active Room's id, or `null` when there's no Room (solo Desktop) -
     * scopes the free-placement local layout storage (section 18/19). */
    roomId: string | null;
    localSlotContent: React.ReactNode;
    onRemoteHoverChange: (hovering: boolean) => void;
    onRemoteDraggingChange: (dragging: boolean) => void;
  },
  forwardedRef: React.ForwardedRef<DesktopParticipantGridHandle>
) {
  const hoverSetRef = useRef<Set<string>>(new Set());
  const draggingSetRef = useRef<Set<string>>(new Set());
  const cellElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const liveDragPositionRef = useRef<Map<string, LayoutPosition>>(new Map());

  const { getPosition, setPosition } = useCoworkLocalLayout(roomId);

  const makeHoverHandler = useCallback(
    (userId: string) => (hovering: boolean) => {
      if (hovering) hoverSetRef.current.add(userId);
      else hoverSetRef.current.delete(userId);
      onRemoteHoverChange(hoverSetRef.current.size > 0);
    },
    [onRemoteHoverChange]
  );
  const makeDraggingHandler = useCallback(
    (userId: string) => (dragging: boolean) => {
      if (dragging) draggingSetRef.current.add(userId);
      else draggingSetRef.current.delete(userId);
      onRemoteDraggingChange(draggingSetRef.current.size > 0);
    },
    [onRemoteDraggingChange]
  );

  // A remote leaving (section 29) unmounts its RemoteAvatarCanvas without
  // ever getting a chance to report hovering=false first - without this,
  // a departed participant's userId could stay stuck in the hover/dragging
  // sets forever, permanently blocking click-through for empty space where
  // their slot used to be. Prune on every participant-list change.
  useEffect(() => {
    const liveIds = new Set(participants.map((p) => p.userId));
    let hoverChanged = false;
    for (const id of hoverSetRef.current) {
      if (!liveIds.has(id)) {
        hoverSetRef.current.delete(id);
        hoverChanged = true;
      }
    }
    if (hoverChanged) onRemoteHoverChange(hoverSetRef.current.size > 0);

    let draggingChanged = false;
    for (const id of draggingSetRef.current) {
      if (!liveIds.has(id)) {
        draggingSetRef.current.delete(id);
        draggingChanged = true;
      }
    }
    if (draggingChanged) onRemoteDraggingChange(draggingSetRef.current.size > 0);
  }, [participants, onRemoteHoverChange, onRemoteDraggingChange]);

  // Flat, single-parent placement (bug fix - see flattenParticipantGrid's
  // own doc comment): every cell below is a DIRECT sibling keyed only by
  // userId and positioned purely via CSS, so a participant-count change
  // that moves someone between visual "rows" (e.g. Local moving from row 0
  // to row 1 when a 3rd participant joins) never reparents - and therefore
  // never remounts - their scene. This is what actually fixes "Local's own
  // Hair/Face/Tops/Cosmetic scene goes blank after a room's layout
  // reshuffles" - the previous nested rows[][] -> per-row <div> structure
  // silently unmounted/remounted whichever cell crossed a row boundary.
  const cells = flattenParticipantGrid(participants, layout);

  // Reasonable drag bounds (section 21 - "화면 밖으로 완전히 사라지지 않도록")
  // - the SAME window size Electron actually resizes the BrowserWindow to
  // for this participant count (computeGridWindowSize, mirrored 1:1 from
  // electron/desktopWindowConfig.ts - see desktopParticipantLayout.ts's own
  // header comment), so free placement is bounded to the transparent
  // window's own already-allocated canvas area rather than either an
  // unbounded free-for-all or a whole new oversized invisible window.
  const windowSize = computeGridWindowSize(layout, participants.length);
  const maxX = Math.max(0, windowSize.width - layout.windowWidth);
  const maxY = Math.max(0, windowSize.height - layout.windowHeight);
  const clamp = useCallback(
    (pos: LayoutPosition): LayoutPosition => ({
      x: Math.min(Math.max(0, pos.x), maxX),
      y: Math.min(Math.max(0, pos.y), maxY),
    }),
    [maxX, maxY]
  );

  const setCellRef = useCallback(
    (userId: string) => (el: HTMLDivElement | null) => {
      if (el) cellElementsRef.current.set(userId, el);
      else cellElementsRef.current.delete(userId);
    },
    []
  );

  const applyDragDelta = useCallback(
    (userId: string, dx: number, dy: number, fallback: LayoutPosition) => {
      const current = liveDragPositionRef.current.get(userId) ?? getPosition(userId, fallback);
      const next = clamp({ x: current.x + dx, y: current.y + dy });
      liveDragPositionRef.current.set(userId, next);
      const el = cellElementsRef.current.get(userId);
      if (el) {
        el.style.left = `${next.x}px`;
        el.style.top = `${next.y}px`;
      }
    },
    [getPosition, clamp]
  );

  const commitDrag = useCallback(
    (userId: string) => {
      const pos = liveDragPositionRef.current.get(userId);
      liveDragPositionRef.current.delete(userId);
      if (pos) setPosition(userId, pos);
    },
    [setPosition]
  );

  const findCell = useCallback(
    (predicate: (cell: PositionedParticipant) => boolean) => cells.find(predicate),
    [cells]
  );

  useImperativeHandle(
    forwardedRef,
    () => ({
      applyLocalDragDelta: (dx: number, dy: number) => {
        const localCell = findCell((c) => c.isLocalSlot);
        if (!localCell) return;
        applyDragDelta(localCell.participant.userId, dx, dy, { x: localCell.x, y: localCell.y });
      },
      commitLocalDrag: () => {
        const localCell = findCell((c) => c.isLocalSlot);
        if (!localCell) return;
        commitDrag(localCell.participant.userId);
      },
    }),
    [findCell, applyDragDelta, commitDrag]
  );

  return (
    <>
      {cells.map((cell) => {
        const userId = cell.participant.userId;
        const pos = getPosition(userId, { x: cell.x, y: cell.y });
        return (
          <div
            key={userId}
            ref={setCellRef(userId)}
            style={{ position: "absolute", left: pos.x, top: pos.y, width: layout.windowWidth }}
          >
            {cell.isLocalSlot ? (
              localSlotContent
            ) : (
              <RemoteAvatarCanvas
                participant={cell.participant}
                state={memberStates.get(userId) ?? null}
                appearance={appearances.get(userId) ?? null}
                width={layout.windowWidth}
                canvasHeight={layout.canvasHeight}
                profileStripHeight={layout.profileStripHeight}
                hudScale={layout.hudScale}
                onHoverChange={makeHoverHandler(userId)}
                onDraggingChange={makeDraggingHandler(userId)}
                onDragMove={(dx, dy) => applyDragDelta(userId, dx, dy, { x: cell.x, y: cell.y })}
                onDragEnd={() => commitDrag(userId)}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

export default forwardRef(DesktopParticipantGrid);
