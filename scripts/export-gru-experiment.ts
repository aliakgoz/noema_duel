/** Experiment tooling only: oracle certificates never enter live training or play. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createState, step } from '../src/core/engine';
import { LEVELS, LEVEL_SOLUTIONS, transformLevel } from '../src/core/levels';
import { encodeObservation } from '../src/core/observation';
import { createTransferVariant } from '../src/core/variants';
import { TinyNetwork } from './research-mlp-reference';
import type { Action, GameState, Level } from '../src/core/types';

export const MAP_SHAPE = [16, 20, 20] as const;
export const MAP_CHANNEL_NAMES = [
  'floor', 'wall', 'robot_facing_1_to_4_div4', 'carried_kind_amber1_cyan_minus1',
  'loose_crate_kind_amber1_cyan_minus1', 'goal_amber_third_cyan_two_thirds_exit1',
  'switch_signed_mode_toggle_third_pressure_two_thirds_sequence1', 'switch_index_plus1_div4',
  'sequence_group_index_plus1_div2', 'sequence_order_index_plus1_div4',
  'sequence_completed_count_div4', 'door_open1_closed_minus1',
  'door_controller_bitmask_div15', 'door_and_half_or1_negative_if_inverted',
  'surface_ice_minus1_conveyor1', 'conveyor_direction_plus1_div4',
] as const;

/** Full visible current Markov state; no plans, distances or correct-action hints. */
export function encodeMapSparse(state: GameState): number[] {
  const { level } = state;
  if (level.width > 20 || level.height > 20 || state.switches.length > 4 || (level.sequences?.length ?? 0) > 2 || level.sequences?.some(sequence => sequence.switchIds.length > 4)) throw new Error('Experimental map encoder contract exceeded: 20x20, four switches, two groups, order four');
  const cells = new Float32Array(6400);
  const put = (channel: number, x: number, z: number, value: number) => { cells[channel * 400 + z * 20 + x] = value; };
  for (let z = 0; z < level.height; z++) for (let x = 0; x < level.width; x++) put(level.tiles[z][x] === '.' ? 0 : 1, x, z, 1);
  put(2, state.robot.x, state.robot.z, (state.robot.facing + 1) / 4);
  for (const crate of state.crates) {
    const kind = crate.kind === 'amber' ? 1 : -1;
    if (crate.id === state.robot.carrying) put(3, state.robot.x, state.robot.z, kind);
    else put(4, crate.x, crate.z, kind);
  }
  for (const goal of level.goals) put(5, goal.x, goal.z, goal.kind === 'amber' ? 1 / 3 : goal.kind === 'cyan' ? 2 / 3 : 1);
  state.switches.forEach((switch_, i) => {
    const magnitude = switch_.mode === 'toggle' ? 1 / 3 : switch_.mode === 'pressure' ? 2 / 3 : 1;
    put(6, switch_.x, switch_.z, magnitude * (switch_.on ? 1 : -1));
    put(7, switch_.x, switch_.z, (i + 1) / 4);
    const sequenceIndex = level.sequences?.findIndex(sequence => sequence.switchIds.includes(switch_.id)) ?? -1;
    if (sequenceIndex >= 0) {
      const sequence = level.sequences![sequenceIndex];
      put(8, switch_.x, switch_.z, (sequenceIndex + 1) / 2);
      put(9, switch_.x, switch_.z, (sequence.switchIds.indexOf(switch_.id) + 1) / 4);
      put(10, switch_.x, switch_.z, (state.sequenceProgress?.[sequence.id] ?? 0) / 4);
    }
  });
  for (const door of state.doors) {
    put(11, door.x, door.z, door.open ? 1 : -1);
    let controllers = 0;
    for (const id of door.requires) {
      const index = state.switches.findIndex(switch_ => switch_.id === id);
      if (index < 0) throw new Error(`Unknown controller ${id}`);
      controllers |= 1 << index;
    }
    put(12, door.x, door.z, controllers / 15);
    put(13, door.x, door.z, (door.logic === 'or' ? 1 : 0.5) * (door.inverted ? -1 : 1));
  }
  for (const surface of level.surfaces ?? []) {
    put(14, surface.x, surface.z, surface.kind === 'ice' ? -1 : 1);
    if (surface.kind === 'conveyor' && surface.direction !== undefined) put(15, surface.x, surface.z, (surface.direction + 1) / 4);
  }
  const sparse: number[] = [];
  for (let i = 0; i < cells.length; i++) if (cells[i]) sparse.push(i, cells[i]);
  return sparse;
}

