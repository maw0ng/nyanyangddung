import * as THREE from "three";
import { GLTFLoader } from "three-stdlib";
import { MODEL_URL } from "../../hair-prototype/modelConfig";

/**
 * Loads the SAME miniWaffle GLB Local's pipeline uses, but through a
 * genuinely SEPARATE GLTFLoader parse rather than drei's `useGLTF(MODEL_URL)`
 * cache - deliberately, not by oversight. `useGLTF` returns the exact same
 * live `{scene, animations}` object to every caller, and Local's own
 * MiniWaffleHairScene/FacePaintScene/TopsPaintScene/ToonStyleController
 * mutate THAT shared scene's materials/HairCanvas texture/toon-wrapping
 * directly, in place, at unpredictable effect-timing. Cloning from that
 * live object would make a Remote Avatar's "default appearance" depend on
 * exactly when the clone happened to run relative to Local's own mutations
 * - a race, not a guarantee (sections 5/37/38/39 require Remote to be
 * reliably decoupled from Local's paint/toon state, not "usually" decoupled).
 *
 * This module's own parse is never touched by anything else in the app, so
 * every RemoteAvatarInstance clone drawn from it is guaranteed pristine
 * regardless of Local's state or mount order.
 *
 * Memoized as a single module-level promise (section 36) - however many
 * remote participants exist, this GLTFLoader.loadAsync() call happens
 * AT MOST ONCE per app session; the browser's own HTTP cache additionally
 * means this second parse essentially never re-fetches the .glb bytes over
 * the network either (same URL, already cached from Local's own
 * useGLTF.preload() calls).
 */
export interface RemoteAvatarTemplate {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

let templatePromise: Promise<RemoteAvatarTemplate> | null = null;

export function loadRemoteAvatarTemplate(): Promise<RemoteAvatarTemplate> {
  if (!templatePromise) {
    const loader = new GLTFLoader();
    templatePromise = loader.loadAsync(MODEL_URL).then((gltf) => ({
      scene: gltf.scene,
      animations: gltf.animations,
    }));
  }
  return templatePromise;
}
