/**
 * Serves the statically-exported Next.js app (out-electron/, produced by
 * `next build` with ELECTRON_BUILD=true - see next.config.mjs) over a
 * real local http:// origin instead of loading it via file://.
 *
 * This matters because Next.js's static export emits root-absolute asset
 * paths (/_next/static/..., the GLB under /models/...) that resolve fine
 * under http://localhost but NOT under file:// (there is no "domain root"
 * for a filesystem path, so file:///_next/... looks in the wrong place).
 * A tiny built-in-only file server sidesteps that entirely - no extra
 * dependency (just Node's http/fs/path), and it only ever runs in the
 * packaged production app.
 *
 * PORT (section "Desktop 앱에서 인증 유지" of the account/friend-system
 * brief): pinned to a fixed, app-specific port rather than an OS-assigned
 * random one. Supabase's browser client persists auth sessions in
 * localStorage, which is scoped by ORIGIN (protocol+host+port) - an
 * OS-assigned random port would give this server a DIFFERENT origin on
 * every single app launch, silently breaking session persistence (and,
 * less obviously, CharacterPreset/Timer/Profile IndexedDB persistence too)
 * the moment the app is packaged and actually installed, even though this
 * never showed up in dev (`isDev` always uses the fixed
 * http://localhost:3000 dev-server URL instead of this file). Falls back
 * to an OS-assigned port only if the fixed one is genuinely unavailable
 * (e.g. another instance of this exact app already running) - a rare,
 * graceful degradation rather than a hard launch failure.
 */
import { createServer, type Server } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/** Arbitrary, unlikely-to-collide fixed port for this app's own static
 * server - deliberately not a well-known port. */
const PREFERRED_PORT = 47821;

function resolveFilePath(rootDir: string, urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split("?")[0] || "/");
  const safeRelative = normalize(decoded).replace(/^([./\\]+)+/, "");
  let filePath = join(rootDir, safeRelative);

  // Directory-style routes exported by Next (trailingSlash:true) map to
  // <route>/index.html.
  if (!extname(filePath)) {
    const indexCandidate = join(filePath, "index.html");
    if (existsSync(indexCandidate)) return indexCandidate;
    const htmlCandidate = `${filePath}.html`;
    if (existsSync(htmlCandidate)) return htmlCandidate;
    return null;
  }

  return existsSync(filePath) && statSync(filePath).isFile() ? filePath : null;
}

function listenOnPort(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    function onError(err: NodeJS.ErrnoException) {
      server.off("listening", onListening);
      reject(err);
    }
    function onListening() {
      server.off("error", onError);
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : port);
    }
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

/** Starts the static server, preferring PREFERRED_PORT so the app's origin
 * (and therefore localStorage/IndexedDB) stays identical across launches -
 * falls back to an OS-assigned free port only if that fixed port is
 * unavailable. Resolves once actually listening. */
export async function startStaticServer(rootDir: string): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((req, res) => {
    const filePath = resolveFilePath(rootDir, req.url ?? "/");
    if (!filePath) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = extname(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream" });
    createReadStream(filePath).pipe(res);
  });

  let port: number;
  try {
    port = await listenOnPort(server, PREFERRED_PORT);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EADDRINUSE") throw err;
    // Rare fallback - e.g. another instance of this app is already
    // running on PREFERRED_PORT. Session/IndexedDB persistence may not
    // survive this particular relaunch, but the app must still start.
    port = await listenOnPort(server, 0);
  }

  return { server, baseUrl: `http://127.0.0.1:${port}` };
}
