/**
 * Single source of truth for the miniWaffle GLB path. MiniWaffleHairScene,
 * FacePaintScene, TopsPaintScene, ToonStyleController, and
 * AvatarAnimationScene each call `useGLTF(MODEL_URL)` independently -
 * drei caches by URL string, so as long as they all import the exact same
 * constant they all receive the identical cached `{ scene, animations }`
 * object (this is what lets FacePaintScene's material mutations show up
 * in MiniWaffleHairScene's `<primitive object={gltf.scene}>` render, and
 * now lets AvatarAnimationScene's AnimationMixer drive the very same bones
 * those meshes are skinned to).
 */
export const MODEL_URL = "/models/miniwaffle_web_animated3.glb";
