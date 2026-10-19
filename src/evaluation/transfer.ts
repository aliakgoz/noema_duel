import { createState, step } from '../core/engine';
import { encodeObservation } from '../core/observation';
import { createTransferVariant } from '../core/variants';
import type { Action, Level } from '../core/types';
import { TinyNetwork, type NetworkSnapshot } from '../ml/network';

export type TrialMode = 'same' | 'start' | 'layout';
export interface TransferCase {
  kind: TrialMode; seed: number; solved: boolean; decisions: number; moves: number;
  start: { x: number; z: number }; changes: string[];
}
export interface TransferReport { cases: TransferCase[]; budget: number; requestedCases: number }
export const TRANSFER_BUDGET = 220;

/** Evaluate a fixed copy of the policy. Only the network chooses actions. */
export function evaluateTransfer(snapshot: NetworkSnapshot, level: Level, seed: number): TransferReport {
  const network = TinyNetwork.fromSnapshot(snapshot);
  const prepared: { kind: TrialMode; seed: number; level: Level }[] = [{ kind: 'same', seed, level }];
  const physicalKey = (room: Level) => JSON.stringify([room.width, room.height, room.tiles, room.start, room.facing, room.crates, room.switches, room.doors, room.goals, room.surfaces, room.sequences]);
  const seen = new Set([physicalKey(level)]);
  for (const kind of ['start', 'layout'] as const) {
    let found = 0;
    for (let attempt = 0; attempt < 64 && found < 3; attempt++) {
      const caseSeed = (seed + (attempt + (kind === 'start' ? 1 : 129)) * 2654435761) >>> 0;
      let trial: Level;
      try { trial = createTransferVariant(level, caseSeed, kind); } catch { continue; }
      const key = physicalKey(trial);
      if (seen.has(key)) continue;
      seen.add(key); prepared.push({ kind, seed: caseSeed, level: trial }); found++;
    }
  }
  const cases = prepared.map(({ kind, seed: caseSeed, level: trial }): TransferCase => {
    network.resetMemory();
    let state = createState(trial);
    const history: Action[] = [];
    for (let i = 0; i < TRANSFER_BUDGET && !state.solved; i++) {
      const action = network.predict(encodeObservation(state, history)).action;
      state = step(state, action);
      history.push(action);
      if (history.length > 16) history.shift();
    }
    return { kind, seed: caseSeed, solved: state.solved, decisions: state.tick, moves: state.moves,
      start: { ...trial.start }, changes: trial.variantChanges ?? [] };
  });
  return { cases, budget: TRANSFER_BUDGET, requestedCases: 7 };
}

