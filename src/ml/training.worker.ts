import { TinyNetwork, type NetworkSnapshot, type TrainingSample } from './network';

interface TrainMessage {
  type: 'train'; snapshot: NetworkSnapshot; samples: TrainingSample[]; epochs: number; batchSize: number;
}

// A dedicated worker keeps backpropagation and metric evaluation off the render thread.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<TrainMessage>) => void) | null;
  postMessage: (message: unknown) => void;
};

scope.onmessage = async (event) => {
  if (event.data.type !== 'train') return;
  try {
    const { snapshot, samples, epochs, batchSize } = event.data;
    const network = TinyNetwork.fromSnapshot(snapshot);
    const metrics = await network.train(samples, epochs, batchSize, (progress) => {
      scope.postMessage({ type: 'progress', progress });
    }, undefined, false);
    scope.postMessage({ type: 'complete', snapshot: network.snapshot(), metrics });
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Training failed.' });
  }
};
