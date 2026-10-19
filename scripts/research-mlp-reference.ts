/** Frozen MLP used by the historical controlled experiments; never imported by the game. */
import { MODEL_INPUTS, type Action } from '../src/core/types';
const MODEL_VERSION = 'noema-160-64-64-6-v2';

export const ARCHITECTURE = [MODEL_INPUTS, 64, 64, 6] as const;
export const LEGACY_ARCHITECTURE = [128, 64, 64, 6] as const;
export const LEGACY_MODEL_VERSION = 'noema-128-64-64-6-v1';
export const PARAMETER_COUNT = MODEL_INPUTS * 64 + 64 + 64 * 64 + 64 + 64 * 6 + 6;
export const MAX_MODEL_BYTES = 2 * 1024 * 1024;
const MAX_WEIGHT = 32;

export interface TrainingSample { input: number[]; action: Action }
export interface ActivationTrace {
  layers: number[][];
  logits: number[];
  action: Action;
  probabilities: number[];
}
export interface TrainingProgress {
  epoch: number; totalEpochs: number; loss: number; accuracy: number; examplesSeen: number;
}
export interface TrainingMetrics {
  loss: number; accuracy: number; epochs: number; samples: number; durationMs: number;
}
export interface LayerParameters {
  inputs: number; outputs: number;
  /** Row-major: weights[output * inputs + input]. */
  weights: Float32Array; biases: Float32Array;
}
export interface NetworkSnapshot {
  version: string;
  architecture: number[];
  weights: number[][];
  biases: number[][];
  trainedSteps: number;
  seed: number;
}

function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function checkedInput(input: ArrayLike<number>): Float32Array {
  if (input.length !== ARCHITECTURE[0]) throw new Error(`Model input must contain exactly ${MODEL_INPUTS} values.`);
  const result = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    if (!Number.isFinite(input[i]) || Math.abs(input[i]) > 1e6) throw new Error('Model input contains an invalid number.');
    result[i] = input[i];
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function checkedArray(value: unknown, count: number): Float32Array {
  if (!Array.isArray(value) || value.length !== count) throw new Error('Invalid model tensor shape.');
  const result = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const entry: unknown = value[i];
    if (typeof entry !== 'number' || !Number.isFinite(entry) || Math.abs(entry) > MAX_WEIGHT) {
      throw new Error('Model weights must be finite numbers within the allowed range.');
    }
    result[i] = entry;
  }
  return result;
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Training cancelled.', 'AbortError');
}

const yieldToUI = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A fixed, genuine neural policy. No level rules or solution paths are encoded here. */
export class TinyNetwork {
  readonly layers: LayerParameters[];
  readonly seed: number;
  trainedSteps = 0;
  private firstMoments: Float32Array[];
  private secondMoments: Float32Array[];
  private optimizerSteps = 0;
  private training = false;

