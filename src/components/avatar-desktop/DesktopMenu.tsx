"use client";

import { menuAnchorFor, type DesktopAvatarLayout } from "./desktopAvatarLayout";

/**
 * Small floating panel that opens next to the character on click (section
 * 14). Deliberately built as a plain list of MenuItem rows rather than one
 * hardcoded block of JSX, so the timer section the brief describes as a
 * future addition (section 23 - "25:00 / ▶ 작업 시작" above a divider)
 * can be prepended later without restructuring this component.
 *
 * Its anchor position is no longer a fixed pixel constant - `menuAnchorFor`
 * (see desktopAvatarLayout.ts) derives it from the current Avatar Scale
 * layout, so the menu keeps appearing next to the character at every scale
 * (section 21 of the Avatar Scale brief) instead of drifting away from a
 * shrunk/grown avatar.
 */

interface MenuItemProps {
  label: string;
  onClick: () => void;
  trailing?: React.ReactNode;
}

function MenuItem({ label, onClick, trailing }: MenuItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        padding: "7px 12px",
        background: "transparent",
        border: "none",
        color: "#eef0f4",
        fontSize: 12,
        textAlign: "left",
        cursor: "pointer",
        borderRadius: 6,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span>{label}</span>
      {trailing}
    </button>
  );
}

const divider: React.CSSProperties = { borderTop: "1px solid rgba(255,255,255,0.08)", margin: "4px 2px" };

interface DesktopMenuProps {
  open: boolean;
  /** Current Avatar Scale layout - drives the anchor position (see
   * menuAnchorFor). DesktopAvatarScene freezes this snapshot while
   * `settingsOpen` is true so the menu (and the size slider inside it)
   * never drifts out from under the user's own pointer mid-drag. */
  layout: DesktopAvatarLayout;
  alwaysOnTop: boolean;
  onOpenEditor: () => void;
  onOpenFriends: () => void;
  onOpenCowork: () => void;
  /** True while the user has an active co-working room - swaps the plain
   * "같이 작업하기" item out for `coworkSection`'s room summary instead
   * (section 17/42 of the cowork-room brief). */
  hasCoworkRoom: boolean;
  onToggleAlwaysOnTop: () => void;
  onHide: () => void;
  onQuit: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  /** The timer wizard/detail view (TimerFloatingMenuSection) - rendered
   * above the existing items with its own divider. Optional/absent keeps
   * this component's original layout exactly as before the timer feature
   * existed (used by nothing today, but avoids hard-coupling this generic
   * menu shell to the timer feature). */
  timerSection?: React.ReactNode;
  /** The profile summary (ProfileMenuSection) - rendered above
   * timerSection with its own divider (section 23's menu mockup: profile
   * block, then timer block, then the existing action items). Optional for
   * the same reason timerSection is. */
  profileSection?: React.ReactNode;
  /** The active-room summary (CoWorkMenuSection) - rendered above the
   * regular action items with its own divider, same stacking convention as
   * profileSection/timerSection. Only meaningful (and only ever passed)
   * while `hasCoworkRoom` is true. */
  coworkSection?: React.ReactNode;
  /** True while the "설정" panel (settingsSection) is showing INSTEAD of
   * the normal menu content - same "swap the whole panel" pattern
   * TimerFloatingMenuSection's own internal steps already use. */
  settingsOpen: boolean;
  settingsSection: React.ReactNode;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  /** Pixel offset added to the computed anchor (section 12 of the
   * Desktop-avatar-rendering brief's computeLocalSlotOrigin) - zero
   * (default) whenever Local's avatar sits at the grid's own top-left, ie.
   * whenever there's no active CoWork Room (section 13's "기존과 동일"). */
  anchorOffset?: { x: number; y: number };
}

export default function DesktopMenu({
  open,
  layout,
  alwaysOnTop,
  onOpenEditor,
  onOpenFriends,
  onOpenCowork,
  hasCoworkRoom,
  onToggleAlwaysOnTop,
  onHide,
  onQuit,
  onMouseEnter,
  onMouseLeave,
  timerSection,
  profileSection,
  coworkSection,
  settingsOpen,
  settingsSection,
  onOpenSettings,
  onCloseSettings,
  anchorOffset = { x: 0, y: 0 },
}: DesktopMenuProps) {
  if (!open) return null;

  const width = settingsOpen ? 200 : timerSection || profileSection || coworkSection ? 220 : 148;
  const anchor = menuAnchorFor(layout, width);

  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: "fixed",
        top: anchor.top + anchorOffset.y,
        left: anchor.left + anchorOffset.x,
        width,
        borderRadius: 10,
        background: "rgba(24,24,28,0.85)",
        border: "1px solid rgba(255,255,255,0.12)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
        padding: 4,
        backdropFilter: "blur(4px)",
      }}
    >
      {settingsOpen ? (
        <>
          {settingsSection}
          <div style={divider} />
          <MenuItem label="← 뒤로" onClick={onCloseSettings} />
        </>
      ) : (
        <>
          {profileSection && (
            <>
              {profileSection}
              <div style={divider} />
            </>
          )}
          {timerSection && (
            <>
              {timerSection}
              <div style={divider} />
            </>
          )}
          {coworkSection && (
            <>
              {coworkSection}
              <div style={divider} />
            </>
          )}
          <MenuItem label="캐릭터 꾸미기" onClick={onOpenEditor} />
          {!hasCoworkRoom && <MenuItem label="같이 작업하기" onClick={onOpenCowork} />}
          <MenuItem label="친구" onClick={onOpenFriends} />
          <MenuItem
            label="항상 위"
            onClick={onToggleAlwaysOnTop}
            trailing={<span style={{ color: alwaysOnTop ? "#7fd490" : "#5a5f68" }}>{alwaysOnTop ? "✓" : ""}</span>}
          />
          <MenuItem label="설정" onClick={onOpenSettings} />
          <div style={divider} />
          <MenuItem label="숨기기" onClick={onHide} />
          <MenuItem label="종료" onClick={onQuit} />
        </>
      )}
    </div>
  );
}
