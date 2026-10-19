import { trainSync } from './learning';
import type { DuelModel, DuelSample } from './learning';

interface TrainMessage { type: 'train'; samples: DuelSample[]; model?: DuelModel; epochs?: number }
const scope = self as unknown as { onmessage: ((event: MessageEvent<TrainMessage>) => void) | null; postMessage: (message: unknown) => void };
scope.onmessage = event => {
  if (event.data.type !== 'train') return;
  try {
    const { samples, model, epochs } = event.data;
    const result = trainSync(samples, model, { epochs, onProgress: progress => scope.postMessage({ type: 'progress', progress }) });
    scope.postMessage({ type: 'complete', ...result });
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Eğitim tamamlanamadı.' });
  }
};
