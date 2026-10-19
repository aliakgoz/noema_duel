import { MODEL_INPUTS, MODEL_VERSION, type Action } from '../core/types';
import {
  createRecurrent, GRU_HIDDEN, GRU_PARAMETER_COUNT, recurrentBackward, recurrentForward, recurrentTensors,
  type RecurrentCache, type RecurrentParameters, type RecurrentSnapshot, type RecurrentTrace,
} from './recurrent';
export { GRU_INPUTS, GRU_HIDDEN, GRU_PARAMETER_COUNT } from './recurrent';
export type { RecurrentParameters, RecurrentSnapshot, RecurrentTrace } from './recurrent';

export const ARCHITECTURE = [MODEL_INPUTS, 96, GRU_HIDDEN, 64, 6] as const;
export const PARAMETER_COUNT = MODEL_INPUTS * 96 + 96 + GRU_PARAMETER_COUNT + 96 * 64 + 64 + 64 * 6 + 6;
export const MAX_MODEL_BYTES = 2 * 1024 * 1024;
export const BPTT_WINDOW = 32;
const MAX_WEIGHT = 32;

export interface TrainingSample {
  input: number[]; action: Action;
  /** Contiguous ordered demonstrations only; absent ids are independent examples. */
  episodeId?: string; sequenceStart?: boolean;
}
export interface ActivationTrace {
  /** Input160 → perception96 → GRU96 → hidden64 → softmax6. */
  layers: number[][]; logits: number[]; action: Action; probabilities: number[];
  recurrent?: RecurrentTrace;
}
export interface TrainingProgress { epoch: number; totalEpochs: number; loss: number; accuracy: number; examplesSeen: number }
export interface TrainingMetrics { loss: number; accuracy: number; epochs: number; samples: number; durationMs: number }
export interface LayerParameters { inputs: number; outputs: number; weights: Float32Array; biases: Float32Array }
export interface NetworkSnapshot {
  version: string; architecture: number[]; weights: number[][]; biases: number[][];
  recurrent?: RecurrentSnapshot;
  trainedSteps: number; seed: number;
}
interface PreparedSample { input: Float32Array; action: Action; episodeId?: string; sequenceStart?: boolean }
interface ForwardResult { activations: Float32Array[]; logits: Float32Array; recurrent: RecurrentCache }

function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state + 0x6d2b79f5) >>> 0; let value = Math.imul(state ^ (state >>> 15), 1 | state); value ^= value + Math.imul(value ^ (value >>> 7), 61 | value); return ((value ^ (value >>> 14)) >>> 0) / 4294967296; };
}
function checkedInput(input: ArrayLike<number>): Float32Array {
  if (!input || input.length !== MODEL_INPUTS) throw new Error(`Model input must contain exactly ${MODEL_INPUTS} values.`);
  const result = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) { if (!Number.isFinite(input[i]) || Math.abs(input[i]) > 1e6) throw new Error('Model input contains an invalid number.'); result[i] = input[i]; }
  return result;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function checkedArray(value: unknown, count: number): Float32Array {
  if (!Array.isArray(value) || value.length !== count) throw new Error('Invalid model tensor shape.');
  const result = new Float32Array(count);
  for (let i = 0; i < count; i++) { const entry: unknown = value[i]; if (typeof entry !== 'number' || !Number.isFinite(entry) || Math.abs(entry) > MAX_WEIGHT) throw new Error('Model weights must be finite numbers within the allowed range.'); result[i] = entry; }
  return result;
}
function checkedMemory(value: ArrayLike<number>): Float32Array {
  if (!value || value.length !== GRU_HIDDEN) throw new Error(`Recurrent memory must contain exactly ${GRU_HIDDEN} values.`);
  const memory = new Float32Array(GRU_HIDDEN);
  for (let i = 0; i < GRU_HIDDEN; i++) { if (!Number.isFinite(value[i]) || Math.abs(value[i]) > 1) throw new Error('Invalid recurrent memory.'); memory[i] = value[i]; }
  return memory;
}
function prepare(samples: TrainingSample[]): PreparedSample[] {
  return samples.map(sample => {
    if (!sample || !Number.isInteger(sample.action) || sample.action < 0 || sample.action > 5) throw new Error('Invalid training action.');
    if (sample.episodeId !== undefined && (typeof sample.episodeId !== 'string' || !sample.episodeId.length || sample.episodeId.length > 240)) throw new Error('Invalid training episode.');
    if (sample.sequenceStart !== undefined && typeof sample.sequenceStart !== 'boolean') throw new Error('Invalid sequence boundary.');
    return { input: checkedInput(sample.input), action: sample.action, episodeId: sample.episodeId, sequenceStart: sample.sequenceStart };
  });
}
function episodes(samples: PreparedSample[]): PreparedSample[][] {
  const result: PreparedSample[][] = [];
  for (const sample of samples) {
    const last = result[result.length - 1]; const previous = last?.[last.length - 1];
    if (!sample.episodeId || sample.sequenceStart || !previous || previous.episodeId !== sample.episodeId) result.push([sample]);
    else last.push(sample);
  }
  return result;
}
function abortIfNeeded(signal?: AbortSignal): void { if (signal?.aborted) throw new DOMException('Training cancelled.', 'AbortError'); }
const yieldToUI = () => new Promise<void>(resolve => setTimeout(resolve, 0));
function lossOf(result: ForwardResult, action: Action): number {
  const max = Math.max(...result.logits); let total = 0;
  for (const value of result.logits) total += Math.exp(value - max);
  return max + Math.log(total) - result.logits[action];
}
function actionOf(probabilities: Float32Array): Action {
  let action = 0; for (let i = 1; i < probabilities.length; i++) if (probabilities[i] > probabilities[action]) action = i; return action as Action;
}

