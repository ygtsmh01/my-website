import type { League } from './types';

// Single source of truth for league promotion math — previously duplicated
// (and drifted out of sync) between Game.tsx and Live.tsx.
//
// Promotion requires BOTH crossing the XP threshold AND having completed the
// current tier's guide/academy — XP can keep accumulating past the
// threshold, but the tier only advances once the guide is done. This applies
// everywhere league XP can be gained: weekly quiz, the guide itself, and
// Canlı Yarışma (duel/room) wins.
export function applyLeagueDelta(
  tier: number,
  xp: number,
  delta: number,
  leagues: League[],
  completedTiers: Set<number>
) {
  let t = tier, x = xp + delta;
  while (x < 0 && t > 0) { t -= 1; x = 0; }
  if (x < 0) x = 0;
  while (
    t < leagues.length - 1 && leagues[t] && leagues[t].promote_threshold != null &&
    x >= (leagues[t].promote_threshold as number) && completedTiers.has(t)
  ) {
    x -= leagues[t].promote_threshold as number;
    t += 1;
  }
  return { tier: t, xp: x };
}
