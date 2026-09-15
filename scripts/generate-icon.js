/**
 * Generates the Windows multi-resolution build/icon.ico from the app's one
 * approved source icon, build/icon.png (transparent, low-poly cat paw -
 * never touched/replaced by this script, and never regenerated with a
 * different design - see docs/RELEASING.md). Run manually
 * (`npm run icon:generate`) only when build/icon.png itself is intentionally
 * replaced; NOT part of the normal desktop:build pipeline, since the source
 * PNG changes essentially never.
 *
 * The source PNG isn't a perfect square (1326x1187) - each ICO frame is
 * inherently square, so this contain-fits the source into a transparent
 * square canvas (centered, never stretched/cropped) before downscaling to
 * every size Windows actually uses: taskbar/shortcut/exe/installer/
 * uninstaller all read from this same multi-size .ico (electron-builder's
 * `win.icon` - see package.json's `build` config).
 */
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const SOURCE = path.join(__dirname, "..", "build", "icon.png");
const OUTPUT = path.join(__dirname, "..", "build", "icon.ico");
const SIZES = [256, 128, 64, 48, 32, 24, 16];

/** Minimal, dependency-free ICO container writer - each frame is embedded
 * as a plain PNG (valid since Windows Vista, and what every modern icon
 * tool does for sizes >= 16px), so this needs no BMP/DIB encoding at all. */
function buildIco(pngBuffers) {
  const count = pngBuffers.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dataOffset0 = headerSize + dirEntrySize * count;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(count, 4);

  const dirEntries = [];
  const dataChunks = [];
  let offset = dataOffset0;
  for (const { size, buffer } of pngBuffers) {
    const entry = Buffer.alloc(dirEntrySize);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height (0 = 256)
    entry.writeUInt8(0, 2); // color palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(buffer.length, 8); // data size
    entry.writeUInt32LE(offset, 12); // data offset
    dirEntries.push(entry);
    dataChunks.push(buffer);
    offset += buffer.length;
  }

  return Buffer.concat([header, ...dirEntries, ...dataChunks]);
}

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`[generate-icon] source not found: ${SOURCE}`);
    process.exit(1);
  }

  const source = sharp(SOURCE);
  const meta = await source.metadata();
  const side = Math.max(meta.width, meta.height);

  // Contain-fit the source into a transparent square canvas once, at full
  // resolution - every downscale below starts from this SAME square buffer,
  // so every frame shares identical proportions/centering.
  const squared = await sharp(SOURCE)
    .resize(side, side, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const frames = [];
  for (const size of SIZES) {
    const buffer = await sharp(squared)
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    frames.push({ size, buffer });
  }

  fs.writeFileSync(OUTPUT, buildIco(frames));
  console.log(`[generate-icon] wrote ${OUTPUT} (${SIZES.join(", ")}px, from ${meta.width}x${meta.height} source)`);
}

main().catch((err) => {
  console.error("[generate-icon] failed:", err);
  process.exit(1);
});
