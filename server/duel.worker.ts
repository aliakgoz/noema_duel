import { parentPort, workerData } from 'node:worker_threads';
import { evaluateDuelModel } from './duel-evaluate';
try { parentPort?.postMessage({ ok: true, result: evaluateDuelModel(workerData.model, workerData.seeds) }); }
catch (error) { parentPort?.postMessage({ ok: false, message: error instanceof Error ? error.message : 'Evaluation failed.' }); }
