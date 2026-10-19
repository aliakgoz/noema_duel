import { createHmac } from 'node:crypto';
import { createDuel, setStrategy, startDuel, stepDuel } from '../src/duel/engine';
import { isDuelModel, predictDuel, resetDuelMemory } from '../src/duel/learning';
import type { DuelModel } from '../src/duel/learning';
import type { DuelEvaluation } from '../src/duel/online';
import type { CourtLayout, Strategy } from '../src/duel/types';

export const DUEL_RULESET = 'noema-duel-arena-v1-fullpower';
export const DUEL_ROUNDS = 3;
export const DUEL_ROUND_SECONDS = 120;
export function duelChallengeSeeds(secret: string, day: string): number[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Invalid challenge day.');
  return Array.from({ length: DUEL_ROUNDS }, (_, i) => createHmac('sha256', secret).update(`${DUEL_RULESET}:${day}:${i}`).digest().readUInt32LE(0));
}

/** Server-owned state, opponents, clocks and scores. Uploaded code is never executed. */
export function evaluateDuelModel(model: DuelModel, seeds: number[]): DuelEvaluation {
  if (!isDuelModel(model) || model.trainedSteps < 1) throw new Error('Eğitilmiş ve uyumlu bir Duel modeli gerekli.');
  if (seeds.length !== DUEL_ROUNDS || !seeds.every(seed => Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff)) throw new Error('Invalid challenge seeds.');
  const layouts: CourtLayout[] = ['classic', 'ricochet', 'open'];
  const opponents: Strategy[] = ['balanced', 'defensive', 'aggressive'];
  let wins = 0, draws = 0, losses = 0, damage = 0, remainingHp = 0;
  for (let round = 0; round < DUEL_ROUNDS; round++) {
    const state = createDuel(layouts[round], seeds[round]);
    setStrategy(state, 1, opponents[round]);
    resetDuelMemory(model); startDuel(state);
    for (let tick = 0; tick < DUEL_ROUND_SECONDS * 10 && state.phase === 'running'; tick++) {
      const input = predictDuel(model, state);
      // GRU acts at the same 10 Hz as the mobile app; physics remains 120 Hz.
      stepDuel(state, .1, input);
    }
    if (state.winner === 0) wins++;
    else if (state.winner === 1) losses++;
    else draws++; // Surviving the clock is a draw; only depleting HP wins.
    damage += state.robots[0].damage;
    remainingHp += state.robots[0].hp;
  }
  damage = Math.round(damage); remainingHp = Math.round(remainingHp);
  return { wins, draws, losses, total: DUEL_ROUNDS, damage, remainingHp, score: wins * 10000 + draws * 3000 + damage + remainingHp };
}
