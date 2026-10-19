import { parentPort, workerData } from 'node:worker_threads';
import { evaluateModel } from './evaluate';
import type { NetworkSnapshot } from '../src/ml/network';

const data = workerData as { snapshot: NetworkSnapshot; seeds: number[] };
try {
  parentPort?.postMessage({ ok: true, result: evaluateModel(data.snapshot, data.seeds) });
} catch (error) {
  parentPort?.postMessage({ ok: false, message: error instanceof Error ? error.message : 'Evaluation failed.' });
}