/** Genuine fixed GRU96 policy. No path solver, level rules or oracle targets. */
export class TinyNetwork {
  readonly layers: LayerParameters[];
  readonly recurrent: RecurrentParameters;
  readonly seed: number;
  trainedSteps = 0;
  private memory: Float32Array = new Float32Array(GRU_HIDDEN);
  private firstMoments: Float32Array[]; private secondMoments: Float32Array[];
  private optimizerSteps = 0; private training = false;

  constructor(seed = 42) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Invalid initialization seed.');
    this.seed = seed; const random = generator(seed);
    this.layers = [[MODEL_INPUTS, 96], [96, 64], [64, 6]].map(([inputs, outputs]) => {
      const limit = Math.sqrt(6 / (inputs + outputs));
      return { inputs, outputs, weights: Float32Array.from({ length: inputs * outputs }, () => (random() * 2 - 1) * limit), biases: new Float32Array(outputs) };
    });
    this.recurrent = createRecurrent(random);
    this.firstMoments = this.createGradients(); this.secondMoments = this.createGradients();
  }
  get parameterCount(): number { return PARAMETER_COUNT; }
  resetMemory(): void { this.memory.fill(0); }
  getMemory(): Float32Array { return this.memory.slice(); }
  setMemory(memory: ArrayLike<number>): void { this.memory = checkedMemory(memory); }

  private createGradients(): Float32Array[] {
    return [...this.layers.map(layer => new Float32Array(layer.weights.length + layer.biases.length)), ...recurrentTensors(this.recurrent).map(tensor => new Float32Array(tensor.length))];
  }
  private forward(input: Float32Array, memory: Float32Array): ForwardResult {
    const first = this.layers[0]; const hidden = new Float32Array(96);
    for (let j = 0; j < 96; j++) { let sum = first.biases[j]; for (let i = 0; i < first.inputs; i++) sum += first.weights[j * first.inputs + i] * input[i]; hidden[j] = Math.tanh(sum); }
    const recurrent = recurrentForward(this.recurrent, hidden, memory);
    const second = this.layers[1]; const next = new Float32Array(64);
    for (let j = 0; j < 64; j++) { let sum = second.biases[j]; for (let i = 0; i < GRU_HIDDEN; i++) sum += second.weights[j * GRU_HIDDEN + i] * recurrent.memory[i]; next[j] = Math.tanh(sum); }
    const output = this.layers[2]; const logits = new Float32Array(6);
    for (let j = 0; j < 6; j++) { let sum = output.biases[j]; for (let i = 0; i < 64; i++) sum += output.weights[j * 64 + i] * next[i]; logits[j] = sum; }
    const probabilities = logits.slice(); const max = Math.max(...logits); let total = 0;
    for (let i = 0; i < 6; i++) { probabilities[i] = Math.exp(probabilities[i] - max); total += probabilities[i]; }
    for (let i = 0; i < 6; i++) probabilities[i] /= total;
    return { activations: [input, hidden, recurrent.memory, next, probabilities], logits, recurrent };
  }
  private prediction(result: ForwardResult): { action: Action; probabilities: number[]; trace: ActivationTrace } {
    const probabilities = Array.from(result.activations[4]); const action = actionOf(result.activations[4]); const r = result.recurrent;
    return { action, probabilities, trace: {
      layers: result.activations.map(values => Array.from(values)), logits: Array.from(result.logits), probabilities, action,
      recurrent: { previous: Array.from(r.previous), reset: Array.from(r.reset), update: Array.from(r.update), candidate: Array.from(r.candidate), memory: Array.from(r.memory) },
    } };
  }
  /** One action decision, consuming precisely one recurrent step. */
  predict(input: ArrayLike<number>): { action: Action; probabilities: number[]; trace: ActivationTrace } {
    const result = this.forward(checkedInput(input), this.memory); this.memory = result.recurrent.memory; return this.prediction(result);
  }
  /** Rendering/inspection only: does not consume a recurrent step. */
  preview(input: ArrayLike<number>, memory?: ArrayLike<number>): { action: Action; probabilities: number[]; trace: ActivationTrace } {
    return this.prediction(this.forward(checkedInput(input), memory ? checkedMemory(memory) : this.memory));
  }

  /** Gradients: dense(W+b) ×3, then GRU input/hidden/input-bias/hidden-bias. */
  lossAndGradients(sample: TrainingSample): { loss: number; gradients: Float32Array[] } { return this.sequenceLossAndGradients([sample]); }
  sequenceLossAndGradients(samples: TrainingSample[], initialMemory?: ArrayLike<number>): { loss: number; gradients: Float32Array[] } {
    if (!samples.length || samples.length > BPTT_WINDOW) throw new Error(`Gradient sequence must contain 1–${BPTT_WINDOW} steps.`);
    const gradients = this.createGradients(); const data = prepare(samples);
    const result = this.differentiateSequence(data, initialMemory ? checkedMemory(initialMemory) : new Float32Array(GRU_HIDDEN), gradients);
    for (const gradient of gradients) for (let i = 0; i < gradient.length; i++) gradient[i] /= samples.length;
    return { loss: result.loss / samples.length, gradients };
  }
  private differentiateSequence(samples: PreparedSample[], initialMemory: Float32Array, gradients: Float32Array[]): { loss: number; memory: Float32Array } {
    const results: ForwardResult[] = []; let memory = initialMemory; let loss = 0;
    for (const sample of samples) { const result = this.forward(sample.input, memory); results.push(result); memory = result.recurrent.memory; loss += lossOf(result, sample.action); }
    let temporal: Float32Array = new Float32Array(GRU_HIDDEN);
    for (let t = samples.length - 1; t >= 0; t--) {
      const result = results[t]; const [input, first, recurrentMemory, second, probabilities] = result.activations;
      const deltaOutput = probabilities.slice(); deltaOutput[samples[t].action] -= 1;
      const deltaSecond = new Float32Array(64);
      for (let j = 0; j < 6; j++) {
        for (let i = 0; i < 64; i++) { gradients[2][j * 64 + i] += deltaOutput[j] * second[i]; deltaSecond[i] += this.layers[2].weights[j * 64 + i] * deltaOutput[j]; }
        gradients[2][this.layers[2].weights.length + j] += deltaOutput[j];
      }
      const deltaMemory = temporal;
      for (let j = 0; j < 64; j++) {
        const delta = deltaSecond[j] * (1 - second[j] * second[j]); gradients[1][this.layers[1].weights.length + j] += delta;
        for (let i = 0; i < GRU_HIDDEN; i++) { gradients[1][j * GRU_HIDDEN + i] += delta * recurrentMemory[i]; deltaMemory[i] += this.layers[1].weights[j * GRU_HIDDEN + i] * delta; }
      }
      const recurrentDelta = recurrentBackward(this.recurrent, result.recurrent, deltaMemory, gradients.slice(3)); temporal = recurrentDelta.previous;
      for (let j = 0; j < 96; j++) {
        const delta = recurrentDelta.input[j] * (1 - first[j] * first[j]); gradients[0][this.layers[0].weights.length + j] += delta;
        for (let i = 0; i < MODEL_INPUTS; i++) gradients[0][j * MODEL_INPUTS + i] += delta * input[i];
      }
    }
    return { loss, memory };
  }
  evaluate(samples: TrainingSample[]): { loss: number; accuracy: number } {
    if (!samples.length) return { loss: 0, accuracy: 0 };
    const grouped = episodes(prepare(samples)); let loss = 0; let correct = 0;
    for (const episode of grouped) {
      let memory: Float32Array = new Float32Array(GRU_HIDDEN);
      for (const sample of episode) { const result = this.forward(sample.input, memory); memory = result.recurrent.memory; loss += lossOf(result, sample.action); if (actionOf(result.activations[4]) === sample.action) correct++; }
    }
    return { loss: loss / samples.length, accuracy: correct / samples.length };
  }
  private applyGradients(gradients: Float32Array[], count: number): void {
    this.optimizerSteps++; const beta1Correction = 1 - Math.pow(0.9, this.optimizerSteps); const beta2Correction = 1 - Math.pow(0.999, this.optimizerSteps);
    const recurrent = recurrentTensors(this.recurrent);
    let norm = 0; for (const gradient of gradients) for (const value of gradient) norm += (value / count) ** 2;
    const scale = Math.min(1, 5 / Math.max(1e-12, Math.sqrt(norm)));
    for (let group = 0; group < gradients.length; group++) {
      const layer = this.layers[group];
      for (let i = 0; i < gradients[group].length; i++) {
        const tensor = group < 3 ? (i < layer.weights.length ? layer.weights : layer.biases) : recurrent[group - 3];
        const offset = group < 3 && i >= layer.weights.length ? i - layer.weights.length : i;
        const gradient = gradients[group][i] / count * scale;
        const first = this.firstMoments[group][i] = 0.9 * this.firstMoments[group][i] + 0.1 * gradient;
        const second = this.secondMoments[group][i] = 0.999 * this.secondMoments[group][i] + 0.001 * gradient * gradient;
        const update = 0.004 * (first / beta1Correction) / (Math.sqrt(second / beta2Correction) + 1e-8);
        tensor[offset] = Math.max(-MAX_WEIGHT, Math.min(MAX_WEIGHT, tensor[offset] - update));
      }
    }
  }
  async train(samples: TrainingSample[], epochs: number, batchSize: number, onProgress?: (progress: TrainingProgress) => void, signal?: AbortSignal, cooperativeYield = true): Promise<TrainingMetrics> {
    if (this.training) throw new Error('This model is already training.');
    if (!Array.isArray(samples) || !samples.length || samples.length > 100000) throw new Error('Training needs 1–100000 examples.');
    if (!Number.isInteger(epochs) || epochs < 1 || epochs > 2000) throw new Error('Invalid epoch count.');
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1024) throw new Error('Invalid batch size.');
    const dataset = prepare(samples); const grouped = episodes(dataset); abortIfNeeded(signal); this.training = true;
    const started = performance.now(); let lastYield = started; let metric = { loss: 0, accuracy: 0 };
    const random = generator((this.seed + this.trainedSteps + 17) >>> 0); const order = grouped.map((_, index) => index);
    const gradients = this.createGradients(); let pending = 0;
    const maybeYield = async () => { if (cooperativeYield && performance.now() - lastYield >= 8) { await yieldToUI(); abortIfNeeded(signal); lastYield = performance.now(); } };
    const flush = () => { if (pending) { this.applyGradients(gradients, pending); this.trainedSteps += pending; pending = 0; for (const gradient of gradients) gradient.fill(0); } };
    try {
      for (let epoch = 1; epoch <= epochs; epoch++) {
        abortIfNeeded(signal);
        for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
        for (const index of order) {
          let memory: Float32Array = new Float32Array(GRU_HIDDEN); const episode = grouped[index];
          for (let start = 0; start < episode.length; start += BPTT_WINDOW) {
            const window = episode.slice(start, start + BPTT_WINDOW);
            memory = this.differentiateSequence(window, memory, gradients).memory; pending += window.length;
            if (pending >= batchSize) flush();
            await maybeYield(); abortIfNeeded(signal);
          }
        }
        flush();
        let loss = 0; let correct = 0;
        for (const episode of grouped) {
          let memory: Float32Array = new Float32Array(GRU_HIDDEN);
          for (const sample of episode) { const result = this.forward(sample.input, memory); memory = result.recurrent.memory; loss += lossOf(result, sample.action); if (actionOf(result.activations[4]) === sample.action) correct++; await maybeYield(); }
        }
        metric = { loss: loss / dataset.length, accuracy: correct / dataset.length };
        onProgress?.({ epoch, totalEpochs: epochs, ...metric, examplesSeen: this.trainedSteps });
        if (cooperativeYield) { await yieldToUI(); lastYield = performance.now(); }
        abortIfNeeded(signal);
      }
      return { ...metric, epochs, samples: dataset.length, durationMs: performance.now() - started };
    } finally { this.training = false; }
  }
  snapshot(): NetworkSnapshot {
    const r = this.recurrent;
    return { version: MODEL_VERSION, architecture: [...ARCHITECTURE], weights: this.layers.map(layer => Array.from(layer.weights)), biases: this.layers.map(layer => Array.from(layer.biases)),
      recurrent: { weightsInput: Array.from(r.weightsInput), weightsHidden: Array.from(r.weightsHidden), biasInput: Array.from(r.biasInput), biasHidden: Array.from(r.biasHidden) }, trainedSteps: this.trainedSteps, seed: this.seed };
  }
  serialize(): string { return JSON.stringify(this.snapshot()); }
  static deserialize(value: string | unknown): TinyNetwork {
    if (typeof value === 'string') { if (value.length > MAX_MODEL_BYTES || new TextEncoder().encode(value).byteLength > MAX_MODEL_BYTES) throw new Error('Model file exceeds 2 MB.'); try { value = JSON.parse(value); } catch { throw new Error('Model file is not valid JSON.'); } }
    return TinyNetwork.fromSnapshot(value);
  }
  static fromSnapshot(value: unknown): TinyNetwork {
    if (!isRecord(value)) throw new Error('Invalid model document.');
    const allowed = new Set(['version', 'architecture', 'weights', 'biases', 'recurrent', 'trainedSteps', 'seed']);
    if (Object.keys(value).some(key => !allowed.has(key))) throw new Error('Unexpected model document field.');
    if (value.version !== MODEL_VERSION) throw new Error('Unsupported model version. This release needs a new GRU model.');
    if (!Array.isArray(value.architecture) || value.architecture.length !== ARCHITECTURE.length || value.architecture.some((entry, index) => entry !== ARCHITECTURE[index])) throw new Error(`Model architecture must be ${ARCHITECTURE.join('→')}.`);
    if (!Array.isArray(value.weights) || value.weights.length !== 3 || !Array.isArray(value.biases) || value.biases.length !== 3) throw new Error('Invalid number of model layers.');
    if (typeof value.trainedSteps !== 'number' || !Number.isSafeInteger(value.trainedSteps) || value.trainedSteps < 0) throw new Error('Invalid model training counter.');
    if (typeof value.seed !== 'number' || !Number.isInteger(value.seed) || value.seed < 0 || value.seed > 0xffffffff) throw new Error('Invalid model seed.');
    const network = new TinyNetwork(value.seed);
    for (let l = 0; l < 3; l++) { const layer = network.layers[l]; layer.weights.set(checkedArray(value.weights[l], layer.weights.length)); layer.biases.set(checkedArray(value.biases[l], layer.biases.length)); }
    if (!isRecord(value.recurrent)) throw new Error('Missing recurrent model tensors.');
    const fields = ['weightsInput', 'weightsHidden', 'biasInput', 'biasHidden'] as const;
    if (Object.keys(value.recurrent).length !== fields.length || Object.keys(value.recurrent).some(key => !fields.includes(key as typeof fields[number]))) throw new Error('Unexpected recurrent tensor field.');
    for (const field of fields) network.recurrent[field].set(checkedArray(value.recurrent[field], network.recurrent[field].length));
    network.trainedSteps = value.trainedSteps; return network;
  }
}
