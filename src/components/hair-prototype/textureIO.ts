import * as THREE from "three";

/**
 * Shared texture import/export utilities used by every paint target
 * (Hair/Face-base/Face-eye/Tops). Pure functions only - no target-specific
 * state lives here, so extending to Bottom/Shoes later is just calling
 * these again with a different geometry/canvas.
 */

export interface MaterialTarget {
  mesh: THREE.Mesh;
  material: THREE.Material;
  materialIndex: number;
}

/**
 * Walks a node's whole subtree and returns every (mesh, material) pair it
 * finds - one entry per material even when a mesh has a material array.
 * Multi-primitive glTF meshes load as a Group of sibling Meshes (verified
 * at runtime against this exact GLB - see FacePaintScene's console report),
 * so this has to traverse rather than assume the root itself is the Mesh.
 */
export function collectMaterialTargets(root: THREE.Object3D): MaterialTarget[] {
  const results: MaterialTarget[] = [];
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    materials.forEach((material, materialIndex) => {
      results.push({ mesh, material, materialIndex });
    });
  });
  return results;
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("canvas.toBlob failed"));
    }, "image/png");
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function downloadCanvasAsPng(
  canvas: HTMLCanvasElement,
  filename: string
) {
  const blob = await canvasToPngBlob(canvas);
  downloadBlob(blob, filename);
}

export async function loadImageBitmapFromBlob(
  blob: Blob
): Promise<ImageBitmap> {
  return createImageBitmap(blob);
}

/** Draws a source image onto a fresh canvas at the given size (no flip). */
export function imageToCanvas(
  image: CanvasImageSource,
  width: number,
  height: number
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(image, 0, 0, width, height);
  return canvas;
}

export interface ImageSizeCheck {
  width: number;
  height: number;
  recommendedWidth: number;
  recommendedHeight: number;
  matchesExactly: boolean;
  aspectMismatch: boolean;
}

export function validateImageSize(
  image: { width: number; height: number },
  recommendedWidth: number,
  recommendedHeight: number
): ImageSizeCheck {
  const matchesExactly =
    image.width === recommendedWidth && image.height === recommendedHeight;
  const uploadedRatio = image.width / image.height;
  const recommendedRatio = recommendedWidth / recommendedHeight;
  const aspectMismatch = Math.abs(uploadedRatio - recommendedRatio) > 0.01;
  return {
    width: image.width,
    height: image.height,
    recommendedWidth,
    recommendedHeight,
    matchesExactly,
    aspectMismatch,
  };
}

/**
 * Renders a transparent-background UV wireframe for the given geometry.
 * `flipY` must match the target's own paint-canvas convention (true for
 * HairCanvas, false for Face/Tops which follow glTF's flipY=false texture
 * orientation) so the guide overlays pixel-for-pixel with the paint/current
 * texture PNGs from the same target.
 *
 * Triangles whose UVs span more than `seamThreshold` in either axis are
 * skipped entirely (not just the crossing edge) - they only appear that
 * wide because the chart wraps across the 0/1 seam, and drawing them would
 * put a bogus line straight across the canvas. This mirrors the seam guard
 * MiniWaffleHairScene already uses for live painting.
 */
export function generateUVGuideCanvas(
  geometry: THREE.BufferGeometry,
  size: number,
  options?: { flipY?: boolean; lineColor?: string; seamThreshold?: number }
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);

  const uvAttr = geometry.getAttribute("uv");
  if (!uvAttr) return canvas;

  const flipY = options?.flipY ?? false;
  const seamThreshold = options?.seamThreshold ?? 0.5;
  ctx.strokeStyle = options?.lineColor ?? "rgba(0, 220, 255, 0.9)";
  ctx.lineWidth = 1;

  const toPoint = (vertexIndex: number) => {
    const u = uvAttr.getX(vertexIndex);
    const v = uvAttr.getY(vertexIndex);
    return {
      u,
      v,
      x: u * size,
      y: (flipY ? 1 - v : v) * size,
    };
  };

  const drawTriangle = (a: number, b: number, c: number) => {
    const p0 = toPoint(a);
    const p1 = toPoint(b);
    const p2 = toPoint(c);
    const spanU =
      Math.max(p0.u, p1.u, p2.u) - Math.min(p0.u, p1.u, p2.u);
    const spanV =
      Math.max(p0.v, p1.v, p2.v) - Math.min(p0.v, p1.v, p2.v);
    if (spanU > seamThreshold || spanV > seamThreshold) return;

    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.closePath();
    ctx.stroke();
  };

  const index = geometry.index;
  if (index) {
    for (let i = 0; i + 2 < index.count; i += 3) {
      drawTriangle(index.getX(i), index.getX(i + 1), index.getX(i + 2));
    }
  } else {
    for (let i = 0; i + 2 < uvAttr.count; i += 3) {
      drawTriangle(i, i + 1, i + 2);
    }
  }

  return canvas;
}
