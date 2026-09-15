/**
 * Shared type definitions for the nickname + level/EXP growth system.
 * Framework-free, mirroring ../timer/timerTypes.ts's own separation.
 */

export const USER_PROFILE_SCHEMA_VERSION = 1;

/**
 * Persisted local user profile. `totalWorkMs` is the ONLY source of truth
 * for growth (section 2 of the brief - "level/currentExp/requiredExp를
 * 서로 독립적으로 저장해서 데이터가 어긋나게 하지 않는다") - level, currentExp,
 * requiredExp, and progress are always derived fresh from it via
 * calculateGrowth() in growthConfig.ts, never stored redundantly here.
 */
export interface UserProfile {
  schemaVersion: number;
  nickname: string;
  totalWorkMs: number;
  createdAt: number;
  updatedAt: number;
}

/** Pure, derived-only growth state for a given totalWorkMs - see
 * growthConfig.ts's calculateGrowth(). Never persisted directly. */
export interface GrowthProgress {
  level: number;
  totalExp: number;
  currentExp: number;
  requiredExp: number;
  /** 0..1 */
  progress: number;
}