type Split = 'train' | 'test-start' | 'test-layout' | 'test-room';
interface Episode {
  id: string; split: Split; baseLevelId: string; family: string; seed: number | null;
  variantKind: 'authored' | 'start' | 'layout'; fingerprint: string; level: Level;
  initialState: GameState; actions: Action[]; observations: number[][]; mapSparse: number[][]; solved: true;
}

const physicalFingerprint = (level: Level) => JSON.stringify([
  level.tiles, level.start, level.facing, level.crates, level.switches, level.doors, level.goals, level.surfaces ?? [], level.sequences ?? [],
]);
const replay = (level: Level, actions: readonly Action[]) => actions.reduce(step, createState(level));

/** Nearby starts retain the original demonstrated route after a <=3-input return. */
function certificateFor(level: Level, base: Level): Action[] {
  const original = [...LEVEL_SOLUTIONS[base.id]];
  const initial = createState(level);
  if (original.reduce(step, initial).solved) return original;
  const queue: { state: GameState; prefix: Action[] }[] = [{ state: initial, prefix: [] }];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    if (current.prefix.length === 3) continue;
    for (let action = 0; action < 4; action++) {
      const next = step(current.state, action as Action);
      const prefix = [...current.prefix, action as Action];
      if (original.reduce(step, next).solved) return [...prefix, ...original];
      queue.push({ state: next, prefix });
    }
  }
  throw new Error(`No replay certificate for ${level.id}`);
}

function episodeFor(level: Level, base: Level, split: Split, index: number): Episode {
  const actions = certificateFor(level, base);
  let state = createState(level);
  const observations: number[][] = []; const mapSparse: number[][] = []; const history: Action[] = [];
  // A certificate may contain a redundant tail: retain only pre-terminal real actions.
  const effectiveActions: Action[] = [];
  for (const action of actions) {
    if (state.solved) break;
    observations.push(Array.from(encodeObservation(state, history))); mapSparse.push(encodeMapSparse(state));
    effectiveActions.push(action); state = step(state, action); history.push(action);
  }
  if (!state.solved || !replay(level, effectiveActions).solved) throw new Error(`Unsolved episode ${level.id}`);
  return {
    id: `${split}-${base.id}-${index}`, split, baseLevelId: base.id, family: `chapter-${base.chapter}`,
    seed: level.seed ?? null, variantKind: level.variantKind ?? 'authored', fingerprint: physicalFingerprint(level),
    level, initialState: createState(level), actions: effectiveActions, observations, mapSparse, solved: true,
  };
}

