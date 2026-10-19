import { describe, expect, it } from 'vitest';
import { TinyNetwork } from '../ml/network';
import { recurrentTensors } from '../ml/recurrent';
import { createDuel, ROBOT_MAX_SPEED } from './engine';
import { COURT } from './types';
import { createDuelModel, DUEL_ARCHITECTURE, DUEL_INPUTS, DUEL_PARAMETER_COUNT, duelSequenceLossAndGradients, encodeDuelAction, encodeDuelObservation, getDuelMemory, getDuelParameters, getDuelTrace, isDuelModel, MODEL_VERSION, predictDuel, previewDuel, resetDuelMemory, trainDuel, trainSync } from './learning';
import type { DuelSample } from './learning';
import type { DuelState, ManualInput } from './types';

function observation(x = -8, z = -2, enemyZ = 2, healthPercent = 100): DuelState {
  const state = createDuel('open');
  state.robots[0].x = x; state.robots[0].z = z;
  state.robots[1].z = enemyZ; state.robots[1].hp = state.robots[1].maxHp * healthPercent / 100;
  return state;
}
function demonstration(state: DuelState): ManualInput {
  const robot = state.robots[0], enemy = state.robots[1];
  return { move: { x: (robot.x + 7) / 5, z: -robot.z / 6 }, aim: { x: robot.x + 12, z: robot.z + enemy.z * 2 }, power: .45 + enemy.z / 15, fire: enemy.hp / enemy.maxHp < .5, interact: false };
}
function sample(state: DuelState): DuelSample { return { input: encodeDuelObservation(state), output: encodeDuelAction(state, demonstration(state)) }; }
function cueState(cue = 0): DuelState {
  const state = observation(-8, 0, cue * 6);
  state.walls = []; state.crates = [];
  state.robots.forEach(robot => { robot.cooldown = 0; robot.angle = 0; });
  return state;
}
function cueEpisode(cue: number, id: string, length = 5): DuelSample[] {
  return Array.from({ length }, (_, step) => ({ input: encodeDuelObservation(cueState(step === 0 ? cue : 0)), output: [cue > 0 ? .7 : -.7, 0, 0, .7, cue > 0 ? 1 : 0, 0], episodeId: id, sequenceStart: step === 0 }));
}
function angularError(a: number, b: number) { return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))); }

