/**
 * Read exported, actually trained candidate weights and run them in the real
 * NOEMA engine. This is a research harness, not a change to the live model.
 * No solution certificate, teacher label, or search chooses rollout actions.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createState, step } from '../src/core/engine.ts';
import { encodeObservation } from '../src/core/observation.ts';
import type { Action, GameState, Level } from '../src/core/types.ts';

type Architecture = 'mlp' | 'gru' | 'map' | 'residual-map-gru' | 'capacity-mlp';
interface TensorJSON { shape: number[]; values: number[] }
interface Tensor { shape: number[]; values: Float32Array }
interface ParityStep { observation: number[]; mapSparse: number[]; logits: number[] }
interface ModelJSON {
  id: string; architecture: Architecture; seed: number; parameterCount: number;
  stateDict: Record<string, TensorJSON>;
  training?: unknown;
  parity: { episodeId: string; steps: ParityStep[] }[];
}
interface Episode {
  id: string; split: string; baseLevelId: string; seed?: number; variantKind?: string;
  level: Level; initialState?: GameState; taskFamily?: string; family?: string;
  actions: Action[]; observations: number[][]; mapSparse: number[][];
}
interface Dataset { episodes: Episode[]; observationSize: number; mapShape: number[] }
type SparseEncoder = (state: GameState) => number[];
const WIDTH = 20;
const f32 = Math.fround;
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Native row-major affine transform; float32 layer boundaries match PyTorch. */
function affine(input: Float32Array, weight: Tensor, bias?: Tensor): Float32Array {
  const [outputs, inputs] = weight.shape;
  assert.equal(input.length, inputs);
  const result = new Float32Array(outputs);
  for (let j = 0; j < outputs; j++) {
    let sum = bias?.values[j] ?? 0;
    const offset = j * inputs;
    for (let i = 0; i < inputs; i++) sum += weight.values[offset + i] * input[i];
    result[j] = sum;
  }
  return result;
}
function tanh(input: Float32Array): Float32Array {
  for (let i = 0; i < input.length; i++) input[i] = Math.tanh(input[i]);
  return input;
}

/** PyTorch CHW Conv2d cross-correlation: kernel3, stride2, padding1, ReLU. */
function convolution(input: Float32Array, width: number, weight: Tensor, bias: Tensor): Float32Array {
  const [outputs, channels, kh, kw] = weight.shape;
  assert.equal(kh, 3); assert.equal(kw, 3);
  const nextWidth = Math.floor((width + 2 - 3) / 2) + 1;
  const result = new Float32Array(outputs * nextWidth * nextWidth);
  for (let oc = 0; oc < outputs; oc++) {
    for (let oz = 0; oz < nextWidth; oz++) for (let ox = 0; ox < nextWidth; ox++) {
      let sum = bias.values[oc];
      for (let ic = 0; ic < channels; ic++) {
        const weightBase = (oc * channels + ic) * 9;
        const inputBase = ic * width * width;
        for (let kz = 0; kz < 3; kz++) {
          const iz = oz * 2 + kz - 1;
          if (iz < 0 || iz >= width) continue;
          for (let kx = 0; kx < 3; kx++) {
            const ix = ox * 2 + kx - 1;
            if (ix >= 0 && ix < width) sum += input[inputBase + iz * width + ix] * weight.values[weightBase + kz * 3 + kx];
          }
        }
      }
      result[(oc * nextWidth + oz) * nextWidth + ox] = Math.max(0, sum);
    }
  }
  return result;
}

