import { encodeObservation } from '../core/observation';
import { step } from '../core/engine';
import { transformAction, transformLevel } from '../core/levels';
import { MODEL_INPUTS, type Action, type GameState, type Level } from '../core/types';
import type { TrainingSample } from './network';

export interface ContextualTrainingSample extends TrainingSample {
  observationState?: GameState;
  history?: Action[];
}
export interface AugmentationOptions {
  symmetries?: boolean;
  translations?: boolean;
  /** Extra reset singletons for legacy stateless demonstrations; off for recurrent training. */
  restartViews?: boolean;
  maxSamples?: number;
}

/** Migrate saved examples without discarding metadata or changing their old 128 features. */
export function upgradeTrainingSample<T extends TrainingSample>(sample: T): T {
  if (!sample || !Number.isInteger(sample.action) || sample.action < 0 || sample.action > 5
    || !Array.isArray(sample.input) || ![128, MODEL_INPUTS].includes(sample.input.length)
    || sample.input.some(value => !Number.isFinite(value) || Math.abs(value) > 1e6)) throw new Error('Invalid saved training example.');
  const input = sample.input.slice();
  while (input.length < MODEL_INPUTS) input.push(0);
  return { ...sample, input };
}

export function normalizeTrainingSamples<T extends TrainingSample>(samples: T[]): T[] {
  if (!Array.isArray(samples)) throw new Error('Invalid saved training dataset.');
  return samples.map(sample => upgradeTrainingSample(sample));
}

/** Check actual transitions as well as IDs: deselecting a middle example breaks an episode. */
function follows(previous: ContextualTrainingSample, current: ContextualTrainingSample): boolean {
  if (!previous.observationState || !current.observationState) return true;
  const expected = step(previous.observationState, previous.action);
  const fingerprint = (state: GameState) => JSON.stringify([
    state.level.id, state.level.width, state.level.height, state.level.tiles, state.level.goals,
    state.level.surfaces, state.level.sequences, state.robot, state.crates, state.switches,
    state.doors, state.sequenceProgress, state.tick, state.moves, state.interactions,
    state.solved, state.lastAction,
  ]);
  return fingerprint(expected) === fingerprint(current.observationState);
}

/** No chronology is guessed for old state/action pairs without an explicit episode ID. */
export function splitDemonstrationEpisodes(samples: ContextualTrainingSample[]): ContextualTrainingSample[][] {
  const episodes: ContextualTrainingSample[][] = [];
  for (const sample of samples) {
    const episode = episodes[episodes.length - 1];
    const previous = episode?.[episode.length - 1];
    const explicitId = typeof sample.episodeId === 'string' && sample.episodeId.length > 0;
    if (explicitId && previous && previous.episodeId === sample.episodeId && !sample.sequenceStart
      && follows(previous, sample)) episode.push(sample);
    else episodes.push([sample]);
  }
  return episodes;
}

/**
 * If replay exceeds its budget, select contiguous pieces across rooms and ages.
 * Each retained run starts a new episode; omitted actions never become fake neighbours.
 */
function selectReplay(episodes: ContextualTrainingSample[][], budget: number): ContextualTrainingSample[][] {
  if (episodes.reduce((sum, episode) => sum + episode.length, 0) <= budget) return episodes;
  type Piece = { samples: ContextualTrainingSample[]; episode: number; offset: number; order: number };
  const byRoom = new Map<string, Piece[]>();
  let order = 0;
  episodes.forEach((episode, index) => {
    for (let offset = 0; offset < episode.length; offset += 64) {
      const samples = episode.slice(offset, offset + 64);
      const level = samples[0].observationState?.level;
      const key = level?.sourceLevelId ?? level?.id ?? 'legacy';
      const pieces = byRoom.get(key) ?? [];
      pieces.push({ samples, episode: index, offset, order: order++ });
      byRoom.set(key, pieces);
    }
  });
  // Alternate old and recent segments within each room; cycle rooms fairly.
  const queues = [...byRoom.values()].map(pieces => {
    const queue: Piece[] = [];
    for (let left = 0, right = pieces.length - 1; left <= right;) {
      queue.push(pieces[left++]);
      if (left <= right) queue.push(pieces[right--]);
    }
    return queue;
  });
  const selected: Piece[] = [];
  let remaining = budget;
  for (let round = 0; remaining > 0 && queues.some(queue => round < queue.length); round++) {
    const available = queues.filter(queue => round < queue.length);
    for (let index = 0; index < available.length && remaining > 0; index++) {
      const piece = available[index][round];
      // Reserve a portion for every room represented in this round.
      const count = Math.min(piece.samples.length, Math.max(1, Math.floor(remaining / (available.length - index))));
      selected.push({ ...piece, samples: piece.samples.slice(0, count) });
      remaining -= count;
    }
  }
  selected.sort((a, b) => a.order - b.order);
  const result: ContextualTrainingSample[][] = [];
  let previous: Piece | undefined;
  for (const piece of selected) {
    if (previous && previous.episode === piece.episode && previous.offset + previous.samples.length === piece.offset) {
      result[result.length - 1].push(...piece.samples);
    } else result.push([...piece.samples]);
    previous = piece;
  }
  return result;
}

