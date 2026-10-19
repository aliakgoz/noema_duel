import { Worker } from 'node:worker_threads';
import type { NetworkSnapshot } from '../src/ml/network';
import type { ArenaEvaluation } from './evaluate';

export class ArenaBusyError extends Error {}
interface Job {
  snapshot: NetworkSnapshot; seeds: number[];
  resolve: (result: ArenaEvaluation) => void; reject: (error: Error) => void;
}

/** Bounded per-request workers. Only the application-owned evaluator is executable. */
export class EvaluationPool {
  private active = 0;
  private queue: Job[] = [];
  private workers = new Set<Worker>();
  private closed = false;
  constructor(private readonly timeoutMs = 10000, private readonly concurrency = 2, private readonly queueLimit = 4) {
    if (concurrency < 1 || concurrency > 2 || queueLimit < 0 || queueLimit > 8) throw new Error('Invalid worker pool limits.');
  }

  get pending(): number { return this.active + this.queue.length; }

  evaluate(snapshot: NetworkSnapshot, seeds: number[]): Promise<ArenaEvaluation> {
    if (this.closed || (this.active >= this.concurrency && this.queue.length >= this.queueLimit)) {
      return Promise.reject(new ArenaBusyError('Arena is busy. Please retry shortly.'));
    }
    return new Promise((resolve, reject) => {
      const job = { snapshot, seeds, resolve, reject };
      if (this.active < this.concurrency) this.start(job); else this.queue.push(job);
    });
  }

  private start(job: Job): void {
    this.active++;
    let worker: Worker;
    try {
      worker = new Worker(new URL('./evaluation.worker.ts', import.meta.url), {
        workerData: { snapshot: job.snapshot, seeds: job.seeds },
        execArgv: ['--import', 'tsx'],
        resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
      });
    } catch (error) {
      this.active--; job.reject(error instanceof Error ? error : new Error('Unable to start evaluator.')); this.drain(); return;
    }
    this.workers.add(worker);
    let settled = false;
    const finish = async (error?: Error, result?: ArenaEvaluation) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      // Free the slot only after termination: even worker teardown respects the cap.
      await worker.terminate();
      this.workers.delete(worker); this.active--;
      if (error) job.reject(error); else if (result) job.resolve(result); else job.reject(new Error('Evaluation produced no result.'));
      this.drain();
    };
    const timer = setTimeout(() => finish(new Error('Evaluation time limit exceeded.')), this.timeoutMs);
    worker.once('message', (message: { ok: boolean; result?: ArenaEvaluation; message?: string }) => {
      if (!message.ok || !message.result) return finish(new Error(message.message || 'Evaluation failed.'));
      const result = message.result;
      if (!Number.isInteger(result.solved) || result.solved < 0 || result.solved > 8 || result.total !== 8
        || !Number.isInteger(result.moves) || result.moves < 0 || result.moves > 1280) return finish(new Error('Invalid evaluator result.'));
      finish(undefined, result);
    });
    worker.once('error', (error) => finish(error));
    worker.once('exit', (code) => {
      if (!settled) finish(new Error(`Evaluation worker exited before returning a result (${code}).`));
    });
  }

  private drain(): void {
    if (this.closed) return;
    const next = this.queue.shift();
    if (next) this.start(next);
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const job of this.queue.splice(0)) job.reject(new ArenaBusyError('Arena is shutting down.'));
    await Promise.all([...this.workers].map((worker) => worker.terminate()));
  }
}
