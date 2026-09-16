/**
 * Dev-only lifecycle logging - one shared gate so every CharacterPreset/
 * CoWork/Appearance lifecycle checkpoint in the app uses the identical
 * "skip in production" check, rather than every call site repeating
 * `process.env.NODE_ENV` itself. Standard Next.js production builds
 * (including the packaged Electron app, which runs the same `next build`
 * output - see next.config.mjs's ELECTRON_BUILD branch) set NODE_ENV to
 * "production", so this is silent in anything a real user runs.
 *
 * Callers must only ever pass small scalars (ids, counts, revisions,
 * booleans) - never paint Blobs/CanvasTexture pixels, Supabase access
 * tokens, emails, or any other sensitive or large payload.
 */
export function devLog(...args: unknown[]) {
  if (process.env.NODE_ENV === "production") return;
  console.log(...args);
}
