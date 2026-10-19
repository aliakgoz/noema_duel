import { describe, expect, it } from 'vitest';
import { createState, step } from '../core/engine';
import { LEVELS, transformAction, transformLevel } from '../core/levels';
import { encodeObservation } from '../core/observation';
import type { Action, Level } from '../core/types';
import { augmentSamples, normalizeTrainingSamples, splitDemonstrationEpisodes, type ContextualTrainingSample } from './dataset';
import { TinyNetwork } from './network';

function demonstrate(level: Level, actions: Action[], episodeId?: string): ContextualTrainingSample[] {
  let state = createState(level);
  const history: Action[] = [];
  return actions.map((action, index) => {
    const sample = { input: Array.from(encodeObservation(state, history)), action, observationState: state, history: [...history],
      ...(episodeId ? { episodeId, sequenceStart: index === 0 } : {}) };
    state = step(state, action); history.push(action);
    if (history.length > 2) history.shift();
    return sample;
  });
}

function episode(network: TinyNetwork, level: Level) {
  network.resetMemory();
  let state = createState(level); const history: Action[] = [];
  for (let tick = 0; tick < 40 && !state.solved; tick++) {
    const action = network.predict(encodeObservation(state, history)).action;
    state = step(state, action); history.push(action);
    if (history.length > 2) history.shift();
  }
  return { solved: state.solved, decisions: state.tick };
}

