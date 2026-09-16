"use client";

import { useCallback, useEffect, useRef } from "react";
import type { DesktopAvatarLayout } from "../desktopAvatarLayout";
import { flattenParticipantGrid } from "./desktopParticipantLayout";
import type { DesktopParticipant } from "./desktopParticipant";
import RemoteAvatarCanvas from "./RemoteAvatarCanvas";
import type { CoworkPublicTimerState, NetworkAppearanceManifest } from "../../../lib/supabase/database.types";

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
 */
export default function DesktopParticipantGrid({
  participants,
  memberStates,
  appearances,
  layout,
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
  localSlotContent: React.ReactNode;
  onRemoteHoverChange: (hovering: boolean) => void;
  onRemoteDraggingChange: (dragging: boolean) => void;
}) {
  const hoverSetRef = useRef<Set<string>>(new Set());
  const draggingSetRef = useRef<Set<string>>(new Set());

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

  return (
    <>
      {cells.map((cell) => (
        <div
          key={cell.participant.userId}
          style={{ position: "absolute", left: cell.x, top: cell.y, width: layout.windowWidth }}
        >
          {cell.isLocalSlot ? (
            localSlotContent
          ) : (
            <RemoteAvatarCanvas
              participant={cell.participant}
              state={memberStates.get(cell.participant.userId) ?? null}
              appearance={appearances.get(cell.participant.userId) ?? null}
              width={layout.windowWidth}
              canvasHeight={layout.canvasHeight}
              profileStripHeight={layout.profileStripHeight}
              hudScale={layout.hudScale}
              onHoverChange={makeHoverHandler(cell.participant.userId)}
              onDraggingChange={makeDraggingHandler(cell.participant.userId)}
            />
          )}
        </div>
      ))}
    </>
  );
}
