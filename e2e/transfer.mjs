import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createState, step } from '../src/core/engine.ts';
import { LEVELS } from '../src/core/levels.ts';
import { encodeObservation } from '../src/core/observation.ts';
import { augmentSamples } from '../src/ml/dataset.ts';
import { TinyNetwork, ARCHITECTURE, PARAMETER_COUNT } from '../src/ml/network.ts';

// Run: node --import tsx e2e/transfer.mjs
// These are declared human-style demonstrations, not labels produced by a solver.
const result = {
  startedAt: new Date().toISOString(), architecture: [...ARCHITECTURE], parameterCount: PARAMETER_COUNT,
  trainingBudget: 18000, styles: [], passed: false,
  scope: 'First open room; four untrained nearby starts and one off-route wall perturbation. This does not establish generalization to arbitrary puzzles or new mechanics.',
};
const artifacts = new URL('../artifacts/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const source = LEVELS[0];
const starts = [{ x: 2, z: 5 }, { x: 2, z: 4 }, { x: 1, z: 4 }, { x: 1, z: 3 }];
const holdouts = starts.map((start, index) => ({ ...source, id: `unseen-start-${index}`, start }));
const tiles = [...source.tiles]; const row = [...tiles[3]]; row[3] = '#'; tiles[3] = row.join('');
holdouts.push({ ...source, id: 'unseen-layout', tiles, start: { x: 2, z: 5 } });

function rollout(network, level) {
  network.resetMemory();
  let state = createState(level); const history = []; const actions = [];
  for (let tick = 0; tick < 40 && !state.solved; tick++) {
    const action = network.predict(encodeObservation(state, history)).action;
    state = step(state, action); actions.push(action); history.push(action);
    if (history.length > 2) history.shift();
  }
  return { id: level.id, start: level.start, solved: state.solved, decisions: state.tick, actions };
}
function demonstrate(actions) {
  let state = createState(source); const history = []; const samples = [];
  for (const action of actions) {
    samples.push({ input: Array.from(encodeObservation(state, history)), action, observationState: state, history: [...history], episodeId: 'human-route', sequenceStart: samples.length === 0 });
    state = step(state, action); history.push(action);
    if (history.length > 2) history.shift();
  }
  assert.equal(state.solved, true, 'The explicit teaching route must be an actual legal solution.');
  return samples;
}

try {
  for (const { name, actions, firstAction } of [
    { name: 'up-first', actions: [...Array(4).fill(0), ...Array(6).fill(1)], firstAction: 0 },
    { name: 'right-first', actions: [...Array(6).fill(1), ...Array(4).fill(0)], firstAction: 1 },
  ]) {
    const demonstrations = demonstrate(actions);
    const samples = augmentSamples(demonstrations, { symmetries: true, translations: true, maxSamples: 3000 });
    const network = new TinyNetwork(42);
    const before = holdouts.map(level => rollout(network, level));
    const epochs = Math.max(6, Math.min(120, Math.ceil(result.trainingBudget / samples.length)));
    const metrics = await network.train(samples, epochs, 16);
    const after = holdouts.map(level => rollout(network, level));
    const taught = rollout(network, source);
    const initialAction = network.preview(encodeObservation(createState(source)), new Float32Array(96)).action;
    const style = {
      name, originalExamples: demonstrations.length, augmentedExamples: samples.length,
      epochs, actualTrainingPresentations: epochs * samples.length, metrics,
      beforeSolved: before.filter(value => value.solved).length,
      afterSolved: after.filter(value => value.solved).length,
      initialAction, expectedInitialAction: firstAction, taught, holdouts: after,
      modelHash: createHash('sha256').update(network.serialize()).digest('hex'),
    };
    result.styles.push(style);
    console.log(JSON.stringify({ name, epochs, afterSolved: style.afterSolved, taughtSolved: taught.solved, initialAction }));
  }
  for (const style of result.styles) {
    assert.equal(style.taught.solved, true, `${style.name}: learned rollout must complete the taught room`);
    assert.equal(style.initialAction, style.expectedInitialAction, `${style.name}: preserve the demonstrated route preference`);
    assert.ok(style.afterSolved >= 3, `${style.name}: solve at least three unseen simple starts/layouts`);
    assert.ok(style.afterSolved > style.beforeSolved, `${style.name}: genuine improvement on withheld episodes`);
  }
  assert.notEqual(result.styles[0].modelHash, result.styles[1].modelHash);
  result.passed = true;
} catch (error) {
  result.failure = error.stack ?? String(error); process.exitCode = 1;
} finally {
  result.finishedAt = new Date().toISOString();
  await writeFile(new URL('transfer-benchmark-gru.json', artifacts), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed: result.passed, failure: result.failure, report: 'artifacts/transfer-benchmark-gru.json' }));
}
