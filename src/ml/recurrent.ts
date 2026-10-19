/** PyTorch GRU gate order: reset, update, candidate; two separate bias vectors. */
export const GRU_INPUTS = 96;
export const GRU_HIDDEN = 96;
export const GRU_PARAMETER_COUNT = 3 * GRU_HIDDEN * (GRU_INPUTS + GRU_HIDDEN + 2);

export interface RecurrentParameters {
  inputs: number; hidden: number;
  weightsInput: Float32Array; weightsHidden: Float32Array;
  biasInput: Float32Array; biasHidden: Float32Array;
}
export interface RecurrentSnapshot {
  weightsInput: number[]; weightsHidden: number[]; biasInput: number[]; biasHidden: number[];
}
export interface RecurrentTrace {
  previous: number[]; reset: number[]; update: number[]; candidate: number[]; memory: number[];
}
export interface RecurrentCache {
  input: Float32Array; previous: Float32Array; reset: Float32Array; update: Float32Array;
  candidate: Float32Array; hiddenCandidate: Float32Array; memory: Float32Array;
}

export function createRecurrent(random: () => number): RecurrentParameters {
  const limit = Math.sqrt(1 / GRU_HIDDEN);
  return {
    inputs: GRU_INPUTS, hidden: GRU_HIDDEN,
    weightsInput: Float32Array.from({ length: 3 * GRU_HIDDEN * GRU_INPUTS }, () => (random() * 2 - 1) * limit),
    weightsHidden: Float32Array.from({ length: 3 * GRU_HIDDEN * GRU_HIDDEN }, () => (random() * 2 - 1) * limit),
    biasInput: new Float32Array(3 * GRU_HIDDEN), biasHidden: new Float32Array(3 * GRU_HIDDEN),
  };
}
export function recurrentTensors(parameters: RecurrentParameters): Float32Array[] {
  return [parameters.weightsInput, parameters.weightsHidden, parameters.biasInput, parameters.biasHidden];
}
const sigmoid = (value: number): number => value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));

export function recurrentForward(parameters: RecurrentParameters, input: Float32Array, previous: Float32Array): RecurrentCache {
  const { inputs, hidden, weightsInput, weightsHidden, biasInput, biasHidden } = parameters;
  const reset = new Float32Array(hidden); const update = new Float32Array(hidden);
  const candidate = new Float32Array(hidden); const hiddenCandidate = new Float32Array(hidden);
  const memory = new Float32Array(hidden);
  for (let j = 0; j < hidden; j++) {
    let ir = biasInput[j]; let iz = biasInput[hidden + j]; let inn = biasInput[2 * hidden + j];
    let hr = biasHidden[j]; let hz = biasHidden[hidden + j]; let hn = biasHidden[2 * hidden + j];
    const irOffset = j * inputs; const izOffset = (hidden + j) * inputs; const inOffset = (2 * hidden + j) * inputs;
    const hrOffset = j * hidden; const hzOffset = (hidden + j) * hidden; const hnOffset = (2 * hidden + j) * hidden;
    for (let i = 0; i < inputs; i++) {
      ir += weightsInput[irOffset + i] * input[i]; iz += weightsInput[izOffset + i] * input[i]; inn += weightsInput[inOffset + i] * input[i];
    }
    for (let i = 0; i < hidden; i++) {
      hr += weightsHidden[hrOffset + i] * previous[i]; hz += weightsHidden[hzOffset + i] * previous[i]; hn += weightsHidden[hnOffset + i] * previous[i];
    }
    reset[j] = sigmoid(ir + hr); update[j] = sigmoid(iz + hz); hiddenCandidate[j] = hn;
    candidate[j] = Math.tanh(inn + reset[j] * hiddenCandidate[j]);
    memory[j] = (1 - update[j]) * candidate[j] + update[j] * previous[j];
  }
  return { input, previous, reset, update, candidate, hiddenCandidate, memory };
}

/** Accumulates exact gate gradients; temporal derivative is passed to the previous step. */
export function recurrentBackward(parameters: RecurrentParameters, cache: RecurrentCache, delta: Float32Array, gradients: Float32Array[]): { input: Float32Array; previous: Float32Array } {
  const { inputs, hidden, weightsInput, weightsHidden } = parameters;
  const [gradInput, gradHidden, gradBiasInput, gradBiasHidden] = gradients;
  const input = new Float32Array(inputs); const previous = new Float32Array(hidden);
  for (let j = 0; j < hidden; j++) {
    const dc = delta[j] * (1 - cache.update[j]) * (1 - cache.candidate[j] * cache.candidate[j]);
    const dr = dc * cache.hiddenCandidate[j] * cache.reset[j] * (1 - cache.reset[j]);
    const dz = delta[j] * (cache.previous[j] - cache.candidate[j]) * cache.update[j] * (1 - cache.update[j]);
    const dHiddenCandidate = dc * cache.reset[j];
    previous[j] += delta[j] * cache.update[j];
    const rInput = j * inputs; const zInput = (hidden + j) * inputs; const nInput = (2 * hidden + j) * inputs;
    const rHidden = j * hidden; const zHidden = (hidden + j) * hidden; const nHidden = (2 * hidden + j) * hidden;
    gradBiasInput[j] += dr; gradBiasInput[hidden + j] += dz; gradBiasInput[2 * hidden + j] += dc;
    gradBiasHidden[j] += dr; gradBiasHidden[hidden + j] += dz; gradBiasHidden[2 * hidden + j] += dHiddenCandidate;
    for (let i = 0; i < inputs; i++) {
      gradInput[rInput + i] += dr * cache.input[i]; gradInput[zInput + i] += dz * cache.input[i]; gradInput[nInput + i] += dc * cache.input[i];
      input[i] += weightsInput[rInput + i] * dr + weightsInput[zInput + i] * dz + weightsInput[nInput + i] * dc;
    }
    for (let i = 0; i < hidden; i++) {
      gradHidden[rHidden + i] += dr * cache.previous[i]; gradHidden[zHidden + i] += dz * cache.previous[i]; gradHidden[nHidden + i] += dHiddenCandidate * cache.previous[i];
      previous[i] += weightsHidden[rHidden + i] * dr + weightsHidden[zHidden + i] * dz + weightsHidden[nHidden + i] * dHiddenCandidate;
    }
  }
  return { input, previous };
}
