/**
 * Reproducible architecture audit. This script does not train or modify a model.
 * Run: node --import tsx scripts/analyze-model.ts
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createState, step } from '../src/core/engine.ts';
import { LEVELS, LEVEL_SOLUTIONS } from '../src/core/levels.ts';
import { encodeObservation } from '../src/core/observation.ts';
import { MODEL_INPUTS, type Action, type GameState, type Level, type Surface } from '../src/core/types.ts';
import { ARCHITECTURE, PARAMETER_COUNT } from './research-mlp-reference.ts';
const MODEL_VERSION = 'noema-160-64-64-6-v2'; // Frozen historical baseline, not the shipped GRU.

const dense = (inputs: number, outputs: number, bias = true) => inputs * outputs + (bias ? outputs : 0);
const mlp = (layers: readonly number[]) => layers.slice(1).reduce((sum, outputs, i) => sum + dense(layers[i], outputs), 0);
const gru = (inputs: number, hidden: number, biases: 1 | 2 = 2) => 3 * hidden * (inputs + hidden + biases);
const memory = (parameters: number) => ({
  float32WeightBytes: parameters * 4,
  // Weights, one gradient tensor, and Adam first/second moments only.
  weightsGradientAdamBytes: parameters * 16,
  excludes: 'activations, backpropagation-through-time buffers, dataset, JavaScript objects and runtime overhead',
});

/**
 * The maps differ only at (1,5)/(17,5), outside the 3x3 patch and four-cell rays.
 * Both directions are one-way conveyors. A wrong branch cannot be retraced.
 * All mechanics are the real game engine; no model/planner supplies actions.
 */
function aliasFixture(blockLeft: boolean): Level {
  const width = 19, height = 15;
  const grid = Array.from({ length: height }, () => Array<string>(width).fill('#'));
  for (let x = 1; x <= 17; x++) { grid[11][x] = '.'; grid[1][x] = '.'; }
  for (let z = 1; z <= 11; z++) { grid[z][1] = '.'; grid[z][17] = '.'; }
  grid[5][blockLeft ? 1 : 17] = '#';
  const surfaces: Surface[] = [];
  for (let x = 2; x <= 8; x++) surfaces.push({ x, z: 11, kind: 'conveyor', direction: 3 });
  for (let x = 10; x <= 16; x++) surfaces.push({ x, z: 11, kind: 'conveyor', direction: 1 });
  return {
    id: blockLeft ? 'audit-right-only' : 'audit-left-only', title: 'Observation audit', subtitle: '',
    chapter: 5, difficulty: 5, width, height, tiles: grid.map(row => row.join('')),
    start: { x: 9, z: 11 }, facing: 0, crates: [], switches: [], doors: [],
    goals: [{ x: 9, z: 1, kind: 'exit' }], par: 19, description: 'Analysis fixture; not a shipped level.', surfaces,
  };
}

// Exact dynamic state for these finite fixtures; counters/text cannot affect any transition.
function key(state: GameState): string {
  return JSON.stringify([state.robot, state.crates, state.switches, state.doors, state.sequenceProgress ?? {}, state.solved]);
}

/** Exhaust the whole reachable dynamic-state graph, rather than interpreting a search timeout as failure. */
function reachability(initial: GameState) {
  const nodes: { state: GameState; parent: number; action: Action; depth: number }[] = [{ state: initial, parent: -1, action: 5, depth: 0 }];
  const seen = new Set([key(initial)]);
  let solution: Action[] | null = null;
  for (let cursor = 0; cursor < nodes.length; cursor++) {
    assert(nodes.length < 30_000, 'Audit fixture graph exceeded its explicit bound; no impossibility claim is valid.');
    const node = nodes[cursor];
    if (node.state.solved) {
      solution = [];
      for (let index = cursor; nodes[index].parent !== -1; index = nodes[index].parent) solution.push(nodes[index].action);
      solution.reverse();
      return { solvable: true, solution, exploredStates: cursor + 1, discoveredStates: nodes.length, graphExhausted: false };
    }
    for (let action = 0; action < 6; action++) {
      const next = step(node.state, action as Action), nextKey = key(next);
      if (seen.has(nextKey)) continue;
      seen.add(nextKey); nodes.push({ state: next, parent: cursor, action: action as Action, depth: node.depth + 1 });
    }
  }
  return { solvable: false, solution, exploredStates: nodes.length, discoveredStates: nodes.length, graphExhausted: true };
}

const left = aliasFixture(false), right = aliasFixture(true);
const leftState = createState(left), rightState = createState(right);
const observationA = encodeObservation(leftState), observationB = encodeObservation(rightState);
const identical = observationA.every((value, i) => Object.is(value, observationB[i]));
assert(identical, 'Update the audit: the encoder now distinguishes the two maps.');
const branchResults = [leftState, rightState].flatMap(state => ([3, 1] as Action[]).map(action => {
  const after = step(state, action);
  return { fixture: state.level.id, firstAction: action, branchPosition: after.robot, ...reachability(after) };
}));
assert.deepEqual(branchResults.map(result => result.solvable), [true, false, false, true]);
assert(branchResults.filter(result => !result.solvable).every(result => result.graphExhausted));