  constructor(seed = 42) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Invalid initialization seed.');
    this.seed = seed;
    const random = generator(seed);
    this.layers = ARCHITECTURE.slice(1).map((outputs, index) => {
      const inputs = ARCHITECTURE[index];
      const limit = Math.sqrt(6 / (inputs + outputs));
      const weights = Float32Array.from({ length: inputs * outputs }, () => (random() * 2 - 1) * limit);
      return { inputs, outputs, weights, biases: new Float32Array(outputs) };
    });
    this.firstMoments = this.layers.map((layer) => new Float32Array(layer.weights.length + layer.biases.length));
    this.secondMoments = this.layers.map((layer) => new Float32Array(layer.weights.length + layer.biases.length));
  }

  get parameterCount(): number { return PARAMETER_COUNT; }

  private forward(input: Float32Array): { activations: Float32Array[]; logits: Float32Array } {
    const activations = [input];
    let logits = new Float32Array(6);
    for (let l = 0; l < this.layers.length; l++) {
      const layer = this.layers[l];
      const previous = activations[l];
      const next = new Float32Array(layer.outputs);
      for (let j = 0; j < layer.outputs; j++) {
        let sum = layer.biases[j];
        const offset = j * layer.inputs;
        for (let i = 0; i < layer.inputs; i++) sum += layer.weights[offset + i] * previous[i];
        next[j] = l === this.layers.length - 1 ? sum : Math.tanh(sum);
      }
      if (l === this.layers.length - 1) {
        logits = next.slice();
        let max = -Infinity;
        for (const value of next) max = Math.max(max, value);
        let total = 0;
        for (let i = 0; i < next.length; i++) { next[i] = Math.exp(next[i] - max); total += next[i]; }
        for (let i = 0; i < next.length; i++) next[i] /= total;
      }
      activations.push(next);
    }
    return { activations, logits };
  }

  predict(input: ArrayLike<number>): { action: Action; probabilities: number[]; trace: ActivationTrace } {
    const { activations, logits } = this.forward(checkedInput(input));
    const probabilities = Array.from(activations[3]);
    let action = 0;
    for (let i = 1; i < probabilities.length; i++) if (probabilities[i] > probabilities[action]) action = i;
    const trace: ActivationTrace = {
      layers: activations.map((values) => Array.from(values)),
      logits: Array.from(logits), probabilities, action: action as Action,
    };
    return { action: action as Action, probabilities, trace };
  }

  /** Cross-entropy and its true backpropagated gradient, also useful for numerical checks. */
  lossAndGradients(sample: TrainingSample): { loss: number; gradients: Float32Array[] } {
    if (!Number.isInteger(sample.action) || sample.action < 0 || sample.action > 5) throw new Error('Invalid target action.');
    return this.differentiate(checkedInput(sample.input), sample.action);
  }

  private differentiate(input: Float32Array, action: Action, reuse?: Float32Array[]): { loss: number; gradients: Float32Array[] } {
    const { activations, logits } = this.forward(input);
    const max = Math.max(...logits);
    let exponentialSum = 0;
    for (const value of logits) exponentialSum += Math.exp(value - max);
    const loss = max + Math.log(exponentialSum) - logits[action];
    const gradients = reuse ?? this.layers.map((layer) => new Float32Array(layer.weights.length + layer.biases.length));
    let delta = activations[3].slice();
    delta[action] -= 1;
    for (let l = this.layers.length - 1; l >= 0; l--) {
      const layer = this.layers[l];
      const previous = activations[l];
      const gradient = gradients[l];
      for (let j = 0; j < layer.outputs; j++) {
        const offset = j * layer.inputs;
        for (let i = 0; i < layer.inputs; i++) gradient[offset + i] = delta[j] * previous[i];
        gradient[layer.weights.length + j] = delta[j];
      }
      if (l > 0) {
        const nextDelta = new Float32Array(layer.inputs);
        for (let i = 0; i < layer.inputs; i++) {
          let sum = 0;
          for (let j = 0; j < layer.outputs; j++) sum += layer.weights[j * layer.inputs + i] * delta[j];
          nextDelta[i] = sum * (1 - previous[i] * previous[i]);
        }
        delta = nextDelta;
      }
    }
    return { loss, gradients };
  }

  evaluate(samples: TrainingSample[]): { loss: number; accuracy: number } {
    if (samples.length === 0) return { loss: 0, accuracy: 0 };
    let loss = 0; let correct = 0;
    for (const sample of samples) {
      if (!Number.isInteger(sample.action) || sample.action < 0 || sample.action > 5) throw new Error('Invalid target action.');
      const { logits, activations } = this.forward(checkedInput(sample.input));
      const max = Math.max(...logits);
      let total = 0;
      for (const value of logits) total += Math.exp(value - max);
      loss += max + Math.log(total) - logits[sample.action];
      let action = 0;
      for (let i = 1; i < 6; i++) if (activations[3][i] > activations[3][action]) action = i;
      if (action === sample.action) correct++;
    }
    return { loss: loss / samples.length, accuracy: correct / samples.length };
  }

  async train(
    samples: TrainingSample[], epochs: number, batchSize: number,
    onProgress?: (progress: TrainingProgress) => void, signal?: AbortSignal,
    cooperativeYield = true,
  ): Promise<TrainingMetrics> {
    if (this.training) throw new Error('This model is already training.');
    if (!Array.isArray(samples) || samples.length === 0 || samples.length > 100000) throw new Error('Training needs 1–100000 examples.');
    if (!Number.isInteger(epochs) || epochs < 1 || epochs > 2000) throw new Error('Invalid epoch count.');
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1024) throw new Error('Invalid batch size.');
    // Validate the complete dataset before making any update. Keep a private copy.
    const dataset = samples.map((sample) => {
      if (!sample || !Number.isInteger(sample.action) || sample.action < 0 || sample.action > 5) throw new Error('Invalid training action.');
      return { input: checkedInput(sample.input), action: sample.action };
    });
    abortIfNeeded(signal);
    this.training = true;
    const started = performance.now();
    let lastYield = started;
    let metric = { loss: 0, accuracy: 0 };
    const random = generator((this.seed + this.trainedSteps + 17) >>> 0);
    const order = Array.from({ length: dataset.length }, (_, index) => index);
    const gradients = this.layers.map((layer) => new Float32Array(layer.weights.length + layer.biases.length));
    // Reuse the per-example gradient matrices: augmented datasets must not allocate
    // tens of kilobytes of temporary tensors for every individual example on phones.
    const sampleGradients = this.layers.map((layer) => new Float32Array(layer.weights.length + layer.biases.length));
    try {
      for (let epoch = 1; epoch <= epochs; epoch++) {
        abortIfNeeded(signal);
        for (let i = order.length - 1; i > 0; i--) {
          const j = Math.floor(random() * (i + 1));
          [order[i], order[j]] = [order[j], order[i]];
        }
        for (let start = 0; start < order.length; start += batchSize) {
          for (const gradient of gradients) gradient.fill(0);
          const end = Math.min(start + batchSize, order.length);
          for (let n = start; n < end; n++) {
            const sample = dataset[order[n]];
            const result = this.differentiate(sample.input, sample.action, sampleGradients);
            for (let l = 0; l < gradients.length; l++) {
              for (let i = 0; i < gradients[l].length; i++) gradients[l][i] += result.gradients[l][i];
            }
            if (cooperativeYield && performance.now() - lastYield >= 8) {
              await yieldToUI(); abortIfNeeded(signal); lastYield = performance.now();
            }
          }
          const count = end - start;
          this.optimizerSteps++;
          const beta1Correction = 1 - Math.pow(0.9, this.optimizerSteps);
          const beta2Correction = 1 - Math.pow(0.999, this.optimizerSteps);
          for (let l = 0; l < this.layers.length; l++) {
            const layer = this.layers[l];
            for (let i = 0; i < gradients[l].length; i++) {
              const isWeight = i < layer.weights.length;
              const offset = isWeight ? i : i - layer.weights.length;
              const tensor = isWeight ? layer.weights : layer.biases;
              const gradient = Math.max(-5, Math.min(5, gradients[l][i] / count));
              const first = this.firstMoments[l][i] = 0.9 * this.firstMoments[l][i] + 0.1 * gradient;
              const second = this.secondMoments[l][i] = 0.999 * this.secondMoments[l][i] + 0.001 * gradient * gradient;
              const update = 0.004 * (first / beta1Correction) / (Math.sqrt(second / beta2Correction) + 1e-8);
              tensor[offset] = Math.max(-MAX_WEIGHT, Math.min(MAX_WEIGHT, tensor[offset] - update));
            }
          }
          this.trainedSteps += count;
          if (cooperativeYield && performance.now() - lastYield >= 8) {
            await yieldToUI(); abortIfNeeded(signal); lastYield = performance.now();
          }
        }
        // Full metrics are post-update values. Evaluation also yields on the direct path.
        let epochLoss = 0; let epochCorrect = 0;
        for (const sample of dataset) {
          const { activations, logits } = this.forward(sample.input);
          const max = Math.max(...logits);
          let total = 0; let action = 0;
          for (let i = 0; i < logits.length; i++) {
            total += Math.exp(logits[i] - max);
            if (activations[3][i] > activations[3][action]) action = i;
          }
          epochLoss += max + Math.log(total) - logits[sample.action];
          if (action === sample.action) epochCorrect++;
          if (cooperativeYield && performance.now() - lastYield >= 8) {
            await yieldToUI(); abortIfNeeded(signal); lastYield = performance.now();
          }
        }
        metric = { loss: epochLoss / dataset.length, accuracy: epochCorrect / dataset.length };
        onProgress?.({ epoch, totalEpochs: epochs, ...metric, examplesSeen: this.trainedSteps });
        // Dedicated workers are cancelled by termination and need no timer yields.
        // Main-thread/fallback callers keep cooperative scheduling by default.
        if (cooperativeYield) { await yieldToUI(); lastYield = performance.now(); }
        abortIfNeeded(signal);
      }
      return { ...metric, epochs, samples: dataset.length, durationMs: performance.now() - started };
    } finally {
      this.training = false;
    }
  }

  /** Portable inference weights. Loading a snapshot starts a fresh optimizer. */
  snapshot(): NetworkSnapshot {
    return {
      version: MODEL_VERSION, architecture: [...ARCHITECTURE],
      weights: this.layers.map((layer) => Array.from(layer.weights)),
      biases: this.layers.map((layer) => Array.from(layer.biases)),
      trainedSteps: this.trainedSteps, seed: this.seed,
    };
  }

  serialize(): string { return JSON.stringify(this.snapshot()); }

  static deserialize(value: string | unknown): TinyNetwork {
    if (typeof value === 'string') {
      if (value.length > MAX_MODEL_BYTES || new TextEncoder().encode(value).byteLength > MAX_MODEL_BYTES) throw new Error('Model file exceeds 2 MB.');
      try { value = JSON.parse(value); } catch { throw new Error('Model file is not valid JSON.'); }
    }
    return TinyNetwork.fromSnapshot(value);
  }

  static fromSnapshot(value: unknown): TinyNetwork {
    if (!isRecord(value)) throw new Error('Invalid model document.');
    const allowed = new Set(['version', 'architecture', 'weights', 'biases', 'trainedSteps', 'seed']);
    if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error('Unexpected model document field.');
    const legacy = value.version === LEGACY_MODEL_VERSION;
    if (value.version !== MODEL_VERSION && !legacy) throw new Error('Unsupported model version.');
    const expectedArchitecture = legacy ? LEGACY_ARCHITECTURE : ARCHITECTURE;
    if (!Array.isArray(value.architecture) || value.architecture.length !== 4
      || value.architecture.some((entry, index) => entry !== expectedArchitecture[index])) throw new Error(`Model architecture must be ${expectedArchitecture.join('→')}.`);
    if (!Array.isArray(value.weights) || value.weights.length !== 3 || !Array.isArray(value.biases) || value.biases.length !== 3) throw new Error('Invalid number of model layers.');
    if (typeof value.trainedSteps !== 'number' || !Number.isSafeInteger(value.trainedSteps) || value.trainedSteps < 0) throw new Error('Invalid model training counter.');
    if (typeof value.seed !== 'number' || !Number.isInteger(value.seed) || value.seed < 0 || value.seed > 0xffffffff) throw new Error('Invalid model seed.');
    const network = new TinyNetwork(value.seed);
    for (let l = 0; l < network.layers.length; l++) {
      const layer = network.layers[l];
      if (legacy && l === 0) {
        const oldWeights = checkedArray(value.weights[l], 128 * 64);
        layer.weights.fill(0);
        for (let neuron = 0; neuron < 64; neuron++) {
          layer.weights.set(oldWeights.subarray(neuron * 128, (neuron + 1) * 128), neuron * MODEL_INPUTS);
        }
      } else {
        layer.weights.set(checkedArray(value.weights[l], layer.weights.length));
      }
      layer.biases.set(checkedArray(value.biases[l], layer.biases.length));
    }
    network.trainedSteps = value.trainedSteps;
    return network;
  }
}