export function exportDataset() {
  const trainNumbers = [1, 2, 4, 6, 9, 11, 13, 16, 21, 23, 25, 28, 32, 35, 40, 41, 44, 48, 49, 50, 51, 53, 54, 56];
  const heldoutNumbers = [3, 12, 31, 38, 46, 52, 55];
  const episodes: Episode[] = []; const seen = new Set<string>();
  const limitations = [
    'Oracle-authored solution certificates supervise this isolated experiment only; no live player model receives them.',
    'Train/test-start/test-layout share a base-room task and authored demonstration backbone. These measure nearby transfer, not unseen puzzle invention.',
    'Nearby-start solutions use up to three recovery actions followed by the authored demonstration, not necessarily a shortest or unique policy.',
    'test-room base-level IDs are entirely absent from training. This is a small selected authored-room split, not a representative population benchmark.',
    'No rotations/reflections are used. All physical condition fingerprints are unique across episodes, and seed ranges are disjoint.',
    'Single-wall variants may alter off-route cells and leave the certificate unchanged; report them separately from novel-room tasks.',
    'Full-map observation encodes visible controller bindings, topology and current state; it contains no future solution or solver output.',
    'The map encoder is an experimental semantic representation, not an observation format deployed to the live game.',
    'Encoder contract is bounded to the current authored catalog: 20x20 cells, at most four switches, two sequence groups, order/progress at most four. Values use fixed scaling by those bounds; unsupported rooms throw instead of clipping.',
  ];
  for (const number of trainNumbers) {
    const base = LEVELS[number - 1];
    const add = (level: Level, split: Split) => {
      const fingerprint = physicalFingerprint(level);
      if (seen.has(fingerprint)) return false;
      const episode = episodeFor(level, base, split, episodes.length);
      seen.add(fingerprint); episodes.push(episode); return true;
    };
    add(transformLevel(base), 'train');
    for (const kind of ['start', 'layout'] as const) for (const split of ['train', `test-${kind}`] as const) {
      const seedBase = (split === 'train' ? 10_000 : 900_000) + number * 1000 + (kind === 'layout' ? 300 : 0);
      let accepted = 0;
      for (let attempt = 0; attempt < 96 && accepted < 2; attempt++) {
        try { if (add(createTransferVariant(base, seedBase + attempt, kind), split)) accepted++; }
        catch (error) { if (attempt === 95) console.warn(String(error)); }
      }
      if (accepted < 2) limitations.push(`${base.id} ${split}/${kind}: only ${accepted}/2 physically unique variants available.`);
    }
    console.log(`${base.id}: ${episodes.filter(episode => episode.baseLevelId === base.id).length} verified episodes`);
  }
  for (const number of heldoutNumbers) {
    const base = LEVELS[number - 1]; const level = transformLevel(base); const fingerprint = physicalFingerprint(level);
    if (seen.has(fingerprint)) throw new Error('Held-out room leakage');
    seen.add(fingerprint); episodes.push(episodeFor(level, base, 'test-room', episodes.length));
  }
  const trainIds = new Set(episodes.filter(episode => episode.split === 'train').map(episode => episode.baseLevelId));
  if (episodes.some(episode => episode.split === 'test-room' && trainIds.has(episode.baseLevelId))) throw new Error('Base-room split leakage');
  const summary = Object.fromEntries((['train', 'test-start', 'test-layout', 'test-room'] as const).map(split => {
    const selected = episodes.filter(episode => episode.split === split);
    return [split, { episodes: selected.length, actions: selected.reduce((count, episode) => count + episode.actions.length, 0) }];
  }));
  const output = {
    schemaVersion: 'noema-gru-experiment-v1', createdAt: new Date().toISOString(),
    observationSize: 160, mapShape: MAP_SHAPE, mapChannelNames: MAP_CHANNEL_NAMES,
    mapSparseFormat: 'Alternating [CHW-flat-index,value,...], all absent cells zero; pre-action same state as observations.',
    actionNames: ['up', 'right', 'down', 'left', 'interact', 'wait'],
    trainBaseLevelIds: [...trainIds], heldoutBaseLevelIds: heldoutNumbers.map(number => LEVELS[number - 1].id),
    initialMlpSnapshots: Object.fromEntries([42, 123].map(seed => [String(seed), new TinyNetwork(seed).snapshot()])),
    summary, limitations, episodes,
  };
  mkdirSync(resolve('artifacts/gru-experiment'), { recursive: true });
  writeFileSync(resolve('artifacts/gru-experiment/dataset.json'), JSON.stringify(output));
  writeFileSync(resolve('artifacts/gru-experiment/dataset-notes.md'), `# Isolated GRU experiment dataset\n\n${JSON.stringify(summary, null, 2)}\n\n${limitations.map(item => `- ${item}`).join('\n')}\n`);
  console.log(JSON.stringify({ summary, totalActions: episodes.reduce((sum, episode) => sum + episode.actions.length, 0), allCertified: true }));
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) exportDataset();
