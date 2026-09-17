/**
 * Renderer-side mirror of electron/desktopWindowConfig.ts's own
 * computeGridWindowSize()/GRID_GAP (same "mirrored not imported" reason as
 * desktopAvatarLayout.ts's own header comment - electron/'s tsconfig can't
 * cross the electron/src boundary). MUST stay numerically identical to that
 * file's copy, or the window Main actually creates and the CSS grid the
 * Renderer draws into it will disagree.
 *
 * Also owns the participant -> grid-slot assignment (sections 13-18 of the
 * Desktop-avatar-rendering brief): which of the up to 4 slots each
 * participant lands in, and in what stable order, so a Realtime member
 * update never makes remote avatars visibly swap places.
 */
import { computeDesktopAvatarLayout, type DesktopAvatarLayout } from "../desktopAvatarLayout";
import type { DesktopParticipant } from "./desktopParticipant";

/** MUST match electron/desktopWindowConfig.ts's GRID_GAP exactly. */
export const GRID_GAP = 16;

export interface GridWindowSize {
  width: number;
  height: number;
  remoteSlotHeight: number;
  localSlotHeight: number;
}

/** Renderer-side copy of electron/desktopWindowConfig.ts's
 * computeGridWindowSize() - see that file for the layout rationale. Takes
 * the already-computed single-avatar `layout` (desktopAvatarLayout.ts)
 * rather than recomputing it, since callers here already have it. */
export function computeGridWindowSize(layout: DesktopAvatarLayout, participantCount: number): GridWindowSize {
  // Remote slots now include the same hudStripHeight-worth of space as
  // Local (RemoteTimerHUD - cowork-timer-sync brief section 43), so both
  // are numerically equal - kept as separate fields for call-site clarity.
  const remoteSlotHeight = layout.windowHeight;
  const localSlotHeight = layout.windowHeight;
  const count = Math.max(1, Math.min(4, Math.round(participantCount) || 1));

  if (count === 1) return { width: layout.windowWidth, height: localSlotHeight, remoteSlotHeight, localSlotHeight };
  if (count === 2)
    return {
      width: layout.windowWidth * 2 + GRID_GAP,
      height: localSlotHeight,
      remoteSlotHeight,
      localSlotHeight,
    };
  return {
    width: layout.windowWidth * 2 + GRID_GAP,
    height: remoteSlotHeight + GRID_GAP + localSlotHeight,
    remoteSlotHeight,
    localSlotHeight,
  };
}

export type GridCell = { participant: DesktopParticipant; isLocalSlot: boolean } | null;

export interface ParticipantGrid {
  /** Each row is exactly 2 cells for a 2-row grid (3/4 participants), or 1
   * row of 1-2 cells for 1/2 participants. `null` = an intentionally empty
   * cell (section 15 - the 3-participant layout's bottom row is centered
   * by leaving one side empty, not by stretching). */
  rows: GridCell[][];
}

/** Stable sort (section 18): local always occupies its own designated
 * slot (never reordered by a profile-only refresh), remotes are ordered by
 * joinedAt (ties broken by userId) so a Realtime update that only changes
 * one member's nickname/level never reshuffles everyone else's position. */
function sortedRemotes(participants: DesktopParticipant[]): DesktopParticipant[] {
  return participants
    .filter((p) => !p.isLocal)
    .slice()
    .sort((a, b) => {
      if (a.joinedAt !== b.joinedAt) return a.joinedAt < b.joinedAt ? -1 : 1;
      return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
    });
}

/**
 * Arranges participants into the grid (sections 13-17):
 *   1: [[local]]
 *   2: [[remote, local]]                       (remote left, local right)
 *   3: [[remoteA, remoteB], [null, local]]      (local bottom-center-ish:
 *        the single bottom slot sits under the RIGHT column so it lines up
 *        with where local always is at 2/4 participants - section 17's
 *        "일관된 위치" - with the left cell left empty/centered via CSS)
 *   4: [[remoteA, remoteB], [remoteC, local]]   (2x2, local bottom-right)
 */
