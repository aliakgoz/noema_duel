import {
  TinyNetwork, type NetworkSnapshot, type TrainingMetrics, type TrainingProgress, type TrainingSample,
} from './network';

export interface WorkerTrainingOptions {
  epochs: number; batchSize: number;
  onProgress?: (progress: TrainingProgress) => void;
  signal?: AbortSignal;
}

/**
 * Train a private copy. Cancellation leaves the original model unchanged.
 * Keep episodeId/sequenceStart on every record: the worker performs recurrent
 * backpropagation in temporal order, rather than shuffling individual decisions.
 */
export async function trainInWorker(
  network: TinyNetwork, samples: TrainingSample[], options: WorkerTrainingOptions,
): Promise<{ network: TinyNetwork; metrics: TrainingMetrics }> {
  if (options.signal?.aborted) throw new DOMException('Training cancelled.', 'AbortError');
  if (typeof Worker === 'undefined') {
    const copy = TinyNetwork.fromSnapshot(network.snapshot());
    const metrics = await copy.train(samples, options.epochs, options.batchSize, options.onProgress, options.signal);
    return { network: copy, metrics };
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./training.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => {
      worker.terminate();
      options.signal?.removeEventListener('abort', cancel);
    };
    const cancel = () => { cleanup(); reject(new DOMException('Training cancelled.', 'AbortError')); };
    options.signal?.addEventListener('abort', cancel, { once: true });
    worker.onerror = (event) => { cleanup(); reject(new Error(event.message || 'Training worker failed.')); };
    worker.onmessage = (event: MessageEvent<{
      type: string; progress?: TrainingProgress; snapshot?: NetworkSnapshot; metrics?: TrainingMetrics; message?: string;
    }>) => {
      const message = event.data;
      if (message.type === 'progress' && message.progress) {
        try { options.onProgress?.(message.progress); } catch (error) { cleanup(); reject(error); }
      } else if (message.type === 'complete' && message.snapshot && message.metrics) {
        cleanup();
        try { resolve({ network: TinyNetwork.fromSnapshot(message.snapshot), metrics: message.metrics }); } catch (error) { reject(error); }
      } else if (message.type === 'error') {
        cleanup(); reject(new Error(message.message || 'Training failed.'));
      }
    };
    try {
      worker.postMessage({ type: 'train', snapshot: network.snapshot(), samples, epochs: options.epochs, batchSize: options.batchSize });
    } catch (error) { cleanup(); reject(error); }
  });
}