const current = mlp(ARCHITECTURE);
assert.equal(current, PARAMETER_COUNT);
const dense3 = mlp([160, 96, 96, 64, 6]);
const recurrent96Single = dense(160, 96) + gru(96, 96, 1) + dense(96, 64) + dense(64, 6);
const recurrent96Dual = dense(160, 96) + gru(96, 96, 2) + dense(96, 64) + dense(64, 6);
const recurrent128Dual = dense(160, 128) + gru(128, 96, 2) + dense(96, 64) + dense(64, 6);
const continuityResidual = current + gru(64, 96, 2) + dense(96, 64, false);
// Complete proposed spatial + memory branch; arithmetic only, not implemented/trained.
const spatialEncoder = (3 * 3 * 16 + 1) * 16 + (3 * 3 * 16 + 1) * 24 + dense(5 * 5 * 24, 32);
const spatialMemoryResidual = current + spatialEncoder + gru(64 + 32, 96, 2) + dense(96, 64, false);
const spatialNoMemoryResidual = current + spatialEncoder + dense(32, 64, false);
assert.equal(current, 14_854); assert.equal(dense3, 31_366);
assert.equal(recurrent96Single, 77_638); assert.equal(recurrent96Dual, 77_926);
assert.equal(recurrent128Dual, 92_294); assert.equal(continuityResidual, 67_654);
assert.equal(spatialEncoder, 25_032); assert.equal(spatialMemoryResidual, 101_902);
assert.equal(spatialNoMemoryResidual, 41_934);

let previousEvidence: unknown = null;
try {
  const evidence = JSON.parse(await readFile(new URL('../artifacts/e2e/learning.json', import.meta.url), 'utf8'));
  previousEvidence = {
    source: 'artifacts/e2e/learning.json', finishedAt: evidence.finishedAt,
    description: 'Two first-room styles only; 100% demonstration accuracy does not measure all-mechanic generalization.',
    styles: evidence.styles.map((style: { name: string; originalSamples: number; accuracy: number; nearbyStarts: { solved: boolean }[]; heldOut: { solved: boolean }[] }) => ({
      name: style.name, originalSamples: style.originalSamples, demonstrationAccuracy: style.accuracy,
      nearbySolved: style.nearbyStarts.filter(result => result.solved).length, nearbyTotal: style.nearbyStarts.length,
      unrelatedRoomsSolved: style.heldOut.filter(result => result.solved).length, unrelatedRoomsTotal: style.heldOut.length,
    })),
  };
} catch { /* Existing evidence is optional; this audit never invents missing test results. */ }