export class ExperimentalPolicy {
  readonly tensors: Record<string, Tensor>;
  readonly architecture: Architecture;
  private hidden = new Float32Array(96);
  private mapCache = new Map<string, Float32Array>();
  constructor(readonly model: ModelJSON) {
    this.architecture = model.architecture;
    assert(['mlp', 'gru', 'map', 'residual-map-gru', 'capacity-mlp'].includes(this.architecture), `Unknown architecture ${this.architecture}`);
    this.tensors = Object.fromEntries(Object.entries(model.stateDict).map(([name, tensor]) => {
      assert.equal(tensor.values.length, tensor.shape.reduce((a, b) => a * b, 1), `Invalid tensor ${name}`);
      assert(tensor.values.every(Number.isFinite), `Nonfinite tensor ${name}`);
      return [name, { shape: tensor.shape, values: Float32Array.from(tensor.values) }];
    }));
    assert.equal(Object.values(this.tensors).reduce((sum, tensor) => sum + tensor.values.length, 0), model.parameterCount);
  }
  reset(): void { this.hidden.fill(0); }
  private linear(name: string, input: Float32Array, bias = true): Float32Array {
    const weight = this.tensors[`${name}.weight`];
    assert(weight, `Missing tensor ${name}.weight`);
    return affine(input, weight, bias ? this.tensors[`${name}.bias`] : undefined);
  }
  private mapFeatures(sparse: number[]): Float32Array {
    const key = sparse.join(',');
    const cached = this.mapCache.get(key);
    if (cached) return cached;
    const input = new Float32Array(16 * WIDTH * WIDTH);
    assert.equal(sparse.length % 2, 0);
    for (let i = 0; i < sparse.length; i += 2) {
      assert(Number.isInteger(sparse[i]) && sparse[i] >= 0 && sparse[i] < input.length);
      input[sparse[i]] = sparse[i + 1];
    }
    const first = convolution(input, WIDTH, this.tensors['mapEncoder.conv1.weight'], this.tensors['mapEncoder.conv1.bias']);
    const second = convolution(first, 10, this.tensors['mapEncoder.conv2.weight'], this.tensors['mapEncoder.conv2.bias']);
    const result = tanh(this.linear('mapEncoder.fc', second));
    // Bounded cache changes speed only. Recurrent hidden state is never cached.
    if (this.mapCache.size >= 4096) this.mapCache.clear();
    this.mapCache.set(key, result);
    return result;
  }
  private recurrent(input: Float32Array): Float32Array {
    const incoming = affine(input, this.tensors['gru.weight_ih_l0'], this.tensors['gru.bias_ih_l0']);
    const previous = affine(this.hidden, this.tensors['gru.weight_hh_l0'], this.tensors['gru.bias_hh_l0']);
    const next = new Float32Array(96);
    for (let i = 0; i < 96; i++) {
      const reset = f32(sigmoid(f32(incoming[i] + previous[i])));
      const update = f32(sigmoid(f32(incoming[96 + i] + previous[96 + i])));
      const candidate = f32(Math.tanh(f32(incoming[192 + i] + f32(reset * previous[192 + i]))));
      next[i] = f32(f32((1 - update) * candidate) + f32(update * this.hidden[i]));
    }
    this.hidden = next;
    return next;
  }
  logits(observation: ArrayLike<number>, sparse: number[] = []): Float32Array {
    assert.equal(observation.length, 160);
    const first = tanh(this.linear('fc1', Float32Array.from(observation)));
    if (this.architecture === 'capacity-mlp') {
      return this.linear('head', tanh(this.linear('fc3', tanh(this.linear('fc2', first)))));
    }
    let second: Float32Array;
    if (this.architecture === 'gru') {
      second = this.linear('fc2', this.recurrent(first));
    } else {
      second = this.linear('fc2', first);
      if (this.architecture === 'map' || this.architecture === 'residual-map-gru') {
        const map = this.mapFeatures(sparse);
        let residualInput = map;
        if (this.architecture === 'residual-map-gru') {
          const combined = new Float32Array(96);
          combined.set(first); combined.set(map, 64);
          residualInput = this.recurrent(combined);
        }
        const residual = this.linear('projection', residualInput, false);
        for (let i = 0; i < second.length; i++) second[i] += residual[i];
      }
    }
    return this.linear('head', tanh(second));
  }
  action(observation: ArrayLike<number>, sparse: number[] = []): Action {
    const logits = this.logits(observation, sparse);
    let selected = 0;
    for (let i = 1; i < logits.length; i++) if (logits[i] > logits[selected]) selected = i;
    return selected as Action;
  }
}

