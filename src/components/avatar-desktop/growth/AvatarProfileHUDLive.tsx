"use client";

import type { GrowthEngine } from "./GrowthEngine";
import type { TimerEngine } from "../timer/TimerEngine";
import { useLiveGrowth } from "./useLiveGrowth";
import AvatarProfileHUD from "./AvatarProfileHUD";

/**
 * Thin wrapper that ticks (via useLiveGrowth) and feeds the LOCAL user's
 * live growth state into the pure AvatarProfileHUD. Isolating the tick
 * here - rather than calling useLiveGrowth directly inside
 * DesktopAvatarScene - keeps its per-second re-renders scoped to just this
 * leaf component, exactly mirroring ../timer/TimerHUD.tsx's own
 * self-contained tick (section 9).
 */
export default function AvatarProfileHUDLive({
  growthEngine,
  timerEngine,
  scale,
  onLevelUp,
}: {
  growthEngine: GrowthEngine;
  timerEngine: TimerEngine;
  scale: number;
  onLevelUp?: (newLevel: number) => void;
}) {
  const { nickname, growth } = useLiveGrowth(growthEngine, timerEngine, onLevelUp);

  return (
    <AvatarProfileHUD
      nickname={nickname}
      level={growth.level}
      currentExp={growth.currentExp}
      requiredExp={growth.requiredExp}
      progress={growth.progress}
      scale={scale}
    />
  );
}
