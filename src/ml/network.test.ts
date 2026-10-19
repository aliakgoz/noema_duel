import { describe, expect, it } from 'vitest';
import type { Action } from '../core/types';
import { ARCHITECTURE, GRU_HIDDEN, GRU_PARAMETER_COUNT, PARAMETER_COUNT, TinyNetwork, type TrainingSample } from './network';
import { recurrentTensors } from './recurrent';

function example(action: number, variant: number): TrainingSample {
  const input = Array<number>(160).fill(0); input[action] = 0.65 + variant * 0.025;
  for (let i = 8; i < 24; i++) input[i] = Math.sin(i * 2.73 + variant * 1.91 + action) * 0.08;
  return { input, action: action as Action };
}
function cueEpisode(cue: number, id: string, length = 5): TrainingSample[] {
  return Array.from({ length }, (_, step) => {
    const input = Array<number>(160).fill(0); input[0] = step === 0 ? cue : 0; input[1] = step === 0 ? 1 : -1;
    return { input, action: (cue > 0 ? 1 : 2) as Action, episodeId: id, sequenceStart: step === 0 };
  });
}

describe('fixed GRU neural policy', () => {
  it('uses reproducible 77,926 real parameters and traces every layer and gate', () => {
    const network = new TinyNetwork(12); const first = network.predict(example(2, 0).input);
    expect(network.parameterCount).toBe(77926); expect(network.parameterCount).toBe(PARAMETER_COUNT);
    expect(GRU_PARAMETER_COUNT).toBe(55872);
    const actualCount = network.layers.reduce((sum, layer) => sum + layer.weights.length + layer.biases.length, 0) + recurrentTensors(network.recurrent).reduce((sum, tensor) => sum + tensor.length, 0);
    expect(actualCount).toBe(PARAMETER_COUNT);
    expect(first).toEqual(new TinyNetwork(12).predict(example(2, 0).input));
    expect(first.trace.layers.map(layer => layer.length)).toEqual([...ARCHITECTURE]);
    expect(first.probabilities.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 6);
    expect(first.trace.recurrent?.reset).toHaveLength(96); expect(first.trace.recurrent?.update).toHaveLength(96);
    expect(first.trace.recurrent?.candidate).toHaveLength(96); expect(first.trace.recurrent?.memory).toEqual(first.trace.layers[2]);
  });

  it('keeps actual recurrent memory, allows pure previews and resets only ephemeral state', () => {
    const network = new TinyNetwork(111); const input = example(2, 3).input; const weights = network.serialize();
    const zero = Array<number>(GRU_HIDDEN).fill(0);
    const preview = network.preview(input); expect(Array.from(network.getMemory())).toEqual(zero);
    expect(network.preview(input)).toEqual(preview);
    const first = network.predict(input); expect(first).toEqual(preview);
    const memory = network.getMemory(); expect(Array.from(memory)).not.toEqual(zero);
    memory.fill(0); expect(Array.from(network.getMemory())).not.toEqual(zero);
    const beforePreview = network.getMemory(); const nextPreview = network.preview(input);
    expect(network.getMemory()).toEqual(beforePreview); expect(network.predict(input)).toEqual(nextPreview);
    expect(network.serialize()).toBe(weights);
    network.resetMemory(); expect(network.predict(input)).toEqual(first);
    network.setMemory(Array<number>(96).fill(0.15)); expect(network.preview(input).trace.recurrent?.previous).toEqual(Array.from(Float32Array.from({ length: 96 }, () => 0.15)));
    expect(() => network.setMemory([1])).toThrow(/96/); expect(() => network.setMemory(Array<number>(96).fill(2))).toThrow(/memory/);
  });

  it('BPTT agrees with central finite differences through every dense layer and all GRU gate/bias tensors', () => {
    const network = new TinyNetwork(17);
    const sequence = [example(3, 4), example(1, 2), example(5, 8)];
    const initial = Float32Array.from({ length: 96 }, (_, i) => Math.sin(i * 0.4) * 0.25);
    const analytic = network.sequenceLossAndGradients(sequence, initial); const epsilon = 0.004;
    const loss = () => network.sequenceLossAndGradients(sequence, initial).loss;
    const check = (tensor: Float32Array, index: number, gradient: number) => {
      const original = tensor[index]; tensor[index] = original + epsilon; const plus = loss(); tensor[index] = original - epsilon; const minus = loss(); tensor[index] = original;
      expect(Math.abs((plus - minus) / (2 * epsilon) - gradient)).toBeLessThan(0.00015);
    };
    for (let layerIndex = 0; layerIndex < network.layers.length; layerIndex++) {
      const layer = network.layers[layerIndex];
      for (const index of [3, Math.floor(layer.weights.length / 3), layer.weights.length - 1]) check(layer.weights, index, analytic.gradients[layerIndex][index]);
      check(layer.biases, 0, analytic.gradients[layerIndex][layer.weights.length]);
    }
    recurrentTensors(network.recurrent).forEach((tensor, group) => {
      const gateSize = tensor.length / 3;
      for (const gate of [0, 1, 2]) {
        const start = gate * gateSize; let strongest = start;
        for (let i = start + 1; i < start + gateSize; i++) if (Math.abs(analytic.gradients[group + 3][i]) > Math.abs(analytic.gradients[group + 3][strongest])) strongest = i;
        expect(Math.abs(analytic.gradients[group + 3][strongest])).toBeGreaterThan(1e-7);
        check(tensor, strongest, analytic.gradients[group + 3][strongest]);
      }
    });
    // At nonzero temporal distance, a later target really changes the first-step gradient.
    const altered = sequence.map((sample, i) => i === 2 ? { ...sample, action: 0 as Action } : sample);
    expect(network.sequenceLossAndGradients(altered, initial).gradients[4]).not.toEqual(analytic.gradients[4]);
  });

  it('learns a held-out input pattern through genuine updates', async () => {
    const network = new TinyNetwork(91);
    const training = Array.from({ length: 48 }, (_, i) => example(i % 6, Math.floor(i / 6)));
    const heldOut = Array.from({ length: 24 }, (_, i) => example(i % 6, 10 + Math.floor(i / 6)));
    const before = network.evaluate(heldOut); const progress: number[] = [];
    const metrics = await network.train(training, 12, 8, value => progress.push(value.epoch), undefined, false);
    const after = network.evaluate(heldOut);
    expect(after.loss).toBeLessThan(before.loss * 0.2); expect(after.accuracy).toBeGreaterThanOrEqual(0.95);
    expect(metrics.loss).toBeLessThan(0.15); expect(network.trainedSteps).toBe(48 * 12);
    expect(progress).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  }, 20000);

  it('learns a delayed cue that is absent from later identical inputs, using ordered BPTT', async () => {
    const network = new TinyNetwork(321);
    const training = [-1, -0.7, -0.4, 0.4, 0.7, 1].flatMap((cue, index) => cueEpisode(cue, `train-${index}`));
    const heldOut = [-0.55, 0.55].flatMap((cue, index) => cueEpisode(cue, `hold-${index}`));
    expect(network.evaluate(heldOut).accuracy).toBeLessThan(0.8);
    const memory = network.getMemory(); await network.train(training, 40, 10, undefined, undefined, false);
    expect(network.evaluate(heldOut).accuracy).toBe(1); expect(network.getMemory()).toEqual(memory);
    for (const cue of [-0.55, 0.55]) {
      network.resetMemory(); const episode = cueEpisode(cue, 'rollout');
      const actions = episode.map(sample => network.predict(sample.input).action);
      expect(actions).toEqual(episode.map(sample => sample.action));
      // Without the cue history, the same blank observation cannot encode both labels.
      network.resetMemory(); const blank = episode[episode.length - 1].input;
      expect(network.preview(blank).trace.recurrent?.previous.every(value => value === 0)).toBe(true);
    }
  }, 30000);

  it('round-trips every real tensor while excluding ephemeral memory and rejects malformed documents', () => {
    const network = new TinyNetwork(6); network.predict(example(1, 2).input);
    const loaded = TinyNetwork.deserialize(network.serialize());
    expect(loaded.getMemory().every(value => value === 0)).toBe(true);
    network.resetMemory(); expect(loaded.predict(example(1, 2).input)).toEqual(network.predict(example(1, 2).input));
    const snapshot = network.snapshot(); expect(new TextEncoder().encode(network.serialize()).length).toBeLessThan(2 * 1024 * 1024);
    expect(() => TinyNetwork.deserialize(' '.repeat(2 * 1024 * 1024 + 1))).toThrow(/2 MB/);
    expect(() => TinyNetwork.deserialize('{not json')).toThrow(/JSON/);
    expect(() => TinyNetwork.fromSnapshot({ ...snapshot, version: 'noema-160-64-64-6-v2' })).toThrow(/version/);
    expect(() => TinyNetwork.fromSnapshot({ ...snapshot, architecture: [160, 96, 64, 6] })).toThrow(/architecture/);
    expect(() => TinyNetwork.fromSnapshot({ ...snapshot, weights: [[1], ...snapshot.weights.slice(1)] })).toThrow(/shape/);
    expect(() => TinyNetwork.fromSnapshot({ ...snapshot, recurrent: undefined })).toThrow(/recurrent/);
    const corrupt = network.snapshot(); corrupt.recurrent!.weightsHidden[0] = Number.NaN;
    expect(() => TinyNetwork.fromSnapshot(corrupt)).toThrow(/finite/);
    corrupt.recurrent!.weightsHidden[0] = Infinity; expect(() => TinyNetwork.fromSnapshot(corrupt)).toThrow(/finite/);
    corrupt.recurrent!.weightsHidden[0] = 1e20; expect(() => TinyNetwork.fromSnapshot(corrupt)).toThrow(/finite/);
    expect(() => TinyNetwork.fromSnapshot({ ...snapshot, recurrent: { ...snapshot.recurrent, hidden: [] } })).toThrow(/field/);
    expect(() => TinyNetwork.fromSnapshot({ ...snapshot, code: 'run()' })).toThrow(/field/);
    expect(() => TinyNetwork.fromSnapshot(JSON.parse(network.serialize().replace('"version":', '"__proto__":{},"version":')))).toThrow(/field/);
  });

  it('validates the complete training dataset and cancellation before any update', async () => {
    const network = new TinyNetwork(4); const before = network.serialize(); const abort = new AbortController(); abort.abort();
    await expect(network.train([example(0, 0)], 2, 1, undefined, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(network.train([example(0, 0), { input: [1], action: 0 }], 2, 1)).rejects.toThrow(/160/);
    await expect(network.train([{ ...example(0, 0), episodeId: '' }], 2, 1)).rejects.toThrow(/episode/);
    expect(network.serialize()).toBe(before);
  });

  it('respects explicit episode boundaries and does not mutate live inference memory when evaluating', () => {
    const network = new TinyNetwork(123); const input = example(2, 2).input; network.predict(input); const memory = network.getMemory();
    const joined = cueEpisode(0.5, 'one'); const reset = joined.map(sample => ({ ...sample, sequenceStart: true }));
    expect(network.evaluate(joined).loss).not.toBe(network.evaluate(reset).loss);
    const independent = joined.map(({ input, action }) => ({ input, action }));
    expect(network.evaluate(reset)).toEqual(network.evaluate(independent)); expect(network.getMemory()).toEqual(memory);
  });

  it('produces identical ordered updates in worker and cooperative scheduling', async () => {
    const samples = [-0.7, 0.7].flatMap((cue, i) => cueEpisode(cue, String(i), 3));
    const cooperative = new TinyNetwork(151); const dedicated = new TinyNetwork(151);
    await cooperative.train(samples, 3, 3); await dedicated.train(samples, 3, 3, undefined, undefined, false);
    expect(dedicated.snapshot()).toEqual(cooperative.snapshot()); expect(dedicated.evaluate(samples)).toEqual(cooperative.evaluate(samples));
  }, 15000);
});
