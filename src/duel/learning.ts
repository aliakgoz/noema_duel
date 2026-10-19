import { MODEL_VERSION as BASE_MODEL_VERSION } from '../core/types';
import type { Action } from '../core/types';
import { ARCHITECTURE, BPTT_WINDOW, PARAMETER_COUNT, TinyNetwork } from '../ml/network';
import type { ActivationTrace, LayerParameters, NetworkSnapshot } from '../ml/network';
import { GRU_HIDDEN, recurrentBackward, recurrentForward, recurrentTensors } from '../ml/recurrent';
import type { RecurrentCache, RecurrentParameters, RecurrentSnapshot } from '../ml/recurrent';
import { COURT } from './types';
import { ROBOT_MAX_SPEED } from './engine';
import type { DuelState, ManualInput } from './types';

export const MODEL_VERSION = 'noema-duel-gru96-v1';
export const DUEL_INPUTS = 160;
export const DUEL_OUTPUTS = 6;
export const DUEL_ARCHITECTURE = ARCHITECTURE;
export const DUEL_PARAMETER_COUNT = PARAMETER_COUNT;
export const MAX_DUEL_SAMPLES = 8000;
export interface DuelSample { input: number[]; output: number[]; episodeId?: string; sequenceStart?: boolean }
export interface DuelModel extends NetworkSnapshot { recurrent: RecurrentSnapshot }
export interface DuelTrainingProgress { epoch: number; epochs: number; loss: number }
export interface DuelTrainingOptions { epochs?: number; onProgress?: (progress: DuelTrainingProgress) => void; signal?: AbortSignal }
export interface DuelTrainingResult { model: DuelModel; loss: number; epochs: number }
export interface DuelParameters { layers: LayerParameters[]; recurrent: RecurrentParameters; parameterCount: number; trainedSteps: number }

