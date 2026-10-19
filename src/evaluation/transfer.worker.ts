import { evaluateTransfer } from './transfer';
import type { NetworkSnapshot } from '../ml/network';
import type { Level } from '../core/types';

const scope = self as unknown as { onmessage: ((event: MessageEvent<{ snapshot: NetworkSnapshot; level: Level; seed: number }>) => void) | null; postMessage: (message: unknown) => void };
scope.onmessage = event => {
  try { scope.postMessage({ report: evaluateTransfer(event.data.snapshot, event.data.level, event.data.seed) }); }
  catch (error) { scope.postMessage({ error: error instanceof Error ? error.message : 'Deneme tamamlanamadı.' }); }
};
