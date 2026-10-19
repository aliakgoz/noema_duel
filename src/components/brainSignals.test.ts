import { describe, expect, it } from 'vitest';
import { TinyNetwork } from '../ml/network';
import { freezeBrainParameters, freezeBrainTrace, incomingConnections, neuronBias, neuronValue, type GateView } from './brainSignals';

describe('actual GRU brain visualization signals', () => {
  it('reconstructs runtime gate activations from the displayed weights, old memory and biases', () => {
    const network = new TinyNetwork(29);
    network.setMemory(Array.from({ length: 96 }, (_, index) => Math.sin(index * .31) * .6));
    const trace = network.preview(Array.from({ length: 160 }, (_, index) => Math.cos(index * .19) * .7)).trace;
    for (const view of ['reset', 'update', 'candidate', 'memory'] as GateView[]) {
      for (const index of [0, 31, 95]) {
        const selected = { layer: 2, index };
        const connections = incomingConnections(network, trace, selected, view);
        expect(connections.filter(edge => edge.kind === 'input')).toHaveLength(96);
        expect(connections.filter(edge => edge.kind === 'memory')).toHaveLength(96);
        const affine = connections.reduce((sum, edge) => sum + edge.contribution, neuronBias(network, trace, selected, view)!.effective);
        const activation = view === 'reset' || view === 'update' ? 1 / (1 + Math.exp(-affine)) : Math.tanh(affine);
        expect(activation).toBeCloseTo(trace.recurrent![view === 'memory' ? 'candidate' : view][index], 6);
        expect(neuronValue(trace, 2, index, view)).toBe(trace.recurrent![view][index]);
      }
    }
    for (let index = 0; index < 96; index++) {
      const gate = trace.recurrent!;
      expect(gate.update[index] * gate.previous[index] + (1 - gate.update[index]) * gate.candidate[index]).toBeCloseTo(trace.layers[2][index], 6);
    }
  });

  it('uses the correct dense source layers before and after recurrent memory', () => {
    const network = new TinyNetwork(12);
    const trace = network.predict(Array.from({ length: 160 }, (_, index) => Math.sin(index) * .5)).trace;
    for (const layer of [1, 3, 4]) for (const index of [0, 3]) {
      const selected = { layer, index };
      const connections = incomingConnections(network, trace, selected, 'memory');
      const affine = connections.reduce((sum, edge) => sum + edge.contribution, neuronBias(network, trace, selected, 'memory')!.effective);
      expect(connections.every(edge => edge.sourceLayer === layer - 1)).toBe(true);
      expect(layer === 4 ? affine : Math.tanh(affine)).toBeCloseTo(layer === 4 ? trace.logits[index] : trace.layers[layer][index], 6);
    }
  });

  it('freezes all gate tensors, biases, old/new memory and output arrays independently', () => {
    const network = new TinyNetwork(44);
    network.setMemory(Array<number>(96).fill(.2));
    const trace = network.predict(Array<number>(160).fill(.15)).trace;
    const parameters = freezeBrainParameters(network); const frozen = freezeBrainTrace(trace)!;
    const before = incomingConnections(parameters, frozen, { layer: 2, index: 0 }, 'candidate');
    const frozenJson = JSON.stringify(frozen);
    for (const layer of network.layers) { layer.weights.fill(0); layer.biases.fill(0); }
    network.recurrent.weightsInput.fill(0); network.recurrent.weightsHidden.fill(0);
    network.recurrent.biasInput.fill(0); network.recurrent.biasHidden.fill(0);
    for (const values of trace.layers) values.fill(0);
    trace.logits.fill(0); trace.probabilities.fill(0);
    for (const values of Object.values(trace.recurrent!)) values.fill(0);
    expect(JSON.stringify(frozen)).toBe(frozenJson);
    expect(incomingConnections(parameters, frozen, { layer: 2, index: 0 }, 'candidate')).toEqual(before);
    expect(parameters.layers[0].weights.some(value => value !== 0)).toBe(true);
    expect(parameters.recurrent.biasInput).not.toBe(network.recurrent.biasInput);
    expect(parameters.recurrent.biasHidden).not.toBe(network.recurrent.biasHidden);
  });
});
