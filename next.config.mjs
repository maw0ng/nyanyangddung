/**
 * ELECTRON_BUILD=true switches `next build` to a static export (into
 * out-electron/) so the packaged desktop app can load it without running a
 * Node server - used ONLY by `npm run desktop:build` (see package.json).
 * The regular `npm run build`/`npm run start` web flow is completely
 * unaffected: without that env var this config is identical to before.
 */
const isElectronBuild = process.env.ELECTRON_BUILD === "true";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ...(isElectronBuild
    ? {
        output: "export",
        distDir: "out-electron",
        trailingSlash: true,
      }
    : {}),
};

export default nextConfig;