function physicalKey(state: GameState): string {
  return JSON.stringify([state.robot, state.crates, state.switches, state.doors, state.sequenceProgress ?? {}, state.solved]);
}
function family(episode: Episode): string {
  return episode.taskFamily ?? episode.family ?? `chapter-${episode.level.chapter}`;
}
export function validateParity(policy: ExperimentalPolicy): { steps: number; maxAbsoluteError: number; tolerance: number } {
  let maxAbsoluteError = 0, steps = 0;
  assert(policy.model.parity?.length, `No Python parity traces for ${policy.model.id}`);
  for (const trace of policy.model.parity) {
    policy.reset();
    for (const sample of trace.steps) {
      const actual = policy.logits(sample.observation, sample.mapSparse);
      assert.equal(sample.logits.length, actual.length);
      for (let i = 0; i < actual.length; i++) maxAbsoluteError = Math.max(maxAbsoluteError, Math.abs(actual[i] - sample.logits[i]));
      steps++;
    }
  }
  assert(steps >= 3, `Too few parity steps for ${policy.model.id}`);
  assert(maxAbsoluteError <= 1e-4, `Python/TypeScript logits mismatch: ${policy.model.id}, maximum ${maxAbsoluteError}`);
  return { steps, maxAbsoluteError, tolerance: 1e-4 };
}
function summarize(results: CaseResult[]) {
  const decisions = results.reduce((sum, result) => sum + result.decisions, 0);
  const solved = results.filter(result => result.solved);
  const bases = [...new Set(results.map(result => result.baseLevelId))];
  const macroBaseSuccessRate = bases.length ? bases.reduce((sum, base) => {
    const selected = results.filter(result => result.baseLevelId === base);
    return sum + selected.filter(result => result.solved).length / selected.length;
  }, 0) / bases.length : 0;
  return {
    cases: results.length, solved: solved.length, successRate: results.length ? solved.length / results.length : 0,
    uniqueBaseRooms: bases.length, macroBaseSuccessRate,
    totalDecisions: decisions, meanDecisions: results.length ? decisions / results.length : 0,
    meanSuccessfulDecisions: solved.length ? solved.reduce((sum, result) => sum + result.decisions, 0) / solved.length : null,
    casesWithRepeatedPhysicalState: results.filter(result => result.repeatedPhysicalVisits > 0).length,
    noPhysicalChangeActions: results.reduce((sum, result) => sum + result.noPhysicalChangeActions, 0),
  };
}
interface CaseResult {
  id: string; split: string; baseLevelId: string; taskFamily: string;
  solved: boolean; decisions: number; moves: number; interactions: number;
  distinctPhysicalStates: number; repeatedPhysicalVisits: number; maxPhysicalVisits: number;
  noPhysicalChangeActions: number; actions: Action[]; elapsedMs: number;
}
export function evaluateEpisode(policy: ExperimentalPolicy, episode: Episode, encodeMap: SparseEncoder, budget = 220): CaseResult {
  let state = episode.initialState ? structuredClone(episode.initialState) : createState(episode.level);
  const history: Action[] = [], actions: Action[] = [];
  const visits = new Map<string, number>();
  let key = physicalKey(state), noPhysicalChangeActions = 0;
  visits.set(key, 1); policy.reset();
  const started = performance.now();
  for (let decision = 0; decision < budget && !state.solved; decision++) {
    const action = policy.action(encodeObservation(state, history), policy.architecture.includes('map') ? encodeMap(state) : []);
    state = step(state, action);
    const nextKey = physicalKey(state);
    if (nextKey === key) noPhysicalChangeActions++;
    visits.set(nextKey, (visits.get(nextKey) ?? 0) + 1); key = nextKey;
    actions.push(action); history.push(action);
    if (history.length > 16) history.shift();
    // A repeated physical state is only a diagnostic: GRU hidden may differ.
  }
  return {
    id: episode.id, split: episode.split, baseLevelId: episode.baseLevelId, taskFamily: family(episode),
    solved: state.solved, decisions: actions.length, moves: state.moves, interactions: state.interactions,
    distinctPhysicalStates: visits.size, repeatedPhysicalVisits: [...visits.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0),
    maxPhysicalVisits: Math.max(...visits.values()), noPhysicalChangeActions, actions, elapsedMs: performance.now() - started,
  };
}

