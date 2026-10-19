import type { ActivationTrace, LayerParameters } from '../ml/network';

export type GateView = 'memory' | 'reset' | 'update' | 'candidate';
export type BrainSelection = { layer: number; index: number };
export interface RecurrentParameters {
  inputs: number; hidden: number;
  weightsInput: Float32Array; weightsHidden: Float32Array;
  biasInput: Float32Array; biasHidden: Float32Array;
}
export interface BrainParameters { layers: LayerParameters[]; recurrent: RecurrentParameters }
export interface BrainConnection {
  sourceLayer: number; sourceIndex: number; targetLayer: number; targetIndex: number;
  kind: 'dense' | 'input' | 'memory'; weight: number; source: number; contribution: number;
}
export const BRAIN_LAYER_NAMES = ['Girdi', 'Algılama', 'GRU belleği', 'Karar', 'Eylem'];

export function gateIndex(view: GateView): number { return view === 'reset' ? 0 : view === 'update' ? 1 : 2; }

export function neuronValue(trace: ActivationTrace | undefined, layer: number, index: number, view: GateView): number {
  if (layer === 2 && view !== 'memory') return trace?.recurrent?.[view]?.[index] ?? 0;
  return trace?.layers[layer]?.[index] ?? 0;
}

/** Actual incoming affine terms. GRU candidate recurrence includes its reset gate. */
export function incomingConnections(parameters: BrainParameters, trace: ActivationTrace | undefined,
  selection: BrainSelection, view: GateView): BrainConnection[] {
  const { layer, index } = selection;
  if (layer === 0) return [];
  const result: BrainConnection[] = [];
  if (layer !== 2) {
    const dense = parameters.layers[layer === 1 ? 0 : layer - 2];
    const sourceLayer = layer - 1;
    for (let i = 0; i < dense.inputs; i++) {
      const weight = dense.weights[index * dense.inputs + i];
      const source = trace?.layers[sourceLayer]?.[i] ?? 0;
      result.push({ sourceLayer, sourceIndex: i, targetLayer: layer, targetIndex: index,
        kind: 'dense', weight, source, contribution: weight * source });
    }
    return result;
  }
  const recurrent = parameters.recurrent; const gate = gateIndex(view);
  const row = gate * recurrent.hidden + index;
  for (let i = 0; i < recurrent.inputs; i++) {
    const weight = recurrent.weightsInput[row * recurrent.inputs + i];
    const source = trace?.layers[1]?.[i] ?? 0;
    result.push({ sourceLayer: 1, sourceIndex: i, targetLayer: 2, targetIndex: index,
      kind: 'input', weight, source, contribution: weight * source });
  }
  for (let i = 0; i < recurrent.hidden; i++) {
    const weight = recurrent.weightsHidden[row * recurrent.hidden + i];
    const source = trace?.recurrent?.previous[i] ?? 0;
    const reset = gate === 2 ? trace?.recurrent?.reset[index] ?? 0 : 1;
    result.push({ sourceLayer: 2, sourceIndex: i, targetLayer: 2, targetIndex: index,
      kind: 'memory', weight, source, contribution: weight * source * reset });
  }
  return result;
}

export function neuronBias(parameters: BrainParameters, trace: ActivationTrace | undefined,
  selection: BrainSelection, view: GateView): { input: number; hidden?: number; effective: number } | undefined {
  if (selection.layer === 0) return undefined;
  if (selection.layer !== 2) {
    const value = parameters.layers[selection.layer === 1 ? 0 : selection.layer - 2].biases[selection.index];
    return { input: value, effective: value };
  }
  const gate = gateIndex(view); const row = gate * parameters.recurrent.hidden + selection.index;
  const input = parameters.recurrent.biasInput[row]; const hidden = parameters.recurrent.biasHidden[row];
  const reset = gate === 2 ? trace?.recurrent?.reset[selection.index] ?? 0 : 1;
  return { input, hidden, effective: input + hidden * reset };
}

/** Freeze weights together with the trace, so later training cannot change an inspection. */
export function freezeBrainParameters(parameters: BrainParameters): BrainParameters {
  return { layers: parameters.layers.map(layer => ({ ...layer, weights: layer.weights.slice(), biases: layer.biases.slice() })),
    recurrent: { ...parameters.recurrent,
      weightsInput: parameters.recurrent.weightsInput.slice(), weightsHidden: parameters.recurrent.weightsHidden.slice(),
      biasInput: parameters.recurrent.biasInput.slice(), biasHidden: parameters.recurrent.biasHidden.slice() } };
}

export function freezeBrainTrace(trace: ActivationTrace | undefined): ActivationTrace | undefined {
  if (!trace) return undefined;
  return { ...trace, layers: trace.layers.map(layer => [...layer]), logits: [...trace.logits], probabilities: [...trace.probabilities],
    recurrent: trace.recurrent ? {
      previous: [...trace.recurrent.previous], reset: [...trace.recurrent.reset], update: [...trace.recurrent.update],
      candidate: [...trace.recurrent.candidate], memory: [...trace.recurrent.memory],
    } : undefined };
}