function transformedState(state: GameState, rotations: number, reflected: boolean): GameState {
  const level = transformLevel(state.level, rotations, reflected);
  const current = transformLevel({
    ...state.level, start: { x: state.robot.x, z: state.robot.z }, facing: state.robot.facing,
    crates: state.crates, switches: state.switches, doors: state.doors,
  }, rotations, reflected);
  return {
    ...state, level, robot: { ...state.robot, ...current.start, facing: current.facing },
    crates: current.crates, switches: current.switches, doors: current.doors,
    sequenceProgress: state.sequenceProgress ? { ...state.sequenceProgress } : undefined,
    lastAction: transformAction(state.lastAction, rotations, reflected),
  };
}

function translatedLevel(level: Level, left: number, top: number, right: number, bottom: number): Level {
  const shift = <T extends { x: number; z: number }>(point: T): T => ({ ...point, x: point.x + left, z: point.z + top });
  const width = level.width + left + right;
  const row = '#'.repeat(width);
  return {
    ...level, width, height: level.height + top + bottom,
    tiles: [...Array<string>(top).fill(row), ...level.tiles.map(line => '#'.repeat(left) + line + '#'.repeat(right)), ...Array<string>(bottom).fill(row)],
    start: shift(level.start), crates: level.crates.map(shift), switches: level.switches.map(shift),
    doors: level.doors.map(door => ({ ...shift(door), requires: [...door.requires] })), goals: level.goals.map(shift),
    surfaces: level.surfaces?.map(shift), sequences: level.sequences?.map(sequence => ({ ...sequence, switchIds: [...sequence.switchIds] })),
  };
}

function translatedState(state: GameState, padding: [number, number, number, number]): GameState {
  const [left, top, right, bottom] = padding;
  const level = translatedLevel(state.level, left, top, right, bottom);
  const current = translatedLevel({ ...state.level, crates: state.crates, switches: state.switches, doors: state.doors }, left, top, right, bottom);
  return {
    ...state, level, robot: { ...state.robot, x: state.robot.x + left, z: state.robot.z + top },
    crates: current.crates, switches: current.switches, doors: current.doors,
    sequenceProgress: state.sequenceProgress ? { ...state.sequenceProgress } : undefined,
  };
}

/**
 * Only symmetry-equivalent copies of the player's demonstrated state and action.
 * No optimal action, solver result or invented correction is added. Whole-room padding
 * breaks absolute-coordinate shortcuts while preserving every wall and interaction.
 * A transformation applies to a whole episode, including every history and label.
 */
export function augmentSamples(samples: ContextualTrainingSample[], options: AugmentationOptions = {}): TrainingSample[] {
  const maxSamples = options.maxSamples ?? 6000;
  if (!Number.isInteger(maxSamples) || maxSamples < 1 || maxSamples > 100000) throw new Error('Invalid augmentation budget.');
  const upgraded = normalizeTrainingSamples(samples);
  const episodes = selectReplay(splitDemonstrationEpisodes(upgraded), maxSamples);
  const output: TrainingSample[] = [];
  const append = (episode: ContextualTrainingSample[], id: string) => {
    episode.forEach((sample, index) => output.push({
      input: sample.observationState ? Array.from(encodeObservation(sample.observationState, sample.history ?? [])) : [...sample.input],
      action: sample.action, episodeId: id, sequenceStart: index === 0,
    }));
  };
  episodes.forEach((episode, index) => append(episode, `replay:${index}:original`));
  const transforms: { rotations: number; reflected: boolean; padding?: [number, number, number, number] }[] = [{ rotations: 0, reflected: false }];
  if (options.symmetries !== false) {
    for (const reflected of [false, true]) for (const rotations of [0, 1, 2, 3]) {
      if (rotations || reflected) transforms.push({ rotations, reflected });
    }
  }
  if (options.translations !== false) {
    transforms.push({ rotations: 0, reflected: false, padding: [1, 0, 0, 1] });
    transforms.push({ rotations: 0, reflected: false, padding: [0, 1, 1, 0] });
  }
  for (const [transformIndex, transform] of transforms.entries()) {
    for (const [episodeIndex, episode] of episodes.entries()) {
      if (output.length >= maxSamples) return output;
      if (!episode.every(sample => sample.observationState)) continue;
      const transformed = episode.map(sample => {
        const state = transform.padding ? translatedState(sample.observationState!, transform.padding)
          : transformedState(sample.observationState!, transform.rotations, transform.reflected);
        const action = transformAction(sample.action, transform.rotations, transform.reflected);
        const history = (sample.history ?? []).map(value => transformAction(value, transform.rotations, transform.reflected));
        return { ...sample, observationState: state, history, action };
      });
      // The identity with its true chronology was already emitted above.
      if (transformIndex > 0 && output.length + transformed.length <= maxSamples) {
        append(transformed, `replay:${episodeIndex}:transform:${transformIndex}`);
      }
      // Only explicitly requested legacy, independent examples may acquire a reset view.
      // A real GRU episode must never be interrupted by invented zero-memory states.
      if (options.restartViews === true && episode.length === 1 && !episode[0].episodeId) {
        const sample = transformed[0];
        if (sample.history.length && output.length < maxSamples) output.push({
          input: Array.from(encodeObservation(sample.observationState, [])), action: sample.action,
          sequenceStart: true,
        });
      }
    }
  }
  return output;
}
