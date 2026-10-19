import { Worker } from 'node:worker_threads';
import type { DuelModel } from '../src/duel/learning';
import type { DuelEvaluation } from '../src/duel/online';
import { ArenaBusyError } from './pool';

interface Job { model: DuelModel; seeds: number[]; resolve: (value: DuelEvaluation) => void; reject: (error: Error) => void }
/** One bounded worker plus two queued models; server HTTP stays responsive. */
export class DuelEvaluationPool {
  private active?: Worker;
  private queue: Job[] = [];
  private closed = false;
  constructor(private readonly timeoutMs = 30000) {}
  evaluate(model: DuelModel, seeds: number[]): Promise<DuelEvaluation> {
    if (this.closed || this.active && this.queue.length >= 2) return Promise.reject(new ArenaBusyError('Duel arena is busy.'));
    return new Promise((resolve, reject) => {
      const job = { model, seeds, resolve, reject };
      if (this.active) this.queue.push(job); else this.start(job);
    });
  }
  private start(job: Job) {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./duel.worker.ts', import.meta.url), {
        workerData: { model: job.model, seeds: job.seeds }, execArgv: ['--import', 'tsx'],
        resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
      });
    } catch (error) { job.reject(error instanceof Error ? error : new Error('Worker unavailable.')); this.drain(); return; }
    this.active = worker;
    let done = false;
    const finish = async (error?: Error, result?: DuelEvaluation) => {
      if (done) return; done = true; clearTimeout(timer); await worker.terminate(); this.active = undefined;
      if (error) job.reject(error); else if (result) job.resolve(result); else job.reject(new Error('Missing evaluation.'));
      this.drain();
    };
    const timer = setTimeout(() => { void finish(new Error('Duel evaluation timed out.')); }, this.timeoutMs);
    worker.once('message', (message: { ok?: boolean; result?: DuelEvaluation; message?: string }) => {
      const r = message.result;
      if (!message.ok || !r || ![r.wins, r.draws, r.losses, r.damage, r.remainingHp, r.score].every(Number.isInteger)
        || r.total !== 3 || r.wins < 0 || r.draws < 0 || r.losses < 0 || r.wins + r.draws + r.losses !== 3
        || r.damage < 0 || r.damage > 720 || r.remainingHp < 0 || r.remainingHp > 720
        || r.score !== r.wins * 10000 + r.draws * 3000 + r.damage + r.remainingHp) { void finish(new Error(message.message || 'Invalid Duel evaluation.')); return; }
      void finish(undefined, r);
    });
    worker.once('error', error => { void finish(error); });
    worker.once('exit', code => { if (!done) void finish(new Error(`Duel worker exited (${code}).`)); });
  }
  private drain() { const next = !this.closed && this.queue.shift(); if (next) this.start(next); }
  async close() {
    this.closed = true;
    for (const job of this.queue.splice(0)) job.reject(new ArenaBusyError('Duel arena shutting down.'));
    await this.active?.terminate();
  }
}
