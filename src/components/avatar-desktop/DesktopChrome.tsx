"use client";

import { useState } from "react";

/**
 * Minimal, hover-revealed Desktop Mode UI: a small window-drag handle plus
 * one button back to the Avatar Editor - section 16/17 of the brief
 * explicitly asks for "as small as possible, character stays the star".
 * Never touches the Canvas - -webkit-app-region: drag is scoped to this
 * tiny strip only, so it can never swallow future character clicks/
 * raycasts the way dragging the whole Canvas would.
 */

// -webkit-app-region is an Electron-only CSS extension not present in
// React's CSSProperties typings - extend locally rather than `as any`.
type ElectronCSSProperties = React.CSSProperties & {
  WebkitAppRegion?: "drag" | "no-drag";
};

const dragHandleStyle: ElectronCSSProperties = {
  WebkitAppRegion: "drag",
  width: 56,
  height: 12,
  borderRadius: 6,
  cursor: "grab",
};

const editorButtonStyle: ElectronCSSProperties = {
  WebkitAppRegion: "no-drag",
  width: 22,
  height: 22,
  borderRadius: "50%",
  border: "1px solid rgba(255,255,255,0.35)",
  background: "rgba(20,20,24,0.65)",
  color: "#eee",
  fontSize: 12,
  lineHeight: "20px",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

function openEditor() {
  if (typeof window === "undefined") return;
  if (window.desktopAPI?.openEditor) {
    window.desktopAPI.openEditor();
  } else {
    // Plain browser fallback (section 18) - never throws just because
    // desktopAPI doesn't exist outside Electron.
    window.open("/hair-test", "_blank");
  }
}

export default function DesktopChrome() {
  const [hover, setHover] = useState(false);

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        // Only the handle/button below opt back into pointer events -
        // this row itself must never block clicks meant for the character.
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          ...dragHandleStyle,
          pointerEvents: "auto",
          background: hover ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.1)",
          transition: "background 0.15s ease",
        }}
        title="드래그해서 창 이동"
      />
      {hover && (
        <button
          type="button"
          onClick={openEditor}
          style={{ ...editorButtonStyle, pointerEvents: "auto" }}
          title="Avatar Editor 열기"
        >
          ⚙
        </button>
      )}
    </div>
  );
}
