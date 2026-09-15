/**
 * Windows foreground-window / running-app detection for the "프로그램 연동
 * 타이머" feature. Deliberately implemented with zero new npm dependencies:
 * shells out to `powershell.exe` (always present on Windows 10/11) rather
 * than adding a native Node addon. A native module would have to be
 * rebuilt per Electron ABI (electron-rebuild) and re-verified on every
 * Electron upgrade - exactly the "production build에서 깨지는 패키지" risk
 * the brief warns against (section 15) - while a plain child_process call
 * has no Electron-version coupling at all.
 *
 * Privacy (section 16): only processName/executablePath/a friendly
 * displayName (from the exe's own FileDescription metadata) and pid are
 * ever read. Window titles are never requested or stored anywhere in this
 * file - a title can contain document names/content, which the brief
 * explicitly forbids persisting.
 */
import { execFile } from "node:child_process";
import path from "node:path";

const POWERSHELL_TIMEOUT_MS = 3000;

/** Mirrors src/components/avatar-desktop/timer/timerTypes.ts's
 * ForegroundAppInfo. Duplicated rather than imported: electron/'s
 * tsconfig.json scopes `rootDir` to this folder (see desktopWindowConfig.ts
 * vs desktopCameraConfig.ts for the same existing electron/src split), so
 * main-process code never imports across that boundary - preload.ts's IPC
 * call is the only bridge, and its return value is plain JSON either way. */
export interface ForegroundAppInfo {
  pid: number;
  processName: string;
  executablePath: string | null;
  displayName: string;
}

/** Common Windows shell/system window hosts that are never a real "app the
 * user is working in" - kept short and conservative rather than an
 * exhaustive denylist (section 11 of the original desktop-interaction
 * brief already established this project's "don't over-engineer" norm). */
const SYSTEM_PROCESS_DENYLIST = new Set([
  "applicationframehost",
  "shellexperiencehost",
  "startmenuexperiencehost",
  "searchhost",
  "searchapp",
  "textinputhost",
  "systemsettings",
  "lockapp",
  "dwm",
  "sihost",
]);

/** PowerShell 5.1's default console output encoding on a non-English
 * Windows install (e.g. Korean) is the legacy OEM/ANSI codepage, not UTF-8 -
 * without forcing it, any non-ASCII character in a FileDescription (a
 * Korean app's display name, or a username with Korean characters
 * appearing in its executablePath) comes back from execFile's UTF-8-
 * decoded stdout as mangled replacement characters, silently corrupting
 * both the picker list and the identity later matched against in
 * TimerEngine.reportForegroundApp. Verified against this project's actual
 * installed PowerShell by round-tripping a Korean string through both
 * paths - only present with this line first. */
const FORCE_UTF8_STDOUT = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;";

function runPowerShell(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(`${FORCE_UTF8_STDOUT}\n${script}`, "utf16le").toString("base64");
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { timeout: POWERSHELL_TIMEOUT_MS, windowsHide: true, encoding: "utf8" },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      }
    );
  });
}

const WIN32_HELPER_TYPE = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MiniWaffleWin32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@ -ErrorAction SilentlyContinue
`;

function toAppInfo(row: {
  pid?: number;
  processName?: string;
  executablePath?: string | null;
  displayName?: string;
}): ForegroundAppInfo | null {
  if (!row || typeof row.pid !== "number" || !row.processName) return null;
  return {
    pid: row.pid,
    processName: row.processName,
    executablePath: row.executablePath ?? null,
    displayName: row.displayName || row.processName,
  };
}

/** The current Windows foreground window's owning process, or null if it
 * can't be determined (never thrown to the caller - see main.ts's IPC
 * handler, which treats a rejected/failed lookup identically to null so
 * TimerEngine correctly falls back to autoPaused rather than guessing
 * "still running", section 41). */
export async function getForegroundApp(): Promise<ForegroundAppInfo | null> {
  if (process.platform !== "win32") return null;
  const script = `
${WIN32_HELPER_TYPE}
$hwnd = [MiniWaffleWin32]::GetForegroundWindow()
$procId = 0
[void][MiniWaffleWin32]::GetWindowThreadProcessId($hwnd, [ref]$procId)
$p = Get-Process -Id $procId -ErrorAction SilentlyContinue
if ($p) {
  $desc = $null
  try { $desc = $p.MainModule.FileVersionInfo.FileDescription } catch {}
  $exePath = $null
  try { $exePath = $p.MainModule.FileName } catch {}
  [PSCustomObject]@{
    pid = $p.Id
    processName = $p.ProcessName
    executablePath = $exePath
    displayName = if ($desc) { $desc } else { $p.ProcessName }
  } | ConvertTo-Json -Compress
}
`;
  try {
    const stdout = await runPowerShell(script);
    const trimmed = stdout.trim();
    if (!trimmed) return null;
    return toAppInfo(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

/** Every currently-running process with a visible main window, deduped to
 * one entry per app (multiple windows of the same program collapse to
 * one), sorted by displayName. Excludes this app itself (section 42) and a
 * small set of Windows shell/system window hosts (section 11). */
export async function getRunningApps(): Promise<ForegroundAppInfo[]> {
  if (process.platform !== "win32") return [];
  const script = `
Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne "" } | ForEach-Object {
  $desc = $null
  try { $desc = $_.MainModule.FileVersionInfo.FileDescription } catch {}
  $exePath = $null
  try { $exePath = $_.MainModule.FileName } catch {}
  [PSCustomObject]@{
    pid = $_.Id
    processName = $_.ProcessName
    executablePath = $exePath
    displayName = if ($desc) { $desc } else { $_.ProcessName }
  }
} | ConvertTo-Json -Compress
`;
  let parsed: unknown;
  try {
    const stdout = await runPowerShell(script);
    const trimmed = stdout.trim();
    if (!trimmed) return [];
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }

  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const selfName = path.basename(process.execPath, path.extname(process.execPath)).toLowerCase();

  const byKey = new Map<string, ForegroundAppInfo>();
  for (const raw of rows) {
    const info = toAppInfo(raw as Record<string, unknown>);
    if (!info) continue;
    const nameLower = info.processName.toLowerCase();
    if (nameLower === selfName) continue; // section 42: never list this app / the Avatar Editor
    if (SYSTEM_PROCESS_DENYLIST.has(nameLower)) continue;
    const key = info.executablePath ?? info.processName;
    if (!byKey.has(key)) byKey.set(key, info);
  }

  return Array.from(byKey.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
}
