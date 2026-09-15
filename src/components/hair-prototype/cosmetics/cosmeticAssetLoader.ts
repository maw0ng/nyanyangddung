import * as THREE from "three";
import { GLTFLoader } from "three-stdlib";

/**
 * Loads a cosmetic accessory GLB through its own independent GLTFLoader
 * parse, memoized per `assetPath` (section 20 - never re-downloaded once
 * cached, for however many times an accessory is equipped/re-equipped or
 * however many AvatarInstances eventually need the same cosmetic).
 *
 * Deliberately mirrors
 * ../../avatar-desktop/cowork/remoteAvatarLoader.ts's exact pattern
 * (same reasoning: every consumer that needs its OWN independent,
 * never-mutated-by-anyone-else scene graph clones FROM this cached
 * template via SkeletonUtils.clone - see cosmeticAttachment.ts - rather
 * than sharing one live, mutable instance across Editor/Desktop/future
 * Remote). Reusing this project's own already-established loader pattern
 * instead of inventing a second one.
 */
export interface CosmeticTemplate {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

const templateCache = new Map<string, Promise<CosmeticTemplate>>();

export function loadCosmeticTemplate(assetPath: string): Promise<CosmeticTemplate> {
  let cached = templateCache.get(assetPath);
  if (!cached) {
    const loader = new GLTFLoader();
    cached = loader.loadAsync(assetPath).then((gltf) => ({ scene: gltf.scene, animations: gltf.animations }));
    templateCache.set(assetPath, cached);
  }
  return cached;
}
