import * as THREE from "three";
import { SkeletonUtils } from "three-stdlib";
import { collectMaterialTargets } from "../textureIO";
import { loadCosmeticTemplate } from "./cosmeticAssetLoader";
import type { CosmeticTransform } from "./cosmeticRegistry";

/**
 * One paintable (or color-only) material slot on the attached accessory
 * (section 8/13) - one entry per (mesh, materialIndex) pair, mirroring
 * TopsPaintScene's own per-material Surface concept (most accessories have
 * exactly one, but this stays generic for any future multi-material
 * cosmetic without a shape change).
 */
export interface CosmeticMaterialSurface {
  materialName: string;
  mesh: THREE.Mesh;
  materialIndex: number;
  /** Instance-owned clone (section 46/47's "다른 Avatar에 영향 주면 안
   * 된다" applied to cosmetics too) - safe to mutate `.map` freely. */
  material: THREE.MeshStandardMaterial;
  /** The ORIGINAL texture image, or null when this material has no base
   * color texture at all (section 13 - cat_ears/bear_ears in this GLB set
   * are exactly this case, confirmed by inspecting their glTF JSON). */
  originalImage: CanvasImageSource | null;
  originalColor: THREE.Color;
  hasUV: boolean;
}

export interface CosmeticAttachmentResult {
  attachmentRoot: THREE.Group;
  accessoryScene: THREE.Group;
  meshes: THREE.Mesh[];
  surfaces: CosmeticMaterialSurface[];
  hasArmature: boolean;
  hasAnyUV: boolean;
  materialNames: string[];
}

/** Finds a bone/node by exact name anywhere under `root` (section 4) -
 * never assumes a fixed index/path, matching this project's existing
 * "runtime-verified name, never hardcoded structure" convention
 * (ToonStyleController/collectMaterialTargets already do the same). */
export function findBone(root: THREE.Object3D, boneName: string): THREE.Object3D | null {
  return root.getObjectByName(boneName) ?? null;
}

export function applyCosmeticTransform(root: THREE.Object3D, t: CosmeticTransform) {
  root.position.set(t.position[0], t.position[1], t.position[2]);
  root.rotation.set(t.rotation[0], t.rotation[1], t.rotation[2]);
  root.scale.set(t.scale[0], t.scale[1], t.scale[2]);
}

export function readCosmeticTransform(root: THREE.Object3D): CosmeticTransform {
  return {
    position: [root.position.x, root.position.y, root.position.z],
    rotation: [root.rotation.x, root.rotation.y, root.rotation.z],
    scale: [root.scale.x, root.scale.y, root.scale.z],
  };
}

/**
 * Clones the cosmetic's own scene graph (SkeletonUtils.clone - section 4/6,
 * preserves its own Armature/bones/skinning/UV/materials completely
 * untouched in structure) and parents it under a NEW AttachmentRoot Group,
 * which is itself parented under `headBone` - exactly the
 * `Head -> AttachmentRoot -> accessory Armature + SkinnedMesh` shape
 * section 1 asks for. User-adjusted transform is applied to
 * AttachmentRoot only, never to the accessory's own internal Armature
 * (section 4's explicit "GLB 내부 Armature에 직접 적용하지 말고").
 *
 * Never mutates the cached template (loadCosmeticTemplate) - every mesh's
 * material is cloned per attachment instance before anything touches it.
 */
export async function attachCosmetic(
  headBone: THREE.Object3D,
  assetPath: string,
  defaultTransform: CosmeticTransform
): Promise<CosmeticAttachmentResult> {
  const template = await loadCosmeticTemplate(assetPath);
  const accessoryScene = SkeletonUtils.clone(template.scene) as THREE.Group;

  let hasArmature = false;
  accessoryScene.traverse((obj) => {
    if ((obj as THREE.Bone).isBone) hasArmature = true;
  });

  const meshes: THREE.Mesh[] = [];
  const surfaces: CosmeticMaterialSurface[] = [];
  const materialNameSet = new Set<string>();
  let hasAnyUV = false;

  for (const target of collectMaterialTargets(accessoryScene)) {
    if (!meshes.includes(target.mesh)) {
      meshes.push(target.mesh);
      // A SkinnedMesh's default frustum-culling bounding sphere is computed
      // from its raw BIND-POSE-LOCAL geometry, never updated for where
      // skinning/the live bone hierarchy actually places it in world space
      // (a well-known three.js gotcha) - since every cosmetic's real
      // position comes entirely from the Head-bone-driven AttachmentRoot
      // chain (section 1/4), that local bounding sphere is meaningless for
      // culling here and can incorrectly hide an on-screen accessory
      // depending on camera framing (confirmed: visible in the Editor's
      // Bounds-fit camera, invisible under Desktop's fixed camera). Always
      // render cosmetic meshes regardless of Three.js's own (unreliable)
      // culling test - they're small, so the cost is negligible.
      target.mesh.frustumCulled = false;
    }
    const original = target.material as THREE.MeshStandardMaterial;
    const materialName = original.name || `material_${target.materialIndex}`;
    materialNameSet.add(materialName);

    const cloned = original.clone() as THREE.MeshStandardMaterial;
    if (Array.isArray(target.mesh.material)) {
      const next = target.mesh.material.slice();
      next[target.materialIndex] = cloned;
      target.mesh.material = next;
    } else {
      target.mesh.material = cloned;
    }

    const hasUV = !!target.mesh.geometry.getAttribute("uv");
    if (hasUV) hasAnyUV = true;

    surfaces.push({
      materialName,
      mesh: target.mesh,
      materialIndex: target.materialIndex,
      material: cloned,
      originalImage: (original.map?.image as CanvasImageSource | undefined) ?? null,
      originalColor: original.color ? original.color.clone() : new THREE.Color(0xffffff),
      hasUV,
    });
  }

  const attachmentRoot = new THREE.Group();
  attachmentRoot.name = "CosmeticAttachmentRoot";
  applyCosmeticTransform(attachmentRoot, defaultTransform);
  attachmentRoot.add(accessoryScene);
  headBone.add(attachmentRoot);

  return {
    attachmentRoot,
    accessoryScene,
    meshes,
    surfaces,
    hasArmature,
    hasAnyUV,
    materialNames: Array.from(materialNameSet),
  };
}

/** Removes the attachment from the Head bone and disposes only the
 * instance-owned cloned materials created in attachCosmetic above - never
 * the cached template's geometry/textures (section 20/35/43 - other/future
 * attachments of the same cosmetic still need them). */
export function detachCosmetic(result: CosmeticAttachmentResult | null) {
  if (!result) return;
  result.attachmentRoot.parent?.remove(result.attachmentRoot);
  for (const surface of result.surfaces) {
    surface.material.dispose();
  }
}
