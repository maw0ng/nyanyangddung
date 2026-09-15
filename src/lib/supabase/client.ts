"use client";

/**
 * Supabase browser client - a lazy singleton, never a service_role key
 * (section 2: only NEXT_PUBLIC_* values, safe to ship in a client bundle).
 *
 * `getSupabaseClient()` returns `null` when the app hasn't been configured
 * with real Supabase credentials yet (missing env vars) - EVERY caller in
 * this codebase must treat that as "account features unavailable", never
 * throw or crash the Desktop Pet over it (section 11 - offline/
 * unconfigured-first). This is also what makes the app safe to build/run
 * without a Supabase project at all - the account/friend system degrades
 * to "please configure Supabase" rather than a hard failure.
 *
 * Session persistence: `persistSession: true` (the default) uses
 * `window.localStorage`, which is exactly what makes auth survive an
 * Electron app restart - see electron/staticServer.ts's fixed-port fix,
 * which is what keeps that localStorage's ORIGIN stable across launches
 * in the packaged app. `detectSessionInUrl: false` because this app never
 * does an OAuth-redirect flow (email+password only, section 3) and the
 * Desktop/Editor/Friends windows' URLs should never be parsed for auth
 * tokens.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function isSupabaseConfigured(): boolean {
  return !!SUPABASE_URL && !!SUPABASE_ANON_KEY;
}

// Deliberately NOT `createClient<Database>` - passing this project's hand-
// written Database type as supabase-js's generic was found to make its
// OWN internal conditional types collapse to `never` for .update()/.rpc()/
// certain .select() results (a known class of gotcha when a hand-rolled
// schema type doesn't structurally match what a given supabase-js version
// expects down to the last generic parameter). Since this project never
// ran Supabase's own `gen types` against a live project, callers instead
// type each query's result explicitly at the call site (see
// profileService.ts/friendService.ts) using the plain Row/RPC types from
// database.types.ts - equally type-safe at the boundary that matters
// (this service layer's own exported function signatures), without
// fighting the client generic.
let client: SupabaseClient | null | undefined;

export function getSupabaseClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    client = null;
    return client;
  }
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return client;
}
