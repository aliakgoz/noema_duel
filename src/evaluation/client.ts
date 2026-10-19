import type { Level } from '../core/types';
import type { NetworkSnapshot } from '../ml/network';
import type { TransferReport } from './transfer';

export function evaluateTransferInWorker(snapshot: NetworkSnapshot, level: Level, seed: number, signal?: AbortSignal): Promise<TransferReport> {
  if (signal?.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./transfer.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => { worker.terminate(); signal?.removeEventListener('abort', cancel); clearTimeout(timer); };
    const cancel = () => { cleanup(); reject(new DOMException('Cancelled', 'AbortError')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Deneme süresi doldu.')); }, 30_000);
    signal?.addEventListener('abort', cancel, { once: true });
    worker.onerror = event => { cleanup(); reject(new Error(event.message || 'Deneme tamamlanamadı.')); };
    worker.onmessage = (event: MessageEvent<{ report?: TransferReport; error?: string }>) => {
      cleanup();
      if (event.data.report) resolve(event.data.report);
      else reject(new Error(event.data.error || 'Deneme tamamlanamadı.'));
    };
    try { worker.postMessage({ snapshot, level, seed }); } catch (error) { cleanup(); reject(error); }
  });
}
