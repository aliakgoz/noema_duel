/** Verify the deployed JS GRU against independently trained PyTorch tensors. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { TinyNetwork, PARAMETER_COUNT } from '../src/ml/network';

const bundle = JSON.parse(await readFile('artifacts/gru-experiment/long-parity/models.json', 'utf8'));
const results = [];
for (const model of bundle.models.filter((entry: { architecture: string }) => entry.architecture === 'gru')) {
  const snapshot = new TinyNetwork(model.seed).snapshot();
  const tensor = (name: string): number[] => model.stateDict[name].values;
  snapshot.weights = ['fc1.weight', 'fc2.weight', 'head.weight'].map(tensor);
  snapshot.biases = ['fc1.bias', 'fc2.bias', 'head.bias'].map(tensor);
  snapshot.recurrent = {
    weightsInput: tensor('gru.weight_ih_l0'), weightsHidden: tensor('gru.weight_hh_l0'),
    biasInput: tensor('gru.bias_ih_l0'), biasHidden: tensor('gru.bias_hh_l0'),
  };
  const network = TinyNetwork.fromSnapshot(snapshot);
  assert.equal(PARAMETER_COUNT, 77926); assert.equal(network.parameterCount, 77926);
  let maximumError = 0, steps = 0;
  for (const sequence of model.parity) {
    network.resetMemory();
    for (const expected of sequence.steps) {
      const before = Array.from(network.getMemory());
      network.preview(expected.observation);
      assert.deepEqual(Array.from(network.getMemory()), before, 'Preview must not advance memory');
      const actual = network.predict(expected.observation);
      assert.equal(actual.trace.layers.length, 5);
      assert.deepEqual(actual.trace.layers.map(layer => layer.length), [160, 96, 96, 64, 6]);
      for (let i = 0; i < 6; i++) maximumError = Math.max(maximumError, Math.abs(actual.trace.logits[i] - expected.logits[i]));
      steps++;
    }
  }
  assert(maximumError < 1e-4, 'Live GRU differs from PyTorch: ' + maximumError);
  const serialized = network.serialize();
  const restored = TinyNetwork.deserialize(serialized);
  assert.equal(restored.serialize(), serialized);
  assert(Array.from(restored.getMemory()).every(value => value === 0), 'Weights reload with fresh episode memory');
  results.push({ model: model.id, steps, maximumLogitError: maximumError, previewPure: true, serializationExact: true });
}
assert.equal(results.length, 2);
const result = { passed: true, architecture: [160, 96, 96, 64, 6], parameters: 77926, tolerance: 1e-4, models: results };
await writeFile('artifacts/gru-live-parity.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
