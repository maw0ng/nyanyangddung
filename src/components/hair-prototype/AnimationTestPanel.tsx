"use client";

/**
 * DEV-ONLY test panel for the avatar Animation Controller. Talks to the
 * animation system exclusively through setAnimationState/
 * playTemporaryAnimation - the same public API real room/timer status
 * wiring will use later (see section 8 of the brief) - so this component
 * can be deleted outright once that wiring exists, with no changes needed
 * anywhere else.
 */
import {
  PERSISTENT_ANIMATION_STATES,
  TEMPORARY_ANIMATION_STATES,
  type AvatarAnimationDebugSnapshot,
  type AvatarAnimationState,
} from "./avatarAnimation";
import { smallButtonStyle } from "./PaintToolControls";

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  color: "#8b93a3",
  marginBottom: 8,
};

interface AnimationTestPanelProps {
  onSetState: (state: AvatarAnimationState) => void;
  onPlayTemporary: (state: AvatarAnimationState) => void;
  /** Returns the avatar to its frozen static Edit Pose (Avatar Editor's
   * default - a held frame of Idle, NOT the raw bind/rest pose; see
   * avatarAnimation.ts's enterEditMode() for why) - setAnimationState/
   * setPlayTemporary above always leave that state as a side effect, so
   * this is how the panel gets back to it for testing. */
  onEnterEditMode: () => void;
  debug: AvatarAnimationDebugSnapshot | null;
}

export default function AnimationTestPanel({
  onSetState,
  onPlayTemporary,
  onEnterEditMode,
  debug,
}: AnimationTestPanelProps) {
  const inEditMode = debug?.editMode ?? true;

  return (
    <div>
      <div style={sectionTitleStyle}>[개발용] 애니메이션 테스트</div>

      <button
        style={{
          ...smallButtonStyle(false),
          width: "100%",
          marginBottom: 10,
          border: inEditMode ? "2px solid #3b82f6" : smallButtonStyle(false).border,
        }}
        onClick={onEnterEditMode}
      >
        편집 모드 (Edit Pose)
      </button>

      <div style={{ fontSize: 11, color: "#8b93a3", marginBottom: 6 }}>지속 상태</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {PERSISTENT_ANIMATION_STATES.map((state) => (
          <button
            key={state}
            style={{
              ...smallButtonStyle(false),
              flex: "none",
              padding: "6px 10px",
              border:
                !inEditMode && debug?.persistent === state
                  ? "2px solid #3b82f6"
                  : smallButtonStyle(false).border,
            }}
            onClick={() => onSetState(state)}
          >
            {state}
          </button>
        ))}
      </div>

      <div style={{ fontSize: 11, color: "#8b93a3", marginBottom: 6 }}>임시 동작</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {TEMPORARY_ANIMATION_STATES.map((state) => (
          <button
            key={state}
            style={{
              ...smallButtonStyle(false),
              flex: "none",
              padding: "6px 10px",
              border:
                !inEditMode && debug?.playing === state
                  ? "2px solid #3b82f6"
                  : smallButtonStyle(false).border,
            }}
            onClick={() => onPlayTemporary(state)}
          >
            {state}
          </button>
        ))}
      </div>

      {debug && (
        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 10, lineHeight: 1.6 }}>
          Edit Mode: {debug.editMode ? "ON (edit pose)" : "OFF"}
          <br />
          Persistent: {debug.persistent}
          <br />
          Playing: {debug.editMode ? "-" : debug.playing}
          <br />
          Return to: {debug.returnTo}
        </div>
      )}
    </div>
  );
}