export function assignParticipantGrid(participants: DesktopParticipant[]): ParticipantGrid {
  const local = participants.find((p) => p.isLocal);
  const remotes = sortedRemotes(participants);
  if (!local) {
    // Should never happen in practice (the local user is always a
    // participant, in-room or not - see useDesktopParticipants), but stay
    // defensive rather than throwing.
    return { rows: [remotes.map((p) => ({ participant: p, isLocalSlot: false }))] };
  }

  const localCell: GridCell = { participant: local, isLocalSlot: true };
  const count = participants.length;

  if (count <= 1) return { rows: [[localCell]] };
  if (count === 2) {
    return { rows: [[{ participant: remotes[0], isLocalSlot: false }, localCell]] };
  }
  if (count === 3) {
    return {
      rows: [
        [
          { participant: remotes[0], isLocalSlot: false },
          { participant: remotes[1], isLocalSlot: false },
        ],
        [null, localCell],
      ],
    };
  }
  // count === 4 (or, defensively, more - the DB caps at maxMembers so this
  // shouldn't happen, but extra members just fall off the grid rather than
  // crashing).
  return {
    rows: [
      [
        { participant: remotes[0], isLocalSlot: false },
        { participant: remotes[1], isLocalSlot: false },
      ],
      [{ participant: remotes[2], isLocalSlot: false }, localCell],
    ],
  };
}

export interface PositionedParticipant {
  participant: DesktopParticipant;
  isLocalSlot: boolean;
  x: number;
  y: number;
}

/**
 * Flat, per-participant pixel placement (bug fix - CoWork "내 캐릭터
 * 머리가 사라짐"). DesktopParticipantGrid used to render assignParticipantGrid's
 * nested `rows[][]` directly as `rows.map(row => <div key={rowIndex}>
 * {row.map(cell => <... key={cell.userId}/>)}</div>)`. React only
 * preserves a keyed child's mounted instance (and all its internal state -
 * refs, effects, THREE.js objects) when the key is matched WITHIN THE SAME
 * PARENT across renders. assignParticipantGrid moves Local from row 0 to
 * row 1 the moment a 3rd participant joins (and back on the 4th leaving) -
 * a real reparent, not just a reorder - so Local's own <Canvas> (Hair/
 * Face/Tops/Cosmetic scenes, materials, LayerStackEngine instances) was
 * silently unmounted and remounted on that specific transition, discarding
 * every already-wired Hair material and forcing a full, easy-to-race
 * CharacterPreset re-hydration (see DesktopAvatarScene's loadActiveCharacter)
 * - exactly the "hair disappears, reappears after touching the Editor"
 * symptom, since the Editor's own save/switch flow is what re-fires the
 * reload via notifyPresetSaved.
 *
 * Fix: give every participant - local AND remote - the SAME flat list,
 * one common parent, keyed only by userId, positioned via plain CSS
 * (absolute x/y, computed with the identical row/column math
 * assignParticipantGrid and computeLocalSlotOrigin already use) instead of
 * via nested DOM/component parents. No participant-count transition can
 * ever reparent anyone this way, so nobody's scene remounts just because
 * the grid's visual row layout changed shape.
 */
export function flattenParticipantGrid(
  participants: DesktopParticipant[],
  layout: DesktopAvatarLayout
): PositionedParticipant[] {
  const { rows } = assignParticipantGrid(participants);
  const remoteSlotHeight = layout.profileStripHeight + layout.canvasHeight;
  const out: PositionedParticipant[] = [];
  let y = 0;
  for (const row of rows) {
    row.forEach((cell, colIndex) => {
      if (!cell) return;
      out.push({
        participant: cell.participant,
        isLocalSlot: cell.isLocalSlot,
        x: colIndex * (layout.windowWidth + GRID_GAP),
        y,
      });
    });
    y += remoteSlotHeight + GRID_GAP;
  }
  return out;
}

/** Pixel offset of the LOCAL slot's own top-left corner within the whole
 * grid (0,0 when there's only 1 participant - section 13's "기존과 최대한
 * 동일"). Not currently called by anything - the Floating Menu
 * (DesktopMenu.tsx) now measures Local's actual on-screen rect directly via
 * DesktopParticipantGrid's getLocalSlotRect() (see menuPlacement.ts's bug
 * fix - "설정창/메뉴가 BrowserWindow 크기 때문에 잘리는 문제", PART 20's
 * "participant index 기준으로 계산하지 않는다") rather than this
 * grid-math-derived offset. Kept as a still-correct, independently useful
 * utility rather than deleted. */
export function computeLocalSlotOrigin(
  participants: DesktopParticipant[],
  layout: DesktopAvatarLayout
): { x: number; y: number } {
  const { rows } = assignParticipantGrid(participants);
  const remoteSlotHeight = layout.profileStripHeight + layout.canvasHeight;
  let y = 0;
  for (const row of rows) {
    const localIndex = row.findIndex((c) => c?.isLocalSlot);
    if (localIndex !== -1) {
      return { x: localIndex * (layout.windowWidth + GRID_GAP), y };
    }
    y += remoteSlotHeight + GRID_GAP;
  }
  return { x: 0, y: 0 };
}
