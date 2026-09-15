import type { GrowthProgress } from "./growthTypes";

/**
 * Growth balance constants (section 12) - kept in one place so the curve
 * can be retuned without touching calculateGrowth()'s logic.
 *
 * requiredExpForLevel(level) = baseRequiredExp + (level - 1) * additionalExpPerLevel
 *   Lv.1 -> Lv.2: 60
 *   Lv.2 -> Lv.3: 75
 *   Lv.3 -> Lv.4: 90
 *   ...
 */
export const GROWTH_CONFIG = {
  msPerExp: 60_000,
  baseRequiredExp: 60,
  additionalExpPerLevel: 15,
} as const;

export function requiredExpForLevel(level: number): number {
  return GROWTH_CONFIG.baseRequiredExp + (level - 1) * GROWTH_CONFIG.additionalExpPerLevel;
}

/**
 * Pure function: totalWorkMs -> level/currentExp/requiredExp/progress
 * (section 13). Never mutates anything, safe to call every render/tick -
 * this is what both the live-ticking HUD/menu displays and the level-up
 * edge-detector in useLiveGrowth.ts both call, so "what level is the user
 * at" only ever has one implementation to drift out of sync.
 */
export function calculateGrowth(totalWorkMs: number): GrowthProgress {
  const totalExp = Math.floor(Math.max(0, totalWorkMs) / GROWTH_CONFIG.msPerExp);

  let level = 1;
  let remaining = totalExp;
  while (remaining >= requiredExpForLevel(level)) {
    remaining -= requiredExpForLevel(level);
    level++;
  }

  const requiredExp = requiredExpForLevel(level);
  return {
    level,
    totalExp,
    currentExp: remaining,
    requiredExp,
    progress: requiredExp > 0 ? remaining / requiredExp : 0,
  };
}

/** Nickname validation (section 3) - kept as constants, not magic numbers,
 * so the limits can be retuned in one place. */
export const NICKNAME_MIN_LENGTH = 2;
export const NICKNAME_MAX_LENGTH = 16;

export const DEFAULT_NICKNAME = "게스트";