async function main() {
  const arguments_ = process.argv.slice(2);
  const positional = arguments_.filter(argument => !argument.startsWith('--'));
  const directory = positional[0] ?? 'artifacts/gru-experiment';
  const datasetPath = positional[1] ?? `${directory}/dataset.json`;
  const parityOnly = arguments_.includes('--parity-only');
  const outputName = arguments_.find(argument => argument.startsWith('--output-name='))?.slice('--output-name='.length)
    ?? (parityOnly ? 'numerical-parity' : 'closed-loop-results');
  assert(/^[a-zA-Z0-9_-]+$/.test(outputName), 'Invalid output filename');
  const modelSelection = arguments_.find(argument => argument.startsWith('--models='))?.slice('--models='.length).split(',');
  const [modelsJSON, datasetJSON] = await Promise.all([
    readFile(`${directory}/models.json`, 'utf8'), readFile(datasetPath, 'utf8'),
  ]);
  const exported = JSON.parse(modelsJSON) as { models: ModelJSON[]; config?: { datasetSHA256?: string } };
  const dataset = JSON.parse(datasetJSON) as Dataset;
  const datasetSHA256 = createHash('sha256').update(datasetJSON).digest('hex');
  if (exported.config?.datasetSHA256) assert.equal(datasetSHA256, exported.config.datasetSHA256, 'Training/evaluation dataset mismatch');
  assert.equal(dataset.observationSize, 160);
  assert.deepEqual(dataset.mapShape, [16, 20, 20]);
  // Dataset encoder is shared with export so channel meanings cannot silently drift.
  const encoderModule = await import('./export-gru-experiment.ts');
  const encodeMap = encoderModule.encodeMapSparse as SparseEncoder;
  assert.equal(typeof encodeMap, 'function');
  for (const episode of dataset.episodes) {
    const initial = episode.initialState ?? createState(episode.level);
    assert.deepEqual(encodeMap(initial), episode.mapSparse[0], `Map encoding drift: ${episode.id}`);
    assert.deepEqual(Array.from(encodeObservation(initial, [])), episode.observations[0], `Observation encoding drift: ${episode.id}`);
  }
  const trainingBases = new Set(dataset.episodes.filter(episode => episode.split === 'train').map(episode => episode.baseLevelId));
  const physicalConditions = new Set<string>();
  for (const episode of dataset.episodes) {
    const room = episode.level;
    const fingerprint = JSON.stringify([room.tiles, room.start, room.facing, room.crates, room.switches, room.doors, room.goals, room.surfaces ?? [], room.sequences ?? []]);
    assert(!physicalConditions.has(fingerprint), `Repeated physical condition in dataset: ${episode.id}`);
    physicalConditions.add(fingerprint);
  }
  for (const episode of dataset.episodes.filter(episode => episode.split === 'test-room')) {
    assert(!trainingBases.has(episode.baseLevelId), `Held-out room leakage: ${episode.baseLevelId}`);
  }
  const modelResults = [];
  const selectedModels = exported.models.filter(model => !modelSelection || modelSelection.includes(model.id) || modelSelection.includes(model.architecture));
  assert(selectedModels.length, 'No selected models');
  for (const model of selectedModels) {
    const policy = new ExperimentalPolicy(model);
    const numericParity = validateParity(policy);
    if (parityOnly) {
      modelResults.push({ id: model.id, architecture: model.architecture, seed: model.seed, numericParity });
      console.log(JSON.stringify({ model: model.id, seed: model.seed, parity: numericParity }));
      continue;
    }
    const started = performance.now();
    const cases: CaseResult[] = [];
    for (const episode of dataset.episodes) {
      cases.push(evaluateEpisode(policy, episode, encodeMap));
      if (cases.length % 50 === 0) console.log(JSON.stringify({ model: model.id, seed: model.seed, casesEvaluated: cases.length, totalCases: dataset.episodes.length }));
    }
    const splits = [...new Set(cases.map(result => result.split))];
    const families = [...new Set(cases.map(result => result.taskFamily))];
    const bySplit = Object.fromEntries(splits.map(split => [split, summarize(cases.filter(result => result.split === split))]));
    const bySplitAndFamily = Object.fromEntries(splits.map(split => [split, Object.fromEntries(families.map(taskFamily => [taskFamily,
      summarize(cases.filter(result => result.split === split && result.taskFamily === taskFamily)),
    ]))]));
    const result = { id: model.id, architecture: model.architecture, seed: model.seed, parameterCount: model.parameterCount,
      training: model.training, numericParity, elapsedMs: performance.now() - started, bySplit, bySplitAndFamily, cases };
    modelResults.push(result);
    console.log(JSON.stringify({ model: model.id, seed: model.seed, parity: numericParity, bySplit }));
  }
  const report = {
    schemaVersion: 1, generatedAt: new Date().toISOString(), status: 'passed', mode: parityOnly ? 'numerical-parity-only' : 'closed-loop', decisionBudget: 220,
    environment: { runtime: process.version, platform: process.platform, architecture: process.arch },
    semantics: 'Each policy receives live encoded game state; only model argmax chooses actions. Hidden state resets per episode and is retained within episode. No solver, teacher labels, correction or training during rollouts. Repeated physical states never terminate a rollout.',
    limitations: ['CPU desktop research experiment; no phone inference or training performance measured.',
      'Teacher demonstrations are authored solution certificates, not human play; results do not establish end-user learning quality.',
      'Equal examples and epochs do not imply equal floating-point computation or training wall time.'],
    datasetSHA256, uniqueTrainingBaseRooms: trainingBases.size, uniquePhysicalConditions: physicalConditions.size,
    episodes: dataset.episodes.length, models: modelResults,
  };
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/${outputName}.json`, JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
