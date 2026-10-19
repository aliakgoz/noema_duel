import { createHmac } from 'node:crypto';
import { createState, step } from '../src/core/engine';
import { generateChallenge } from '../src/core/levels';
import { createTransferVariant } from '../src/core/variants';
import { encodeObservation } from '../src/core/observation';
import type { Action } from '../src/core/types';
import { TinyNetwork, type NetworkSnapshot } from '../src/ml/network';

export const ARENA_PUZZLES = 8;
export const ARENA_STEP_BUDGET = 160;
export const ARENA_RULESET = 'noema-arena-v4-gru96';
export interface ArenaEvaluation { solved: number; total: number; moves: number }

/** The same secret challenge set is shared by every submission on the UTC day. */
export function challengeSeeds(secret: string, day: string): number[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Invalid challenge day.');
  return Array.from({ length: ARENA_PUZZLES }, (_, index) => {
    const digest = createHmac('sha256', secret).update(`${ARENA_RULESET}:${day}:${index}`).digest();
    return digest.readUInt32LE(0);
  });
}

/** All score-producing observations, actions and state transitions are authoritative. */
export function evaluateModel(snapshot: NetworkSnapshot, seeds: number[]): ArenaEvaluation {
  if (seeds.length !== ARENA_PUZZLES || seeds.some((seed) => !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)) {
    throw new Error('Invalid server challenge set.');
  }
  const network = TinyNetwork.fromSnapshot(snapshot);
  let solved = 0; let moves = 0;
  for (const seed of seeds) {
    network.resetMemory();
    // Hidden daily conditions include local edits, beyond whole-room rotation.
    const base = generateChallenge(seed);
    const challenge = createTransferVariant(base, (seed ^ 0x9e3779b9) >>> 0, (seed & 1) ? 'start' : 'layout');
    let state = createState(challenge);
    const history: Action[] = [];
    for (let tick = 0; tick < ARENA_STEP_BUDGET && !state.solved; tick++) {
      const { action } = network.predict(encodeObservation(state, history));
      state = step(state, action);
      history.push(action);
      if (history.length > 2) history.shift();
    }
    if (state.solved) solved++;
    // Attempted decisions include bumps and waits; no zero-move advantage for idling.
    moves += state.tick;
  }
  return { solved, total: ARENA_PUZZLES, moves };
}