const report = {
  generatedAt: new Date().toISOString(), purpose: 'Source audit and exact parameter arithmetic; candidate architectures are not trained or implemented by this script.',
  model: { version: MODEL_VERSION, inputs: MODEL_INPUTS, architecture: ARCHITECTURE, hiddenLayers: ARCHITECTURE.length - 2, parameterizedLayers: ARCHITECTURE.length - 1, parameters: current },
  levels: {
    count: LEVELS.length, chapters: [...new Set(LEVELS.map(level => level.chapter))],
    maxWidth: Math.max(...LEVELS.map(level => level.width)), maxHeight: Math.max(...LEVELS.map(level => level.height)),
    maxSideAfterRotation: Math.max(...LEVELS.flatMap(level => [level.width, level.height])),
    maxCrates: Math.max(...LEVELS.map(level => level.crates.length)), maxSwitches: Math.max(...LEVELS.map(level => level.switches.length)),
    maxDoors: Math.max(...LEVELS.map(level => level.doors.length)), maxSequenceGroups: Math.max(...LEVELS.map(level => level.sequences?.length ?? 0)),
    longestRecordedCertificateActions: Math.max(0, ...LEVELS.map(level => LEVEL_SOLUTIONS[level.id]?.length ?? 0)),
    certificateCaution: 'A validation certificate length is an example task horizon, not necessarily the optimal solution length and not a lower bound on model depth.',
    featureCounts: {
      crateLevels: LEVELS.filter(level => level.crates.length).length,
      pressureLevels: LEVELS.filter(level => level.switches.some(item => item.mode === 'pressure')).length,
      toggleLevels: LEVELS.filter(level => level.switches.some(item => item.mode === 'toggle')).length,
      iceLevels: LEVELS.filter(level => level.surfaces?.some(item => item.kind === 'ice')).length,
      conveyorLevels: LEVELS.filter(level => level.surfaces?.some(item => item.kind === 'conveyor')).length,
      orderedSwitchLevels: LEVELS.filter(level => level.sequences?.length).length,
      orGateLevels: LEVELS.filter(level => level.doors.some(item => item.logic === 'or')).length,
      invertedGateLevels: LEVELS.filter(level => level.doors.some(item => item.inverted)).length,
    },
  },
  observationAudit: {
    observed: ['3x3 terrain/object patch', 'four straight free rays capped at four tiles', 'nearest unsatisfied objects', 'nearest gate logic/count/on-fraction', 'nearest next sequence switch/progress', 'last two actions'],
    missingOrCompressed: ['full walkable topology beyond local patch and rays', 'all object identities and positions', 'door-to-controller binding graph', 'all unfinished sequence groups and their dependency relations', 'explicit persistent task stack or player intent'],
    consequence: 'The vector is not a sufficient Markov state for arbitrary combinations of the current mechanics. Extra layers, parameters, or recurrent memory cannot infer information never observed before an irreversible choice.',
    memoryCaution: 'Sequence progress is already part of state and observation. If the whole physical state and connectivity are observed, recurrence is not mathematically required merely because a solution spans many actions. Memory remains a useful hypothesis for exploration, task commitment and incomplete observations.',
  },
  aliasCounterexample: {
    fixturesAreSynthetic: true, notAClaimThatAuthoredLevelsAreUnsolvable: true, left, right,
    changedCells: [{ x: 1, z: 5 }, { x: 17, z: 5 }],
    bitIdenticalFloat32Observations: identical, observation: Array.from(observationA),
    branchResults,
    conclusion: 'One map requires the first committed branch to be left, the other right. The initial observations are identical, and neither turning, waiting nor interaction can reveal the remote wall before commitment. Wrong-branch impossibility was checked by exhausting its finite state graph.',
  },
  formulas: { dense: 'i*o + o (with bias)', gruSingleBias: '3*h*(i+h+1)', gruDualBias: '3*h*(i+h+2)', residualMapBranch: 'current + GRU(64+e,96,dual-bias) + 96*64 + (D*e+e), e=map-embedding width; D=map/relations representation width' },
  candidates: [
    { name: 'current', architecture: '160 -> dense64 -> dense64 -> 6', parameters: current, ...memory(current), status: 'Implemented; source-checked count.' },
    { name: 'dense-capacity-control', architecture: '160 -> dense96 -> dense96 -> dense64 -> 6', parameters: dense3, breakdown: [dense(160, 96), dense(96, 96), dense(96, 64), dense(64, 6)], ...memory(dense3), status: 'Untrained ablation candidate; does not repair missing observations.' },
    { name: 'recurrent96-single-bias', architecture: '160 -> dense96 -> GRU96 -> dense64 -> 6', parameters: recurrent96Single, ...memory(recurrent96Single), status: 'Untrained; single bias per gate. This is not the PyTorch dual-bias parameterization.' },
    { name: 'recurrent96-dual-bias', architecture: '160 -> dense96 -> GRU96 -> dense64 -> 6', parameters: recurrent96Dual, breakdown: [dense(160, 96), gru(96, 96), dense(96, 64), dense(64, 6)], ...memory(recurrent96Dual), status: 'Untrained recurrent working hypothesis; memory does not repair unobserved topology.' },
    { name: 'recurrent128-encoder-dual-bias', architecture: '160 -> dense128 -> GRU96 -> dense64 -> 6', parameters: recurrent128Dual, breakdown: [dense(160, 128), gru(128, 96), dense(96, 64), dense(64, 6)], ...memory(recurrent128Dual), status: 'Untrained wider-encoder comparison; no minimum-necessary claim.' },
    { name: 'continuity-preserving-residual', architecture: 'Keep current MLP; h1 -> GRU96 -> zero-initialized bias-free projection64; add to old h2 preactivation.', parameters: continuityResidual, breakdown: [current, gru(64, 96), dense(96, 64, false)], ...memory(continuityResidual), status: 'Migration design only. Zero projection preserves old logits initially; GRU needs a hidden-state-aware training/inference implementation. Does not repair missing observations.' },
    { name: 'spatial-memory-residual-proposal', architecture: '20x20x16 map -> Conv3x3/s2/p1/16 -> Conv3x3/s2/p1/24 -> Flatten600 -> Dense32; concat with old h1/64 -> GRU96 -> zero projection64 -> old h2 preactivation -> old 6 outputs.', parameters: spatialMemoryResidual, breakdown: [current, 2320, 3480, 19232, 55872, 6144], ...memory(spatialMemoryResidual), trainableBlocksOnLongestBranch: 6, inferenceMACs: 412160, status: 'Concrete design/count only. Not implemented, trained, capacity-proven or measured on a phone. Uses two spatial layers and one recurrent layer; map contains visible topology and controller bindings, not solutions.' },
    { name: 'spatial-without-memory-ablation', architecture: 'Keep old MLP + same 25,032-parameter map encoder -> zero bias-free projection32-to64 -> old h2 preactivation.', parameters: spatialNoMemoryResidual, breakdown: [current, spatialEncoder, dense(32, 64, false)], ...memory(spatialNoMemoryResidual), inferenceMACs: 352768, status: 'Unimplemented control to distinguish observation improvements from benefits of recurrence. Full physical state can make recurrence unnecessary.' },
  ],
  continuityWithMapEmbedding: {
    embeddingWidth: 32, formulaForInputWidthD: '76,902 + 32*D',
    calculation: { base: current, gruInputWidth: 96, gruHiddenWidth: 96, gruParameters: gru(96, 96), projectionNoBias: dense(96, 64, false), mapEncoder: '32*D+32' },
    caution: 'D must be defined from a sufficient spatial/relations representation. A 32-value learned embedding is a compression, not a proof of sufficiency. This count does not silently include an unimplemented CNN, graph network, planner or value head.',
  },
  connectedRoomImplications: {
    requestedByUser: 'Unlock another room, retrieve its crate, return, and satisfy the original room objective.',
    requirements: ['keep the whole connected puzzle state across room traversal', 'represent room/portal connectivity and object-gate bindings', 'retain unresolved goals in the source room', 'train and evaluate return trips and interrupted subtasks', 'keep learned weights across all lessons; reset episodic hidden state only at a new episode, not at an interior doorway'],
    caution: 'No parameter count can be inferred just by adding one room or one dependency. Benchmark long dependencies separately from local navigation.',
  },
  evidence: previousEvidence,
  recommendations: [
    'Repair observation aliasing first with full spatial topology and explicit controller/object/sequence bindings; expose observations rather than solver answers.',
    'Use the 31,366-parameter MLP as a capacity control and the 77,926-parameter recurrent model as a working hypothesis, not a guaranteed minimum. Preserve existing learning with the residual migration design if deploying a recurrent upgrade.',
    'Group train/validation/test splits by source puzzle/layout seed before augmentation; rotated or padded copies of one demonstration are not independent skills.',
    'Evaluate complete rollouts on unseen starts, changed topology, changed switch bindings, mechanics combinations and connected-room return trips. Training accuracy alone is not generalization.',
    'Collect player corrections at states the robot actually reaches; retain representative earlier-room replay. One clean trajectory contains little recovery behavior. Keeping weights does not itself prevent catastrophic forgetting; the current 5,000-example history limit and 3,000-example augmentation budget need skill/room-balanced replay checks.',
    'Measure fixed demonstration counts, equal optimizer/example budgets, several initialization seeds, CPU time, peak memory and device temperature on real low/mid-range phones. Parameter bytes alone do not establish mobile training speed. The current trainer also retains a per-example gradient work tensor in addition to its batch-gradient tensor.',
    'Treat GRU gates as gates within one recurrent layer. Unrolling 32 timesteps uses shared parameters and is not 32 new parameter layers.',
  ],
  primarySources: [
    { title: 'DAgger: A Reduction of Imitation Learning and Structured Prediction to No-Regret Online Learning', url: 'https://proceedings.mlr.press/v15/ross11a.html', relevance: 'Policy-induced state-distribution shift and iterative corrective demonstrations.' },
    { title: 'Relational inductive biases, deep learning, and graph networks', url: 'https://arxiv.org/abs/1806.01261', relevance: 'Structured representations and relations for combinatorial generalization; not a guarantee for this game.' },
    { title: 'Learning Phrase Representations using RNN Encoder-Decoder for Statistical Machine Translation', url: 'https://arxiv.org/abs/1406.1078', relevance: 'Original GRU-style gated recurrent memory architecture.' },
    { title: 'PyTorch GRU documentation', url: 'https://docs.pytorch.org/docs/stable/generated/torch.nn.GRU.html', relevance: 'Explicit three gates, recurrent state, and separate input/hidden biases for exact dual-bias counts.' },
    { title: 'Overcoming catastrophic forgetting in neural networks', url: 'https://arxiv.org/abs/1612.00796', relevance: 'Continual training may overwrite previously acquired skills; retaining a model across rooms is not itself a no-forgetting guarantee.' },
  ],
};
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
await writeFile(new URL('../artifacts/model-analysis.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output: 'artifacts/model-analysis.json', model: report.model, levels: report.levels, candidates: report.candidates.map(({ name, parameters }) => ({ name, parameters })), aliasObservationsIdentical: identical, branchResults: branchResults.map(({ fixture, firstAction, solvable, graphExhausted, exploredStates }) => ({ fixture, firstAction, solvable, graphExhausted, exploredStates })) }, null, 2));
