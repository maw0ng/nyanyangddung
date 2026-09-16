import * as THREE from "three";
import { effectiveFloor, getGradientMap, type MaterialCategory, type ToonSettings } from "./toonStyle";

/**
 * Builds the Toon-styled variant of an existing material without ever
 * mutating the source material - the caller keeps the original reference
 * around and swaps `mesh.material` back to it whenever Toon is turned OFF
 * (see ToonStyleController). Reuses the source's own `.map` reference
 * (never clones/copies texture pixels), so when the Painting engines call
 * `texture.needsUpdate = true` on that same Texture object, the Toon
 * material picks it up automatically - no resync step needed.
 */
/** HairCanvas is a transparent-background decal wrapping the whole head
 * (no opaque base texture of its own - see LayerStackEngine's `null`
 * original in MiniWaffleHairScene.tsx), so it only ever looks right with
 * these exact material flags. Local's own raw material already carries
 * them (MiniWaffleHairScene.tsx's wiring effect sets them directly on the
 * source material before Toon ever wraps it), so enforcing them here again
 * is a no-op for Local. Remote's raw material (remoteAvatarLoader.ts's
 * plain GLTFLoader parse) never goes through that wiring effect at all, so
 * without this, `createToonMaterial` copied the GLB's own defaults -
 * transparent:false/depthWrite:true/side:FrontSide - straight onto the
 * Remote Hair material, rendering its "empty" (alpha=0) UV regions as an
 * OPAQUE flat-color dome instead of see-through (the reported "gray
 * blob"/"transparency not applied" bug). Centralizing the override here,
 * in the one function both Local (via ToonStyleController) and Remote (via
 * RemoteAvatarInstance) call to build their Hair Toon material, is what
 * actually makes this a single shared pipeline instead of two Hair
 * implementations that can silently drift apart again. */
const HAIR_MATERIAL_OVERRIDES = {
  transparent: true,
  alphaTest: 0.02,
  depthWrite: false,
  side: THREE.DoubleSide,
} as const;

export function createToonMaterial(
  source: THREE.Material,
  category: MaterialCategory,
  settings: ToonSettings
): THREE.MeshToonMaterial {
  const std = source as THREE.MeshStandardMaterial;
  const floor = effectiveFloor(category, settings.shadowStrength);
  const gradientMap = getGradientMap(settings.shadeSteps, floor);
  const isHair = category === "hair";
  const toon = new THREE.MeshToonMaterial({
    map: std.map ?? null,
    color: std.color ? std.color.clone() : new THREE.Color(0xffffff),
    transparent: isHair ? HAIR_MATERIAL_OVERRIDES.transparent : !!std.transparent,
    opacity: std.opacity ?? 1,
    alphaTest: isHair ? HAIR_MATERIAL_OVERRIDES.alphaTest : std.alphaTest ?? 0,
    side: isHair ? HAIR_MATERIAL_OVERRIDES.side : std.side ?? THREE.FrontSide,
    depthWrite: isHair ? HAIR_MATERIAL_OVERRIDES.depthWrite : std.depthWrite ?? true,
    gradientMap,
  });
  // Keep the exact same name as the source material (not a "__toon"
  // suffix) - FacePaintScene/TopsPaintScene look meshes up again by
  // material NAME ("base"/"eye"/the Tops material's own name) whenever
  // their discovery effect re-runs (e.g. React Fast Refresh in dev), and
  // must still find them even if Toon has already swapped the material.
  toon.name = source.name;
  toon.userData.toonCategory = category;
  return toon;
}

/** Refresh an existing Toon material in place when shadeSteps/shadowStrength
 * change - avoids rebuilding (and re-touching `.map`) on every slider tick. */
