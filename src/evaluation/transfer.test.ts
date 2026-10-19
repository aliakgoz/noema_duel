import { describe, expect, it } from 'vitest';
import { LEVELS } from '../core/levels';
import { TinyNetwork } from '../ml/network';
import { evaluateTransfer, TRANSFER_BUDGET } from './transfer';

describe('fixed-policy transfer evaluation', () => {
  it('reports actual failures without learning, injecting actions or modifying the submitted model', () => {
    const network = new TinyNetwork(42);
    for (const layer of network.layers) { layer.weights.fill(0); layer.biases.fill(0); }
    network.layers[2].biases[5] = 10; // Always wait: a fair test must fail every room.
    const snapshot = network.snapshot(); const original = JSON.stringify(snapshot);
    const report = evaluateTransfer(snapshot, LEVELS[0], 4); // Earlier seeds duplicated physical starts here.
    expect(report.cases.map(trial => trial.kind)).toEqual(['same', 'start', 'start', 'start', 'layout', 'layout', 'layout']);
    expect(report.cases.every(trial => !trial.solved && trial.decisions === TRANSFER_BUDGET)).toBe(true);
    expect(report.cases.filter(trial => trial.kind === 'start').every(trial => trial.start.x !== LEVELS[0].start.x || trial.start.z !== LEVELS[0].start.z)).toBe(true);
    expect(report.cases.filter(trial => trial.kind === 'layout').every(trial => trial.changes.length >= 1)).toBe(true);
    expect(JSON.stringify(snapshot)).toBe(original);
    const starts = report.cases.filter(trial => trial.kind === 'start').map(trial => `${trial.start.x},${trial.start.z}`);
    expect(new Set(starts).size).toBe(3);
    const layouts = report.cases.filter(trial => trial.kind === 'layout').map(trial => trial.changes.join('|'));
    expect(new Set(layouts).size).toBe(3);
    expect(evaluateTransfer(snapshot, LEVELS[0], 4)).toEqual(report);
  });
});
