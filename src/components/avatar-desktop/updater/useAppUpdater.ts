"use client";

import { useCallback, useEffect, useState } from "react";

const IDLE_STATE: UpdateState = {
  status: "idle",
  currentVersion: "",
  availableVersion: null,
  progressPercent: null,
  errorMessage: null,
};

/**
 * Thin renderer-side wrapper over window.desktopAPI's updater methods
 * (electron/updater.ts owns all real state/logic - section 16). Absent
 * entirely outside Electron (plain browser `/desktop` preview) or in
 * development, in which case this just stays at IDLE_STATE forever and
 * `checkForUpdates`/`installUpdate` are harmless no-ops - the SAME
 * `window.desktopAPI?.` optional-chaining convention every other Desktop
 * hook in this app already uses.
 */
export function useAppUpdater() {
  const [state, setState] = useState<UpdateState>(IDLE_STATE);

  useEffect(() => {
    if (!window.desktopAPI?.onUpdateStatus) return;
    window.desktopAPI
      .getUpdateState()
      .then(setState)
      .catch(() => {});
    return window.desktopAPI.onUpdateStatus(setState);
  }, []);

  const checkForUpdates = useCallback(() => {
    void window.desktopAPI
      ?.checkForUpdates()
      .then((s) => s && setState(s))
      .catch(() => {});
  }, []);

  const installUpdate = useCallback(() => {
    void window.desktopAPI?.installUpdate().catch(() => {});
  }, []);

  return { state, checkForUpdates, installUpdate };
}
