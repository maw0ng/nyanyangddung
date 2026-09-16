import * as THREE from "three";

/**
 * Reusable avatar animation engine - mirrors this codebase's existing
 * "plain class + imperative methods, no React state on the hot path"
 * pattern (see layerStackEngine.ts). Wraps exactly one THREE.AnimationMixer
 * bound to one avatar's root Object3D, so multiple AvatarAnimationController
 * instances (one per future avatar-in-a-room) never share a mixer or
 * animation state - each owns its own persistent/playing/return-to state.
 *
 * Only ever touches the Armature's bone transforms via the mixer's own
 * PropertyBindings - it never creates/replaces meshes, geometry, morph
 * dictionaries, or materials, and never writes to
 * mesh.morphTargetInfluences itself (that stays exclusively owned by
 * FacePaintScene's Morph panel / CharacterPreset restore).
 */

export type AvatarAnimationState =
  | "Idle"
  | "Work"
  | "Break"
  | "Sleep"
  | "Wave"
  | "Celebrate"
  | "Stretch";

export const PERSISTENT_ANIMATION_STATES: AvatarAnimationState[] = [
  "Idle",
  "Work",
  "Break",
  "Sleep",
];

export const TEMPORARY_ANIMATION_STATES: AvatarAnimationState[] = [
  "Wave",
  "Celebrate",
  "Stretch",
];

export const REQUIRED_ANIMATION_CLIPS: AvatarAnimationState[] = [
  ...PERSISTENT_ANIMATION_STATES,
  ...TEMPORARY_ANIMATION_STATES,
];

export const DEFAULT_CROSSFADE_SECONDS = 0.25;

export interface AvatarAnimationDebugSnapshot {
  persistent: AvatarAnimationState;
  playing: AvatarAnimationState;
  returnTo: AvatarAnimationState;
  editMode: boolean;
}

function isPersistent(state: AvatarAnimationState): boolean {
  return (PERSISTENT_ANIMATION_STATES as string[]).includes(state);
}
function isTemporary(state: AvatarAnimationState): boolean {
  return (TEMPORARY_ANIMATION_STATES as string[]).includes(state);
}

export class AvatarAnimationController {
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions: Partial<Record<AvatarAnimationState, THREE.AnimationAction>> = {};
  private readonly onFinished: (event: { action: THREE.AnimationAction }) => void;

  private persistentState: AvatarAnimationState = "Idle";
  private playingState: AvatarAnimationState = "Idle";
  private currentAction: THREE.AnimationAction | null = null;
  /** True while the Avatar Editor is customizing the character - the mixer
   * stops advancing pose entirely (not merely paused mid-frame) and every
   * SkinnedMesh under `root` is reset to its bind/rest pose. See
   * enterEditMode()/exitEditMode(). */
  private editMode = false;