describe('duel original GRU96 motor policy', () => {
  it('uses exactly the original 77,926 trainable parameters and full real GRU traces', () => {
    const model = createDuelModel(17), original = new TinyNetwork(17).snapshot(), parameters = getDuelParameters(model);
    expect(model.version).toBe(MODEL_VERSION);
    expect(model.architecture).toEqual([160, 96, 96, 64, 6]); expect(model.architecture).toEqual([...DUEL_ARCHITECTURE]);
    expect(model.weights).toEqual(original.weights); expect(model.biases).toEqual(original.biases); expect(model.recurrent).toEqual(original.recurrent);
    const actual = parameters.layers.reduce((sum, layer) => sum + layer.weights.length + layer.biases.length, 0) + recurrentTensors(parameters.recurrent).reduce((sum, tensor) => sum + tensor.length, 0);
    expect(actual).toBe(77926); expect(actual).toBe(DUEL_PARAMETER_COUNT); expect(parameters.parameterCount).toBe(77926);
    const trace = previewDuel(model, observation());
    expect(trace.layers.map(layer => layer.length)).toEqual([160, 96, 96, 64, 6]);
    expect(trace.recurrent?.memory).toHaveLength(96); expect(trace.recurrent?.reset).toHaveLength(96); expect(trace.recurrent?.update).toHaveLength(96);
    expect(trace.layers.flat().every(Number.isFinite)).toBe(true);
  });

  it('consumes exactly one recurrent step per prediction, with pure previews and transient memory excluded from JSON', () => {
    const model = createDuelModel(11), state = observation(), encoded = JSON.stringify(model);
    expect(Array.from(getDuelMemory(model))).toEqual(Array(96).fill(0));
    const first = previewDuel(model, state); expect(previewDuel(model, state)).toEqual(first);
    expect(Array.from(getDuelMemory(model))).toEqual(Array(96).fill(0));
    const action = predictDuel(model, state), memory = getDuelMemory(model);
    expect(getDuelTrace(model)).toEqual(first); expect(Array.from(memory)).toEqual(first.recurrent?.memory);
    const next = previewDuel(model, state); expect(getDuelMemory(model)).toEqual(memory);
    predictDuel(model, state); expect(getDuelTrace(model)).toEqual(next); expect(getDuelTrace(model)?.recurrent?.previous).toEqual(Array.from(memory));
    expect(JSON.stringify(model)).toBe(encoded);
    const restored = JSON.parse(encoded); expect(isDuelModel(restored)).toBe(true);
    expect(Array.from(getDuelMemory(restored))).toEqual(Array(96).fill(0));
    resetDuelMemory(model); expect(predictDuel(model, state)).toEqual(action);
    const leaked = { ...model, memory: Array(96).fill(0) }; expect(isDuelModel(leaked)).toBe(false);
    const malformed = structuredClone(model); malformed.recurrent.weightsHidden[4] = NaN; expect(isDuelModel(malformed)).toBe(false);
    expect(isDuelModel({ ...model, version: 'noema-duel-imitation-v2' })).toBe(false);
  });

  it('encodes 160 bounded real court sensors and the exact six motor targets', () => {
    const state = observation(), original = encodeDuelObservation(state), robot = state.robots[0];
    expect(original).toHaveLength(DUEL_INPUTS);
    expect(original.every(value => Number.isFinite(value) && Math.abs(value) <= 1)).toBe(true);
    expect(original[0]).toBeCloseTo(robot.x / COURT.halfWidth); expect(original[1]).toBeCloseTo(robot.z / COURT.halfDepth);
    state.robots[0].decision = { action: 'oracle', reason: 'oracle', target: { x: 999, z: -999 }, aim: { x: 999, z: 999 }, power: 1 };
    expect(encodeDuelObservation(state)).toEqual(original);
    state.projectiles.push({ id: 8, owner: 1, x: -5, z: 0, vx: -16, vz: 4, radius: .2, damage: 20, life: 2, bounces: 0, trail: [] });
    expect(encodeDuelObservation(state)[22]).toBeCloseTo(-16 / 18);
    state.robots[0].vx = ROBOT_MAX_SPEED; expect(encodeDuelObservation(state)[2]).toBe(1);
    state.walls.push({ id: 'nearby', x: robot.x, z: robot.z - 3.6, width: 2, depth: .4, kind: 'bounce' });
    expect(encodeDuelObservation(state).slice(92, 156)).not.toEqual(original.slice(92, 156));
    const action = encodeDuelAction(state, { move: { x: 1, z: -1 }, aim: { x: robot.x - 3, z: robot.z + 4 }, power: .42, fire: true, interact: true });
    expect(action).toHaveLength(6); expect(action[0]).toBeCloseTo(Math.SQRT1_2); expect(action[1]).toBeCloseTo(-Math.SQRT1_2);
    expect(action[2]).toBeCloseTo(Math.atan2(4, -3) / Math.PI); expect(action.slice(3)).toEqual([1, 1, 1]);
  });

  it('BPTT derivatives agree with finite differences through every dense layer and all four GRU tensors', () => {
    const model = createDuelModel(51), parameters = getDuelParameters(model);
    const sequence = [sample(observation(-9, -3, 2, 20)), sample(observation(-7, -1, -2, 100)), sample(observation(-5, 2, 1, 20))];
    const memory = Float32Array.from({ length: 96 }, (_, i) => Math.sin(i * .4) * .2);
    const analytic = duelSequenceLossAndGradients(model, sequence, memory), epsilon = .003;
    const check = (tensor: Float32Array, index: number, gradient: number) => {
      const original = tensor[index];
      tensor[index] = original + epsilon; const plus = duelSequenceLossAndGradients(model, sequence, memory).loss;
      tensor[index] = original - epsilon; const minus = duelSequenceLossAndGradients(model, sequence, memory).loss;
      tensor[index] = original;
      expect(Math.abs((plus - minus) / (2 * epsilon) - gradient)).toBeLessThan(.0002);
    };
    parameters.layers.forEach((layer, group) => {
      const gradient = analytic.gradients[group]; let strongest = 0;
      for (let i = 1; i < layer.weights.length; i++) if (Math.abs(gradient[i]) > Math.abs(gradient[strongest])) strongest = i;
      check(layer.weights, strongest, gradient[strongest]); check(layer.biases, 0, gradient[layer.weights.length]);
    });
    recurrentTensors(parameters.recurrent).forEach((tensor, group) => {
      const gradient = analytic.gradients[group + 3], gateSize = tensor.length / 3;
      for (let gate = 0; gate < 3; gate++) {
        let strongest = gate * gateSize;
        for (let i = strongest + 1; i < (gate + 1) * gateSize; i++) if (Math.abs(gradient[i]) > Math.abs(gradient[strongest])) strongest = i;
        expect(Math.abs(gradient[strongest])).toBeGreaterThan(1e-8); check(tensor, strongest, gradient[strongest]);
      }
    });
    expect(Array.from(getDuelMemory(model))).toEqual(Array(96).fill(0));
  }, 20000);

  it('learns delayed movement and fire cues that disappear from later identical observations', () => {
    const data = [-1, -.7, -.4, .4, .7, 1].flatMap((cue, i) => cueEpisode(cue, 'train-' + i));
    const original = createDuelModel(321), before = JSON.stringify(original);
    const result = trainSync(data, original, { epochs: 80 });
    expect(JSON.stringify(original)).toBe(before); expect(result.model.trainedSteps).toBe(data.length * 80);
    for (const cue of [-.55, .55]) {
      resetDuelMemory(result.model);
      const actions = Array.from({ length: 5 }, (_, step) => predictDuel(result.model, cueState(step === 0 ? cue : 0)));
      for (const action of actions) { expect(action.move.x * Math.sign(cue)).toBeGreaterThan(.35); expect(action.fire).toBe(cue > 0); }
    }
    // Identical blank input can produce different later actions only through real recurrent memory.
    expect(encodeDuelObservation(cueState())).toEqual(cueEpisode(.55, 'held')[1].input);
    expect(isDuelModel(result.model)).toBe(true);
  }, 30000);

  it('learns held-out continuous movement, aim and fire targets while always using full power', () => {
    const data = Array.from({ length: 128 }, (_, i) => sample(observation(-10 + ((i * .61803398875) % 1) * 6, -4 + ((i * .41421356237) % 1) * 8, -3 + ((i * .73205080757) % 1) * 6, i % 2 ? 20 : 100)));
    const progress: number[] = [], result = trainSync(data, createDuelModel(81), { epochs: 70, onProgress: value => progress.push(value.loss) });
    expect(progress.at(-1)!).toBeLessThan(progress[0] * .12);
    for (const [x, z, enemyZ, hp] of [[-9, -3, 2, 20], [-5, 3, -2, 100], [-7, 1, 2.5, 100]]) {
      const state = observation(x, z, enemyZ, hp), expected = demonstration(state); resetDuelMemory(result.model);
      const actual = predictDuel(result.model, state);
      expect(Math.abs(actual.move.x - expected.move.x)).toBeLessThan(.18); expect(Math.abs(actual.move.z - expected.move.z)).toBeLessThan(.18);
      expect(actual.power).toBe(1); expect(actual.fire).toBe(expected.fire); expect(actual.interact).toBe(false);
      expect(angularError(Math.atan2(actual.aim.z - z, actual.aim.x - x), Math.atan2(expected.aim.z - z, expected.aim.x - x))).toBeLessThan(.15);
    }
  }, 30000);

  it('learns across the -π/+π aim seam using circular loss rather than averaging to the opposite direction', () => {
    const state = cueState();
    const data = Array.from({ length: 16 }, (_, i) => ({ input: encodeDuelObservation(state), output: [0, 0, i % 2 ? .99 : -.99, .7, 1, 0] }));
    const result = trainSync(data, createDuelModel(19), { epochs: 70 }), action = predictDuel(result.model, state);
    const angle = Math.atan2(action.aim.z - state.robots[0].z, action.aim.x - state.robots[0].x);
    expect(Math.cos(angle)).toBeLessThan(-.98); expect(action.fire).toBe(true); expect(action.interact).toBe(false);
  }, 20000);

  it('defaults to one training pass and continues from existing weights with the selected pass count', () => {
    const data = [sample(observation()), sample(observation(-8, 1))];
    const first = trainSync(data, createDuelModel());
    expect(first.model.trainedSteps).toBe(data.length);
    const continued = trainSync(data, first.model, { epochs: 3 });
    expect(continued.model.trainedSteps).toBe(data.length * 4);
    expect(first.model.trainedSteps).toBe(data.length);
  });

  it('ignores legacy power neuron predictions while preserving the imported model', () => {
    const model = createDuelModel(18), parameters = getDuelParameters(model);
    parameters.layers[2].biases[3] = -20;
    const state = observation();
    expect(previewDuel(model, state).layers[4][3]).toBeLessThan(.001);
    expect(predictDuel(model, state).power).toBe(1);
    expect(encodeDuelAction(state, { ...demonstration(state), power: .1 })[3]).toBe(1);
  });

  it('rejects malformed motor data and cancellation without changing the active model', async () => {
    expect(() => trainSync([])).toThrow(/örnek/); expect(() => trainSync([{ input: [1], output: [] }])).toThrow(/boyutu/);
    const invalid = sample(observation()); invalid.output[4] = 2; expect(() => trainSync([invalid])).toThrow(/geçersiz/);
    const malformed = sample(observation()); malformed.sequenceStart = 'yes' as unknown as boolean; expect(() => trainSync([malformed])).toThrow(/sınırı/);
    const controller = new AbortController(); controller.abort();
    await expect(trainDuel([sample(observation())], undefined, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    const midflight = new AbortController(), model = createDuelModel(), before = JSON.stringify(model);
    await expect(trainDuel([sample(observation())], model, { epochs: 20, signal: midflight.signal, onProgress: () => midflight.abort() })).rejects.toMatchObject({ name: 'AbortError' });
    expect(JSON.stringify(model)).toBe(before);
  });

  it('learns rare cover interaction from real nearby-crate observations', () => {
    function coverState(near: boolean, enemyZ: number) {
      const state = observation(-9, -2, enemyZ);
      state.crates = [{ ...state.crates[0], x: near ? -8 : -3, z: near ? -2 : 5 }];
      return state;
    }
    const samples = Array.from({ length: 72 }, (_, i) => {
      const near = i % 18 === 0, state = coverState(near, -4 + i % 9);
      return { input: encodeDuelObservation(state), output: encodeDuelAction(state, { move: { x: 0, z: 0 }, aim: state.robots[1], power: .7, fire: false, interact: near }) };
    });
    const result = trainSync(samples, createDuelModel(902), { epochs: 60 });
    for (const near of [true, false]) for (const enemyZ of [-1.5, 2.5]) {
      resetDuelMemory(result.model);
      const action = predictDuel(result.model, coverState(near, enemyZ));
      expect(action.interact).toBe(near); expect(action.fire).toBe(false);
    }
  }, 30000);
});
