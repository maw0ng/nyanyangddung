"use client";

import { forwardRef } from "react";

/**
 * Small floating panel that opens next to the character on click (section
 * 14). Deliberately built as a plain list of MenuItem rows rather than one
 * hardcoded block of JSX, so the timer section the brief describes as a
 * future addition (section 23 - "25:00 / ▶ 작업 시작" above a divider)
 * can be prepended later without restructuring this component.
 *
 * Its position is computed by the parent (DesktopAvatarScene, via
 * menuPlacement.ts's computeMenuPlacement) from the character's own live
 * on-screen rect with collision detection against the current window - see
 * the `position` prop's own doc comment (bug fix - "설정창/메뉴가
 * BrowserWindow 크기 때문에 잘리는 문제").
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
  /** Explicit top-left position in CSS px (bug fix - "설정창/메뉴가
   * BrowserWindow 크기 때문에 잘리는 문제") - computed by DesktopAvatarScene
   * via menuPlacement.ts's collision-avoiding computeMenuPlacement() against
   * the Local avatar's actual on-screen rect, never a fixed offset from a
   * layout constant anymore. `null` on the very first render after opening
   * (before DesktopAvatarScene has measured this component's own rendered
   * size via the forwarded ref) - rendered off-screen-but-measurable rather
   * than skipped, so the two-pass measure-then-place technique has
   * something to measure. */
  position: { top: number; left: number } | null;
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
  /** Bug fix ("설정창/메뉴 우측 상단에 X 닫기 버튼 추가") - closes ONLY this
   * menu (React state, see DesktopAvatarScene's closeCharacterMenu). Never
   * wired to anything Electron-window-related - see this component's own
   * X-button doc comment below. */
  onRequestClose: () => void;
}

/**
 * `forwardRef` (bug fix - "설정창/메뉴가 BrowserWindow 크기 때문에 잘리는
 * 문제"): DesktopAvatarScene needs this component's ACTUAL rendered size
 * (which varies with content - profile/timer/cowork sections, settings
 * view) to run collision detection against, via the standard "render once,
 * measure, reposition" two-pass technique for a popover whose size isn't
 * known upfront - see menuPlacement.ts's own header comment.
 */
const DesktopMenu = forwardRef<HTMLDivElement, DesktopMenuProps>(function DesktopMenu(
  {
    open,
    position,
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
    onRequestClose,
  },
  forwardedRef
) {
  if (!open) return null;

  const width = settingsOpen ? 200 : timerSection || profileSection || coworkSection ? 220 : 148;

  return (
    <div
      ref={forwardedRef}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: "fixed",
        // Rendered at (0,0) - off in the corner but still fully laid out
        // and measurable - until DesktopAvatarScene's own layout effect has
        // measured it and computed a real collision-avoided position
        // (never `display:none`, which would report a zero-size rect and
        // make that very first measurement useless).
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        visibility: position ? "visible" : "hidden",
        width,
        borderRadius: 10,
        background: "rgba(24,24,28,0.85)",
        border: "1px solid rgba(255,255,255,0.12)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
        padding: 4,
        backdropFilter: "blur(4px)",
      }}
    >
      {/* Bug fix ("설정창/메뉴 우측 상단에 X 닫기 버튼 추가") - closes ONLY
          the React `menuOpen` state (via onRequestClose ->
          DesktopAvatarScene's closeCharacterMenu), the exact same single
          close path Escape/outside-click/re-clicking the character already
          use (PART 14) - never app.quit()/BrowserWindow.close()/hide/leave-
          room/anything Electron-window-related. `-webkit-app-region:
          no-drag` (PART 15) keeps it from ever being interpreted as a
          window-drag handle even though it sits inside the same
          interactive-region tree the Avatar drag/Window drag gestures
          share. */}
      <button
        type="button"
        onClick={onRequestClose}
        aria-label="닫기"
        style={{
          position: "absolute",
          top: 6,
          right: 6,
          width: 20,
          height: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
          border: "none",
          borderRadius: 5,
          color: "#9aa0aa",
          fontSize: 14,
          lineHeight: 1,
          cursor: "pointer",
          WebkitAppRegion: "no-drag",
        } as React.CSSProperties}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,0.1)";
          e.currentTarget.style.color = "#eef0f4";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "#9aa0aa";
        }}
      >
        ×
      </button>
      {/* Top margin clears the X button's own 20px row so it never overlaps
          the first menu item's label/trailing content (PART 11 - "너무
          크거나 과하게 튀는 버튼으로 만들지 않는다", kept minimal). */}
      <div style={{ marginTop: 18 }}>
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
    </div>
  );
});

export default DesktopMenu;