export function updateToonMaterial(
  toon: THREE.MeshToonMaterial,
  category: MaterialCategory,
  settings: ToonSettings
) {
  const floor = effectiveFloor(category, settings.shadowStrength);
  toon.gradientMap = getGradientMap(settings.shadeSteps, floor);
  toon.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Outline (inverted-hull). One shared material for every outlined mesh
// (cheaper than a material per mesh, and keeps the eventual "many
// characters on screen" cost to one extra draw call per outlined submesh,
// not one extra shader program per character - section 45).
// ---------------------------------------------------------------------------

interface OutlineShaderRef {
  uniforms: {
    outlineWidth: { value: number };
    outlineColor: { value: THREE.Color };
  };
}

export interface OutlineMaterialHandle {
  material: THREE.MeshStandardMaterial;
  setWidth: (w: number) => void;
  setColor: (c: THREE.Color) => void;
  setOpacity: (o: number) => void;
}

/**
 * The outline is a copy of each mesh rendered back-face-only, pushed
 * outward along its vertex normal by `outlineWidth` in the vertex shader -
 * the classic "inverted hull" technique. Built on MeshStandardMaterial
 * (not MeshBasicMaterial) specifically because its shader chunk set always
 * includes the skinning/morph-target normal & position chunks regardless
 * of object flags, so the same onBeforeCompile patch works correctly for
 * both skinned+morphed meshes (Body, Tops) and plain ones. The fragment
 * patch forces a flat, unlit output color so scene lighting never tints
 * the silhouette.
 */
export function createOutlineMaterial(
  width: number,
  color: THREE.Color,
  opacity: number
): OutlineMaterialHandle {
  const material = new THREE.MeshStandardMaterial({
    color,
    side: THREE.BackSide,
    transparent: opacity < 1,
    opacity,
    depthWrite: true,
  });

  let shaderRef: OutlineShaderRef | null = null;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.outlineWidth = { value: width };
    shader.uniforms.outlineColor = { value: color.clone() };
    shader.vertexShader =
      `uniform float outlineWidth;\n${shader.vertexShader}`.replace(
        "#include <project_vertex>",
        "transformed += normalize( objectNormal ) * outlineWidth;\n#include <project_vertex>"
      );
    shader.fragmentShader =
      `uniform vec3 outlineColor;\n${shader.fragmentShader}`.replace(
        "#include <dithering_fragment>",
        "gl_FragColor = vec4( outlineColor, gl_FragColor.a );\n#include <dithering_fragment>"
      );
    shaderRef = shader as unknown as OutlineShaderRef;
  };

  return {
    material,
    setWidth: (w) => {
      if (shaderRef) shaderRef.uniforms.outlineWidth.value = w;
    },
    setColor: (c) => {
      if (shaderRef) shaderRef.uniforms.outlineColor.value.copy(c);
    },
    setOpacity: (o) => {
      material.opacity = o;
      material.transparent = o < 1;
    },
  };
}

/**
 * Creates the inverted-hull outline mesh for `sourceMesh`, sharing its
 * geometry (no vertex data duplicated) and - for skinned meshes - its
 * Skeleton object and live morphTargetInfluences array by reference, so
 * the hull deforms identically to the source mesh every frame with no
 * extra per-frame sync code. Added as a sibling under the same parent.
 */
export function createOutlineMesh(sourceMesh: THREE.Mesh, material: THREE.Material): THREE.Mesh {
  const isSkinned = (sourceMesh as THREE.SkinnedMesh).isSkinnedMesh;
  let outline: THREE.Mesh;
  if (isSkinned) {
    const sm = sourceMesh as THREE.SkinnedMesh;
    const skinned = new THREE.SkinnedMesh(sourceMesh.geometry, material);
    skinned.bind(sm.skeleton, sm.bindMatrix);
    outline = skinned;
  } else {
    outline = new THREE.Mesh(sourceMesh.geometry, material);
  }
  if (sourceMesh.morphTargetDictionary) {
    outline.morphTargetDictionary = sourceMesh.morphTargetDictionary;
    outline.morphTargetInfluences = sourceMesh.morphTargetInfluences;
  }
  outline.name = `${sourceMesh.name || "mesh"}__outline`;
  outline.frustumCulled = false;
  outline.renderOrder = (sourceMesh.renderOrder ?? 0) + 1;
  sourceMesh.parent?.add(outline);
  return outline;
}