  constructor(
    private readonly root: THREE.Object3D,
    clips: THREE.AnimationClip[]
  ) {
    this.mixer = new THREE.AnimationMixer(root);

    for (const state of REQUIRED_ANIMATION_CLIPS) {
      const clip = clips.find((c) => c.name === state);
      if (!clip) {
        console.warn(`[AvatarAnimationController] AnimationClip "${state}" not found in GLB.`);
        continue;
      }
      const action = this.mixer.clipAction(clip);
      if (isPersistent(state)) {
        action.setLoop(THREE.LoopRepeat, Infinity);
      } else {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions[state] = action;
    }

    this.onFinished = (event) => this.handleActionFinished(event);
    this.mixer.addEventListener("finished", this.onFinished);

    const initial = this.actions.Idle ? "Idle" : this.firstAvailablePersistent();
    if (initial) {
      const action = this.actions[initial]!;
      action.reset().play();
      this.currentAction = action;
      this.persistentState = initial;
      this.playingState = initial;
    } else {
      console.warn(
        "[AvatarAnimationController] no persistent AnimationClip available - avatar will stay in bind pose."
      );
    }
  }

  private firstAvailablePersistent(): AvatarAnimationState | null {
    return PERSISTENT_ANIMATION_STATES.find((s) => this.actions[s]) ?? null;
  }

  private crossFadeTo(next: AvatarAnimationState, duration: number) {
    const nextAction = this.actions[next];
    if (!nextAction) {
      console.warn(`[AvatarAnimationController] cannot play missing clip "${next}".`);
      return;
    }

    if (this.currentAction === nextAction) {
      // Re-requesting the exact same action: for a one-shot (LoopOnce)
      // temporary animation this should still restart it from frame 0
      // (e.g. the user clicks "Wave" again while already waving) - but
      // never an unnecessary reset for a persistent loop already playing.
      if (nextAction.loop === THREE.LoopOnce) {
        nextAction.reset().fadeIn(duration).play();
      }
      this.playingState = next;
      return;
    }

    const previous = this.currentAction;
    if (previous) previous.fadeOut(duration);
    nextAction.reset().setEffectiveWeight(1).fadeIn(duration).play();
    this.currentAction = nextAction;
    this.playingState = next;
  }

  /** Sets the persistent ("continuing") animation state - Idle/Work/Break/
   * Sleep. If a temporary one-shot animation is currently mid-playback,
   * this defers the actual crossfade: it only updates which state to
   * return to, and `handleActionFinished` picks up the (possibly new)
   * persistent state once the temporary animation naturally finishes -
   * so a background status change never interrupts an in-progress emote. */
  setAnimationState(state: AvatarAnimationState, duration = DEFAULT_CROSSFADE_SECONDS) {
    if (!isPersistent(state)) {
      console.warn(
        `[AvatarAnimationController] "${state}" is a temporary animation - use playTemporaryAnimation() instead.`
      );
      return;
    }
    // Explicitly requesting an animation state always leaves edit mode -
    // exitEditMode()'s own crossfade would be redundant with the one
    // crossFadeTo(state, ...) below does, so just clear the flag here.
    // enterEditMode() never touches persistentState/playingState (only the
    // mixer/skeleton), so "was this already the persistent+playing state"
    // must NOT be used to skip the crossfade when we were just frozen at
    // rest pose - that would leave the avatar stuck in bind pose forever.
    const wasInEditMode = this.editMode;
    this.editMode = false;
    const wasAlreadyThisPersistent = this.persistentState === state;
    this.persistentState = state;
    // Both early-returns below only apply when we were already animating -
    // coming out of edit mode must always fall through to crossFadeTo so
    // the frozen rest pose actually gets replaced.
    if (!wasInEditMode && isTemporary(this.playingState)) return; // resume into it once the temp anim finishes
    if (!wasInEditMode && wasAlreadyThisPersistent && this.playingState === state) return; // no redundant reset
    this.crossFadeTo(state, duration);
  }

  /** Plays a one-shot Wave/Celebrate/Stretch animation without changing
   * the persistent state - automatically crossfades back once finished. */
  playTemporaryAnimation(state: AvatarAnimationState, duration = DEFAULT_CROSSFADE_SECONDS) {
    if (!isTemporary(state)) {
      console.warn(
        `[AvatarAnimationController] "${state}" is a persistent animation - use setAnimationState() instead.`
      );
      return;
    }
    if (!this.actions[state]) {
      console.warn(
        `[AvatarAnimationController] clip "${state}" missing - staying on "${this.persistentState}".`
      );
      return;
    }
    this.editMode = false;
    this.crossFadeTo(state, duration);
  }

  private handleActionFinished(event: { action: THREE.AnimationAction }) {
    const finishedState = (Object.keys(this.actions) as AvatarAnimationState[]).find(
      (key) => this.actions[key] === event.action
    );
    // Only a temporary (LoopOnce) action reaching "finished" should trigger
    // a return - persistent LoopRepeat actions never fire this event.
    if (!finishedState || !isTemporary(finishedState)) return;
    this.crossFadeTo(this.persistentState, DEFAULT_CROSSFADE_SECONDS);
  }

  /** Freezes the avatar for editing: a STATIC pose, held with no further
   * animation playback (bug fix - editor rotation bug).
   *
   * This used to reset every SkinnedMesh to its raw bind/rest pose via
   * SkinnedMesh.pose(). That pose is NOT actually Y-up for this rig: the
   * GLB's Armature root node carries a baked +90 degree X-axis rotation (a
   * Blender->glTF axis-conversion artifact, confirmed by inspecting the
   * GLB's own node transforms), which every real AnimationClip's own
   * root-bone keyframes correctly compensate for - but the raw bind pose
   * (no clip applied) does not, since compensating for it is baked INTO
   * the clips, not the bind pose itself. Left in bind pose, the whole
   * character's head-to-foot axis actually runs along World Z, not World
   * Y (confirmed empirically: Hips/Chest/Neck/Head world positions all sat
   * near Y=0 with increasing Z). OrbitControls assumes World Y-up, so
   * orbiting a character whose true "up" is World Z produced exactly the
   * reported "lying on its side / tumbling" rotation - this was never an
   * OrbitControls or camera bug on its own.
   *
   * Fix: instead of the raw bind pose, evaluate the Idle clip at time 0
   * ONCE and hold that - a real static pose (no playback, satisfying "the
   * character must not move over time while editing"), but with the SAME
   * correct Y-up orientation every actual AnimationClip has (matching
   * exactly how DesktopAvatarScene - which never uses bind pose, always
   * plays Idle - already renders this same model correctly upright). Also
   * fixes a related, previously-patched-around symptom: the Head bone's
   * bind-pose orientation differed from its Idle orientation by ~90
   * degrees, which used to require Cosmetic Transform sub-mode to
   * specially exit edit mode just to preview accessory placement
   * correctly (see HairPaintPrototype's git history) - with edit mode
   * itself now Idle-oriented, that workaround is no longer needed.
   *
   * Falls back to the old SkinnedMesh.pose() only if this GLB somehow has
   * no Idle clip at all (defensive - Idle is required in practice). Never
   * touches morphTargetInfluences (a completely separate deformation
   * system from skinning) or geometry/material/mesh objects - user-set
   * Shape Key values and Paint Layer textures are untouched either way. */
  enterEditMode() {
    if (this.editMode) return;
    this.editMode = true;
    this.mixer.stopAllAction();
    this.currentAction = null;

    const idleAction = this.actions.Idle;
    if (idleAction) {
      idleAction.reset().play();
      idleAction.time = 0;
      this.mixer.update(0);
      idleAction.stop();
    } else {
      this.root.traverse((obj) => {
        const mesh = obj as THREE.SkinnedMesh;
        if (mesh.isSkinnedMesh) mesh.pose();
      });
    }
  }

  /** Resumes animation: crossfades from the current rest pose into the
   * persistent state (Idle if none was ever set - persistentState always
   * has a value by construction). */
  exitEditMode() {
    if (!this.editMode) return;
    this.editMode = false;
    this.crossFadeTo(this.persistentState, DEFAULT_CROSSFADE_SECONDS);
  }

  isInEditMode(): boolean {
    return this.editMode;
  }

  /** Call once per frame with the frame delta (seconds) - e.g. from
   * useFrame((_, delta) => controller.update(delta)). Never touches React
   * state, so driving this every frame does not cause component rerenders.
   * While in edit mode this deliberately does NOT call mixer.update() at
   * all, so nothing re-writes bone transforms after enterEditMode()'s
   * pose() reset - not merely "paused", but fully disconnected. */
  update(delta: number) {
    if (this.editMode) return;
    this.mixer.update(delta);
  }

  getDebugSnapshot(): AvatarAnimationDebugSnapshot {
    return {
      persistent: this.persistentState,
      playing: this.playingState,
      returnTo: this.persistentState,
      editMode: this.editMode,
    };
  }

  dispose() {
    this.mixer.removeEventListener("finished", this.onFinished);
    this.mixer.stopAllAction();
  }
}
