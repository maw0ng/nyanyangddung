"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { authService } from "./authService";

/**
 * Shared auth-session hook - used both by the Friends window (to decide
 * login-vs-friends-UI) and by DesktopAvatarScene (to decide whether/when
 * to push a public-profile sync). `session` starts `undefined` ("not yet
 * checked") to distinguish from `null` ("checked, definitely logged out")
 * - callers that only care about "logged in or not" can treat both
 * falsily, but this avoids a false flash of "logged out" UI before the
 * initial getSession() resolves.
 *
 * Cross-window: onAuthStateChange (see authService.ts) picks up sign-in/
 * out events that originate from ANOTHER window sharing the same origin
 * (e.g. logging in via the Friends window updates the Desktop window's
 * sync effect too), via supabase-js's own cross-tab storage listening.
 */
export function useAuthSession() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    authService.getSession().then((s) => {
      if (!cancelled) setSession(s);
    });
    const unsubscribe = authService.onAuthStateChange((s) => {
      if (!cancelled) setSession(s);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return {
    session: session ?? null,
    checked: session !== undefined,
    userId: session?.user.id ?? null,
  };
}
