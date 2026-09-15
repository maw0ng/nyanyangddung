"use client";

import type { DesktopInteractionDebugInfo } from "./DesktopInteractionLayer";

/** Dev-only readout of Desktop Mode's interaction state machine (section
 * 26) - the parent only renders this when NODE_ENV !== "production", so
 * it never ships in the packaged app. */
export default function DesktopDebugOverlay({
  info,
  clickThrough,
  menuOpen,
}: {
  info: DesktopInteractionDebugInfo | null;
  clickThrough: boolean;
  menuOpen: boolean;
}) {
  return (
    <div
      style={{
        position: "fixed",
        top: 4,
        left: 4,
        fontSize: 10,
        lineHeight: 1.5,
        color: "#9ad1ff",
        background: "rgba(0,0,0,0.45)",
        padding: "4px 6px",
        borderRadius: 4,
        fontFamily: "monospace",
        pointerEvents: "none",
      }}
    >
      Hit: {info?.hit ? "character" : "none"}
      <br />
      ClickThrough: {clickThrough ? "ON" : "OFF"}
      <br />
      Dragging: {String(info?.dragging ?? false)}
      <br />
      Menu: {menuOpen ? "open" : "closed"}
    </div>
  );
}