describe('contextual imitation and replay', () => {
  it('pads v1 examples and preserves all profile metadata and the original features', () => {
    const old = { input: Array<number>(128).fill(0.125), action: 1 as Action, id: 9, levelId: 'room-02', accepted: true };
    const [upgraded] = normalizeTrainingSamples([old]);
    expect(upgraded).toMatchObject({ id: 9, levelId: 'room-02', accepted: true });
    expect(upgraded.input.slice(0, 128)).toEqual(old.input);
    expect(upgraded.input.slice(128)).toEqual(Array<number>(32).fill(0));
    expect(old.input).toHaveLength(128);
    expect(() => normalizeTrainingSamples([{ ...old, input: [NaN] }])).toThrow();
  });

  it('transforms actual demonstration actions and visible states together without adding a solver label', () => {
    const source = demonstrate(LEVELS[0], [0]);
    const augmented = augmentSamples(source, { translations: false, restartViews: false });
    expect(augmented).toHaveLength(8);
    expect(new Set(augmented.map(sample => sample.action))).toEqual(new Set([0, 1, 2, 3]));
    expect(augmented.every(sample => sample.input.length === 160 && sample.input.every(Number.isFinite))).toBe(true);
    // A legacy example has no physical context: never invent a transformed action for it.
    const legacy = { input: Array<number>(128).fill(0), action: 4 as Action };
    expect(augmentSamples([legacy])).toHaveLength(1);
    expect(source[0].observationState?.robot).toMatchObject({ x: 1, z: 5 });
  });

  it('preserves real episode chronology through every whole-sequence rotation and reflection', () => {
    const actions: Action[] = [0, 0, 1, 1];
    const source = demonstrate(LEVELS[0], actions, 'human-episode');
    const augmented = augmentSamples(source, { translations: false, restartViews: true });
    // Explicit recurrent episodes never acquire artificial zero-memory midpoints.
    expect(augmented).toHaveLength(actions.length * 8);
    const groups = splitDemonstrationEpisodes(augmented);
    expect(groups.map(group => group.length)).toEqual(Array<number>(8).fill(actions.length));
    let groupIndex = 0;
    for (const reflected of [false, true]) for (const rotations of [0, 1, 2, 3]) {
      const expected = demonstrate(transformLevel(LEVELS[0], rotations, reflected),
        actions.map(action => transformAction(action, rotations, reflected)));
      const actual = groups[groupIndex++];
      expect(actual.map(sample => sample.input)).toEqual(expected.map(sample => sample.input));
      expect(actual.map(sample => sample.action)).toEqual(expected.map(sample => sample.action));
      expect(actual.map(sample => sample.sequenceStart)).toEqual([true, false, false, false]);
    }
    expect(source.map(sample => sample.episodeId)).toEqual(Array<string>(4).fill('human-episode'));
  });

  it('splits removed actions, explicit restarts and old examples instead of inventing a sequence', () => {
    const source = demonstrate(LEVELS[0], [0, 0, 0, 0, 1], 'recorded');
    expect(splitDemonstrationEpisodes(source).map(group => group.length)).toEqual([5]);
    expect(splitDemonstrationEpisodes(source.filter((_, index) => index !== 2)).map(group => group.length)).toEqual([2, 2]);
    expect(splitDemonstrationEpisodes(source.map((sample, index) => index === 3 ? { ...sample, sequenceStart: true } : sample))
      .map(group => group.length)).toEqual([3, 2]);
    const legacy = source.map(({ episodeId: _episodeId, sequenceStart: _sequenceStart, ...sample }) => sample);
    expect(splitDemonstrationEpisodes(legacy).map(group => group.length)).toEqual([1, 1, 1, 1, 1]);
    const replay = augmentSamples(source.filter((_, index) => index !== 2),
      { symmetries: false, translations: false, restartViews: false });
    expect(replay.map(sample => sample.sequenceStart)).toEqual([true, false, true, false]);
    expect(new Set(replay.map(sample => sample.episodeId)).size).toBe(2);
  });

  it('bounds replay using contiguous reset segments and retains examples from different rooms', () => {
    const first = demonstrate(LEVELS[0], Array<Action>(100).fill(0), 'old-room');
    const second = demonstrate(LEVELS[1], Array<Action>(100).fill(1), 'new-room');
    const replay = augmentSamples([...first, ...second],
      { maxSamples: 24, symmetries: false, translations: false, restartViews: false });
    expect(replay).toHaveLength(24);
    expect(replay.filter(sample => sample.action === 0)).toHaveLength(12);
    expect(replay.filter(sample => sample.action === 1)).toHaveLength(12);
    const groups = splitDemonstrationEpisodes(replay);
    expect(groups.map(group => group.length)).toEqual([12, 12]);
    expect(groups.every(group => group[0].sequenceStart)).toBe(true);
    expect(replay.slice(0, 12).map(sample => sample.input)).toEqual(first.slice(0, 12).map(sample => sample.input));
    expect(replay.slice(12).map(sample => sample.input)).toEqual(second.slice(0, 12).map(sample => sample.input));
  });

  it('keeps examples from multiple rooms in bounded replay and continues the existing model', async () => {
    const first = demonstrate(LEVELS[0], [0, 0, 0, 0, 1, 1, 1, 1, 1, 1], 'room-one-demo');
    const second = demonstrate(LEVELS[1], [0, 0, 1, 1, 1, 1, 1, 1, 2, 2], 'room-two-demo');
    const network = new TinyNetwork(17);
    await network.train(first, 2, 8);
    const before = network.snapshot();
    const replay = augmentSamples([...first, ...second], { maxSamples: 100 });
    expect(replay.slice(0, first.length).map(sample => sample.input)).toEqual(first.map(sample => sample.input));
    expect(replay.slice(first.length, first.length + second.length).map(sample => sample.input)).toEqual(second.map(sample => sample.input));
    await network.train(replay, 2, 8);
    expect(network.trainedSteps).toBe(before.trainedSteps + replay.length * 2);
    expect(network.seed).toBe(before.seed);
    expect(network.snapshot().weights).not.toEqual(before.weights);
  }, 15000);

  it('benchmarks real closed-loop decisions on starts absent from the teaching trace', async () => {
    const source = LEVELS[0];
    const teaching = demonstrate(source, [0, 0, 0, 0, 1, 1, 1, 1, 1, 1], 'transfer-teaching');
    const augmented = augmentSamples(teaching, { maxSamples: 3000 });
    const network = new TinyNetwork(42);
    const holdouts: Level[] = [{ x: 2, z: 5 }, { x: 2, z: 4 }, { x: 1, z: 4 }, { x: 1, z: 3 }].map((start, index) => ({
      ...source, id: `unseen-start-${index}`, start, crates: [], switches: [], doors: [],
    }));
    // One nearby map adds a wall away from the human route; it is never in training.
    const tiles = [...source.tiles]; const row = [...tiles[3]]; row[3] = '#'; tiles[3] = row.join('');
    holdouts.push({ ...source, id: 'unseen-layout', tiles, start: { x: 2, z: 5 } });
    const before = holdouts.map(level => episode(network, level));
    const epochs = Math.max(1, Math.floor(12000 / augmented.length));
    await network.train(augmented, epochs, 16);
    const after = holdouts.map(level => episode(network, level));
    console.info('Real puzzle transfer benchmark', JSON.stringify({
      originalExamples: teaching.length, augmentedExamples: augmented.length, epochs,
      beforeSolved: before.filter(value => value.solved).length, afterSolved: after.filter(value => value.solved).length,
      holdouts: after, taughtRoom: episode(network, source),
    }));
    expect(episode(network, source).solved).toBe(true);
    expect(after.filter(value => value.solved).length).toBeGreaterThanOrEqual(3);
    expect(after.filter(value => value.solved).length).toBeGreaterThan(before.filter(value => value.solved).length);
  }, 60000);
});