const clamp = (value: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, Number.isFinite(value) ? value : 0));
const sigmoid = (value: number) => 1 / (1 + Math.exp(-clamp(value, -40, 40)));
const MAX_PROJECTILE_SPEED = 18;
const runtimes = new WeakMap<DuelModel, { network: TinyNetwork; memory: Float32Array; trace?: ActivationTrace }>();
function randomGenerator(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
function abortIfNeeded(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException('Eğitim iptal edildi.', 'AbortError'); }
function snapshot(network: TinyNetwork): DuelModel { return { ...network.snapshot(), version: MODEL_VERSION } as DuelModel; }
function restore(value: unknown): TinyNetwork {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Geçersiz GRU modeli.');
  const model = value as DuelModel;
  if (model.version !== MODEL_VERSION || !Array.isArray(model.architecture) || model.architecture.length !== ARCHITECTURE.length || !ARCHITECTURE.every((size, i) => model.architecture[i] === size)) throw new Error('Uyumsuz GRU modeli.');
  // Reuse the original model's strict tensor, shape, version and numeric validation.
  return TinyNetwork.fromSnapshot({ ...model, version: BASE_MODEL_VERSION });
}
export function createDuelModel(seed = 42): DuelModel { return snapshot(new TinyNetwork(seed)); }
export function isDuelModel(value: unknown): value is DuelModel { try { restore(value); return true; } catch { return false; } }
function runtime(model: DuelModel) {
  let result = runtimes.get(model);
  if (!result) { result = { network: restore(model), memory: new Float32Array(GRU_HIDDEN) }; runtimes.set(model, result); }
  return result;
}
export function getDuelParameters(model: DuelModel): DuelParameters { return runtime(model).network; }
export function getDuelMemory(model: DuelModel): Float32Array { return runtime(model).memory.slice(); }
export function resetDuelMemory(model: DuelModel): void { const value = runtime(model); value.memory.fill(0); value.trace = undefined; }
export function getDuelTrace(model: DuelModel): ActivationTrace | undefined { return runtime(model).trace; }

/** 160 actual court sensors. Scripted decisions and oracle targets are never inputs. */
export function encodeDuelObservation(state: DuelState): number[] {
  const self = state.robots[0], enemy = state.robots[1];
  const dx = enemy.x - self.x, dz = enemy.z - self.z, distance = Math.hypot(dx, dz);
  const values = [
    self.x / COURT.halfWidth, self.z / COURT.halfDepth, self.vx / ROBOT_MAX_SPEED, self.vz / ROBOT_MAX_SPEED, self.hp / self.maxHp, self.cooldown / 1.2, Number(Boolean(self.carrying)), Math.sin(self.angle), Math.cos(self.angle), state.time / 180,
    dx / COURT.width, dz / COURT.depth, enemy.vx / ROBOT_MAX_SPEED, enemy.vz / ROBOT_MAX_SPEED, enemy.hp / enemy.maxHp, enemy.cooldown / 1.2, Number(Boolean(enemy.carrying)), distance / Math.hypot(COURT.width, COURT.depth), distance > 0 ? dx / distance : 0, distance > 0 ? dz / distance : 0,
  ];
  const shots = state.projectiles.filter(shot => shot.owner !== 0).sort((a, b) => Math.hypot(a.x - self.x, a.z - self.z) - Math.hypot(b.x - self.x, b.z - self.z));
  for (let i = 0; i < 4; i++) {
    const shot = shots[i];
    values.push(...(shot ? [(shot.x - self.x) / COURT.width, (shot.z - self.z) / COURT.depth, shot.vx / MAX_PROJECTILE_SPEED, shot.vz / MAX_PROJECTILE_SPEED, shot.damage / 26, 1] : [0, 0, 0, 0, 0, 0]));
  }
  const crates = state.crates.filter(crate => crate.hp > 0).slice().sort((a, b) => a.owner - b.owner || a.id.localeCompare(b.id));
  for (let i = 0; i < 4; i++) {
    const crate = crates[i];
    values.push(...(crate ? [(crate.x - self.x) / COURT.width, (crate.z - self.z) / COURT.depth, crate.hp / crate.maxHp, crate.owner === 0 ? 1 : -1, crate.carriedBy === null ? 0 : crate.carriedBy === 0 ? 1 : -1, 1] : [0, 0, 0, 0, 0, 0]));
  }
  const walls = state.walls.slice().sort((a, b) => Math.hypot(Math.max(0, Math.abs(a.x - self.x) - a.width / 2), Math.max(0, Math.abs(a.z - self.z) - a.depth / 2)) - Math.hypot(Math.max(0, Math.abs(b.x - self.x) - b.width / 2), Math.max(0, Math.abs(b.z - self.z) - b.depth / 2)) || a.id.localeCompare(b.id));
  for (let i = 0; i < 4; i++) {
    const wall = walls[i];
    values.push(...(wall ? [(wall.x - self.x) / COURT.width, (wall.z - self.z) / COURT.depth, wall.width / COURT.width, wall.depth / COURT.depth, wall.kind === 'bounce' ? 1 : -1, 1] : [0, 0, 0, 0, 0, 0]));
  }
  // Eight-by-eight local occupancy cells cover real boundaries, both wall kinds and movable cover.
  for (let row = 0; row < 8; row++) for (let column = 0; column < 8; column++) {
    const x = self.x + (column - 3.5) * 1.2, z = self.z + (row - 3.5) * 1.2;
    let cell = x < -COURT.halfWidth + COURT.robotRadius || x > -COURT.robotRadius || Math.abs(z) > COURT.halfDepth - COURT.robotRadius ? 1 : 0;
    if (!cell) {
      for (const wall of state.walls) if (Math.abs(x - wall.x) <= wall.width / 2 + .6 && Math.abs(z - wall.z) <= wall.depth / 2 + .6) cell = wall.kind === 'bounce' ? .75 : .35;
      for (const crate of state.crates) if (crate.hp > 0 && Math.abs(x - crate.x) <= crate.size / 2 + .6 && Math.abs(z - crate.z) <= crate.size / 2 + .6) cell = crate.owner === 0 ? -.75 : -1;
    }
    values.push(cell);
  }
  values.push((-self.x - COURT.robotRadius) / COURT.halfWidth, (self.x + COURT.halfWidth - COURT.robotRadius) / COURT.halfWidth, (self.z + COURT.halfDepth - COURT.robotRadius) / COURT.depth, (COURT.halfDepth - self.z - COURT.robotRadius) / COURT.depth);
  return values.map(value => clamp(value));
}

/** Keep six compatible model outputs; the former power slot is fixed to one. */
export function encodeDuelAction(state: DuelState, input: ManualInput): number[] {
  const self = state.robots[0];
  let mx = clamp(input.move.x), mz = clamp(input.move.z);
  const length = Math.hypot(mx, mz);
  if (length > 1) { mx /= length; mz /= length; }
  const dx = input.aim.x - self.x, dz = input.aim.z - self.z;
  return [mx, mz, Number.isFinite(dx) && Number.isFinite(dz) ? Math.atan2(dz, dx) / Math.PI : 0, 1, Number(Boolean(input.fire)), Number(Boolean(input.interact))];
}

interface ForwardResult { activations: Float32Array[]; logits: Float32Array; recurrent: RecurrentCache }
function forward(network: TinyNetwork, input: Float32Array, memory: Float32Array): ForwardResult {
  const first = network.layers[0], hidden = new Float32Array(96);
  for (let j = 0; j < 96; j++) {
    let sum = first.biases[j];
    for (let i = 0; i < DUEL_INPUTS; i++) sum += first.weights[j * DUEL_INPUTS + i] * input[i];
    hidden[j] = Math.tanh(sum);
  }
  const recurrent = recurrentForward(network.recurrent, hidden, memory);
  const second = network.layers[1], next = new Float32Array(64);
  for (let j = 0; j < 64; j++) {
    let sum = second.biases[j];
    for (let i = 0; i < GRU_HIDDEN; i++) sum += second.weights[j * GRU_HIDDEN + i] * recurrent.memory[i];
    next[j] = Math.tanh(sum);
  }
  const output = network.layers[2], logits = new Float32Array(6), motors = new Float32Array(6);
  for (let j = 0; j < 6; j++) {
    let sum = output.biases[j];
    for (let i = 0; i < 64; i++) sum += output.weights[j * 64 + i] * next[i];
    logits[j] = sum;
    motors[j] = j < 2 ? Math.tanh(sum) : j === 2 ? Math.atan2(Math.sin(sum), Math.cos(sum)) / Math.PI : sigmoid(sum);
  }
  return { activations: [input, hidden, recurrent.memory, next, motors], logits, recurrent };
}
function traceOf(result: ForwardResult): ActivationTrace {
  const motors = Array.from(result.activations[4]);
  let action = 0;
  for (let j = 1; j < 6; j++) if (Math.abs(motors[j]) > Math.abs(motors[action])) action = j;
  const r = result.recurrent;
  return { layers: result.activations.map(values => Array.from(values)), logits: Array.from(result.logits), probabilities: motors, action: action as Action, recurrent: { previous: Array.from(r.previous), reset: Array.from(r.reset), update: Array.from(r.update), candidate: Array.from(r.candidate), memory: Array.from(r.memory) } };
}
export function previewDuel(model: DuelModel, state: DuelState): ActivationTrace {
  const value = runtime(model);
  return traceOf(forward(value.network, Float32Array.from(encodeDuelObservation(state)), value.memory));
}
/** Exactly one learned GRU step, with transient memory kept outside the JSON model. */
export function predictDuel(model: DuelModel, state: DuelState): ManualInput {
  const value = runtime(model), result = forward(value.network, Float32Array.from(encodeDuelObservation(state)), value.memory);
  value.memory = result.recurrent.memory; value.trace = traceOf(result);
  const motors = result.activations[4], self = state.robots[0], angle = result.logits[2];
  const move = { x: Math.abs(motors[0]) < .12 ? 0 : motors[0], z: Math.abs(motors[1]) < .12 ? 0 : motors[1] };
  const length = Math.hypot(move.x, move.z);
  if (length > 1) { move.x /= length; move.z /= length; }
  return { move, aim: { x: self.x + Math.cos(angle) * COURT.width, z: self.z + Math.sin(angle) * COURT.width }, power: 1, fire: motors[4] >= .5, interact: motors[5] >= .5 };
}

interface PreparedSample { input: Float32Array; output: Float32Array; episodeId?: string; sequenceStart?: boolean }
function prepare(samples: DuelSample[]): PreparedSample[] {
  if (!Array.isArray(samples) || !samples.length || samples.length > MAX_DUEL_SAMPLES) throw new Error('Eğitim için 1–8000 geçerli örnek gerekli.');
  return samples.map(sample => {
    if (!sample || !Array.isArray(sample.input) || sample.input.length !== DUEL_INPUTS || !Array.isArray(sample.output) || sample.output.length !== DUEL_OUTPUTS) throw new Error('Eğitim örneğinin boyutu hatalı.');
    if (!Array.from(sample.input).every(value => Number.isFinite(value) && Math.abs(value) <= 1.000001) || !Array.from(sample.output).every((value, i) => Number.isFinite(value) && value >= (i >= 3 ? 0 : -1) && value <= 1)) throw new Error('Eğitim örneği geçersiz sayılar içeriyor.');
    if (sample.episodeId !== undefined && (typeof sample.episodeId !== 'string' || !sample.episodeId.length || sample.episodeId.length > 240)) throw new Error('Geçersiz gösterim dizisi.');
    if (sample.sequenceStart !== undefined && typeof sample.sequenceStart !== 'boolean') throw new Error('Geçersiz dizi sınırı.');
    return { input: Float32Array.from(sample.input), output: Float32Array.from(sample.output), episodeId: sample.episodeId, sequenceStart: sample.sequenceStart };
  });
}
function episodes(samples: PreparedSample[]): PreparedSample[][] {
  const result: PreparedSample[][] = [];
  for (const sample of samples) {
    const last = result.at(-1), previous = last?.at(-1);
    if (!sample.episodeId || sample.sequenceStart || !previous || previous.episodeId !== sample.episodeId) result.push([sample]);
    else last!.push(sample);
  }
  return result;
}
interface BinaryWeight { positive: number; negative: number }
function binaryWeights(dataset: PreparedSample[]): BinaryWeight[] {
  return [4, 5].map(index => {
    const positive = dataset.filter(sample => sample.output[index] >= .5).length, negative = dataset.length - positive;
    return { positive: positive && negative ? Math.min(12, dataset.length / (2 * positive)) : 1, negative: positive && negative ? Math.min(12, dataset.length / (2 * negative)) : 1 };
  });
}
function gradientsOf(network: TinyNetwork): Float32Array[] {
  return [...network.layers.map(layer => new Float32Array(layer.weights.length + layer.biases.length)), ...recurrentTensors(network.recurrent).map(tensor => new Float32Array(tensor.length))];
}
function motorLoss(result: ForwardResult, target: Float32Array, balance: BinaryWeight[]): { loss: number; delta: Float32Array } {
  const motors = result.activations[4], delta = new Float32Array(6);
  let loss = 0;
  for (let j = 0; j < 6; j++) {
    // Preserve the compatible model shape without spending training on an unused control.
    if (j === 3) continue;
    const predicted = motors[j], expected = target[j];
    if (j < 2) { loss += 1.6 * (predicted - expected) ** 2; delta[j] = 3.2 * (predicted - expected) * (1 - predicted * predicted); }
    else if (j === 2) {
      const difference = result.logits[2] - expected * Math.PI;
      loss += 1.2 * (1 - Math.cos(difference)); delta[j] = 1.2 * Math.sin(difference);
    } else {
      const weight = .6 * (expected >= .5 ? balance[j - 4].positive : balance[j - 4].negative);
      loss -= weight * (expected * Math.log(Math.max(1e-7, predicted)) + (1 - expected) * Math.log(Math.max(1e-7, 1 - predicted)));
      delta[j] = weight * (predicted - expected);
    }
  }
  return { loss, delta };
}
function differentiateSequence(network: TinyNetwork, samples: PreparedSample[], initial: Float32Array, gradients: Float32Array[], balance: BinaryWeight[]): { loss: number; memory: Float32Array } {
  const results: ForwardResult[] = [];
  let memory = initial, loss = 0;
  for (const sample of samples) { const result = forward(network, sample.input, memory); results.push(result); memory = result.recurrent.memory; }
  let temporal: Float32Array = new Float32Array(GRU_HIDDEN);
  for (let time = samples.length - 1; time >= 0; time--) {
    const result = results[time], [input, first, recurrentMemory, second] = result.activations;
    const error = motorLoss(result, samples[time].output, balance); loss += error.loss;
    const deltaSecond = new Float32Array(64);
    for (let j = 0; j < 6; j++) {
      gradients[2][network.layers[2].weights.length + j] += error.delta[j];
      for (let i = 0; i < 64; i++) { gradients[2][j * 64 + i] += error.delta[j] * second[i]; deltaSecond[i] += network.layers[2].weights[j * 64 + i] * error.delta[j]; }
    }
    const deltaMemory = temporal;
    for (let j = 0; j < 64; j++) {
      const delta = deltaSecond[j] * (1 - second[j] * second[j]);
      gradients[1][network.layers[1].weights.length + j] += delta;
      for (let i = 0; i < GRU_HIDDEN; i++) { gradients[1][j * GRU_HIDDEN + i] += delta * recurrentMemory[i]; deltaMemory[i] += network.layers[1].weights[j * GRU_HIDDEN + i] * delta; }
    }
    const recurrentDelta = recurrentBackward(network.recurrent, result.recurrent, deltaMemory, gradients.slice(3));
    temporal = recurrentDelta.previous;
    for (let j = 0; j < 96; j++) {
      const delta = recurrentDelta.input[j] * (1 - first[j] * first[j]);
      gradients[0][network.layers[0].weights.length + j] += delta;
      for (let i = 0; i < DUEL_INPUTS; i++) gradients[0][j * DUEL_INPUTS + i] += delta * input[i];
    }
  }
  return { loss, memory };
}
/** Numerical-audit entry point; no inference memory is read or changed. */
export function duelSequenceLossAndGradients(model: DuelModel, samples: DuelSample[], initialMemory?: ArrayLike<number>): { loss: number; gradients: Float32Array[] } {
  if (!samples.length || samples.length > BPTT_WINDOW) throw new Error('BPTT dizisi 1–32 adım içermeli.');
  const network = runtime(model).network, dataset = prepare(samples), gradients = gradientsOf(network);
  const initial = initialMemory ? Float32Array.from(initialMemory) : new Float32Array(GRU_HIDDEN);
  if (initial.length !== GRU_HIDDEN || !Array.from(initial).every(value => Number.isFinite(value) && Math.abs(value) <= 1)) throw new Error('Geçersiz GRU belleği.');
  const result = differentiateSequence(network, dataset, initial, gradients, binaryWeights(dataset));
  for (const gradient of gradients) for (let i = 0; i < gradient.length; i++) gradient[i] /= samples.length;
  return { loss: result.loss / samples.length, gradients };
}
function* trainingSteps(samples: DuelSample[], initial: DuelModel | undefined, options: DuelTrainingOptions): Generator<DuelTrainingProgress | undefined, DuelTrainingResult> {
  abortIfNeeded(options.signal);
  const epochs = options.epochs ?? 1;
  if (!Number.isInteger(epochs) || epochs < 1 || epochs > 500) throw new Error('Eğitim turu 1–500 arasında olmalı.');
  const dataset = prepare(samples), source = initial ?? createDuelModel(), grouped = episodes(dataset);
  // A separate original GRU instance keeps the active model and its live memory untouched.
  const network = restore(source), random = randomGenerator((network.seed + network.trainedSteps + 91) >>> 0);
  const gradients = gradientsOf(network), moments = gradients.map(gradient => new Float32Array(gradient.length)), variances = gradients.map(gradient => new Float32Array(gradient.length));
  const balance = binaryWeights(dataset), order = grouped.map((_, i) => i), batchSize = Math.min(32, Math.max(8, Math.ceil(dataset.length / 3)));
  let updates = 0, pending = 0, loss = 0, yieldedAt = performance.now();
  const flush = () => {
    if (!pending) return;
    updates++;
    const correction1 = 1 - .9 ** updates, correction2 = 1 - .999 ** updates, recurrent = recurrentTensors(network.recurrent);
    let norm = 0;
    for (const gradient of gradients) for (const value of gradient) norm += (value / pending) ** 2;
    const scale = Math.min(1, 5 / Math.max(1e-12, Math.sqrt(norm)));
    for (let group = 0; group < gradients.length; group++) {
      const layer = network.layers[group], gradient = gradients[group];
      for (let i = 0; i < gradient.length; i++) {
        const g = gradient[i] / pending * scale;
        const first = moments[group][i] = .9 * moments[group][i] + .1 * g, second = variances[group][i] = .999 * variances[group][i] + .001 * g * g;
        // Recurrent tensors follow the three dense W+b groups.
        const target = group < 3 ? (i < layer.weights.length ? layer.weights : layer.biases) : recurrent[group - 3], offset = group < 3 && i >= layer.weights.length ? i - layer.weights.length : i;
        target[offset] = clamp(target[offset] - .003 * (first / correction1) / (Math.sqrt(second / correction2) + 1e-8), -32, 32);
      }
    }
    network.trainedSteps += pending; pending = 0;
    for (const gradient of gradients) gradient.fill(0);
  };
  for (let epoch = 1; epoch <= epochs; epoch++) {
    abortIfNeeded(options.signal);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    let totalLoss = 0;
    for (const index of order) {
      let memory: Float32Array = new Float32Array(GRU_HIDDEN);
      const episode = grouped[index];
      for (let start = 0; start < episode.length; start += BPTT_WINDOW) {
        abortIfNeeded(options.signal);
        const window = episode.slice(start, start + BPTT_WINDOW), result = differentiateSequence(network, window, memory, gradients, balance);
        memory = result.memory; totalLoss += result.loss; pending += window.length;
        if (pending >= batchSize) flush();
        if (performance.now() - yieldedAt > 8) { yield undefined; yieldedAt = performance.now(); }
      }
    }
    flush(); loss = totalLoss / dataset.length;
    if (!Number.isFinite(loss)) throw new Error('Eğitim sonlu bir kayıp üretemedi.');
    yield { epoch, epochs, loss }; yieldedAt = performance.now();
  }
  abortIfNeeded(options.signal);
  return { model: snapshot(network), loss, epochs };
}
export function trainSync(samples: DuelSample[], model?: DuelModel, options: DuelTrainingOptions = {}): DuelTrainingResult {
  const steps = trainingSteps(samples, model, options);
  for (;;) { const step = steps.next(); if (step.done) return step.value; if (step.value) options.onProgress?.(step.value); }
}
async function trainCooperatively(samples: DuelSample[], model: DuelModel | undefined, options: DuelTrainingOptions): Promise<DuelTrainingResult> {
  const steps = trainingSteps(samples, model, options);
  for (;;) {
    abortIfNeeded(options.signal);
    const step = steps.next();
    if (step.done) return step.value;
    if (step.value) options.onProgress?.(step.value);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
}
export async function trainDuel(samples: DuelSample[], model?: DuelModel, options: DuelTrainingOptions = {}): Promise<DuelTrainingResult> {
  abortIfNeeded(options.signal);
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return trainCooperatively(samples, model, options);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./learning.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => { options.signal?.removeEventListener('abort', abort); worker.terminate(); };
    const abort = () => { finish(); reject(new DOMException('Eğitim iptal edildi.', 'AbortError')); };
    options.signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = event => { finish(); reject(new Error(event.message || 'GRU eğitim işçisi başlatılamadı.')); };
    worker.onmessage = (event: MessageEvent<{ type: string; progress?: DuelTrainingProgress; model?: DuelModel; loss?: number; epochs?: number; message?: string }>) => {
      const message = event.data;
      if (message.type === 'progress' && message.progress) options.onProgress?.(message.progress);
      else if (message.type === 'complete') {
        finish();
        if (!isDuelModel(message.model) || !Number.isFinite(message.loss) || !Number.isInteger(message.epochs)) reject(new Error('Eğitim işçisi geçersiz GRU modeli döndürdü.'));
        else resolve({ model: message.model, loss: message.loss!, epochs: message.epochs! });
      } else if (message.type === 'error') { finish(); reject(new Error(message.message || 'GRU eğitimi tamamlanamadı.')); }
    };
    worker.postMessage({ type: 'train', samples, model, epochs: options.epochs });
  });
}
