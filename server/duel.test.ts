import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { createServer } from './index';
import { createDuelModel } from '../src/duel/learning';
import { duelChallengeSeeds, DUEL_RULESET } from './duel-evaluate';
import { DuelEvaluationPool } from './duel-pool';
import type { DuelSubmission, DuelBoard } from '../src/duel/online';

const directories: string[] = [];
const servers: { listener: Server; close: () => Promise<void> }[] = [];
const now = () => new Date('2026-10-17T12:00:00Z');
async function start(directory?: string) {
  const storageDirectory = directory ?? await mkdtemp(join(tmpdir(), 'noema-duel-test-'));
  if (!directory) directories.push(storageDirectory);
  const server = await createServer({ storageDirectory, now, duelEvaluationTimeoutMs: 30000 });
  const listener = server.app.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const address = listener.address(); if (!address || typeof address === 'string') throw new Error('Missing port.');
  const instance = { listener, close: server.close }; servers.push(instance);
  return { ...instance, directory: storageDirectory, base: `http://127.0.0.1:${address.port}` };
}
async function stop(server: { listener: Server; close: () => Promise<void> }) {
  server.listener.closeAllConnections(); await new Promise<void>(resolve => server.listener.close(() => resolve())); await server.close();
  const index = servers.findIndex(item => item.listener === server.listener); if (index >= 0) servers.splice(index, 1);
}
afterEach(async () => {
  for (const server of [...servers]) await stop(server);
  for (const directory of directories.splice(0)) {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('noema-duel-test-')) throw new Error('Unexpected cleanup path.');
    await rm(directory, { recursive: true, force: true });
  }
});
function idleModel() {
  const model = createDuelModel(78);
  for (const tensor of [...model.weights, ...model.biases, ...Object.values(model.recurrent)]) tensor.fill(0);
  model.biases[2][4] = -32; model.biases[2][5] = -32; model.trainedSteps = 1;
  return model;
}
async function session(base: string) {
  return (await fetch(`${base}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Ada Duel' }) })).json() as Promise<{ token: string }>;
}
function post(base: string, token: string, body: unknown) {
  return fetch(`${base}/api/duel/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
}

describe('separate authoritative Duel arena', () => {
  it('separates Duel scores from the puzzle board and requires trained valid tensors and authenticated names', async () => {
    const { base } = await start();
    const board = await (await fetch(`${base}/api/duel/leaderboard`)).json() as DuelBoard;
    expect(board).toEqual({ entries: [], challengeDay: '2026-10-17', ruleset: DUEL_RULESET });
    expect((await post(base, '', { model: idleModel() })).status).toBe(401);
    const auth = await session(base);
    expect((await post(base, auth.token, { name: '<script>', model: idleModel() })).status).toBe(400);
    expect((await post(base, auth.token, { model: createDuelModel() })).status).toBe(400);
    const invalid = idleModel(); invalid.recurrent.weightsInput[0] = Infinity;
    expect((await post(base, auth.token, { model: invalid })).status).toBe(400);
  });
  it('runs the actual idle GRU in a worker, ignores fabricated scores, and persists the best daily result', async () => {
    const first = await start(), auth = await session(first.base), model = idleModel();
    const result = await post(first.base, auth.token, { name: 'Ada Duel', model, wins: 999, score: 999999, damage: 999999 });
    const body = await result.json() as DuelSubmission & { error?: string };
    expect(body.error, JSON.stringify(body)).toBeUndefined(); expect(result.status).toBe(200);
    expect(body.entry).toMatchObject({ wins: 0, total: 3, damage: 0 });
    expect(body.entry.draws + body.entry.losses).toBe(3);
    expect(body.entry.score).toBe(body.entry.draws * 3000 + body.entry.remainingHp);
    expect(body.entry.modelHash).toMatch(/^[a-f0-9]{64}$/); expect(body.entries).toHaveLength(1);
    expect(await (await fetch(`${first.base}/api/leaderboard`)).json()).toMatchObject({ entries: [] });
    const disk = await readFile(join(first.directory, 'duel.json'), 'utf8'); expect(disk).not.toContain(auth.token); expect(disk).not.toContain('solved');
    await stop(first);
    const second = await start(first.directory);
    const board = await (await fetch(`${second.base}/api/duel/leaderboard`)).json() as DuelBoard;
    expect(board.entries).toEqual(body.entries);
    const again = await (await post(second.base, auth.token, { name: 'Ada Duel', model })).json() as DuelSubmission;
    expect(again.entry.score).toBe(body.entry.score); expect(again.entries).toHaveLength(1); expect(again.entries[0].id).toBe(body.entry.id);
  }, 60000);
  it('uses identical secret-derived conditions per UTC day without disclosing seeds', () => {
    const first = duelChallengeSeeds('secret', '2026-10-17'); expect(first).toHaveLength(3);
    expect(first).toEqual(duelChallengeSeeds('secret', '2026-10-17'));
    expect(first).not.toEqual(duelChallengeSeeds('secret', '2026-10-18'));
    expect(first).not.toEqual(duelChallengeSeeds('other-secret', '2026-10-17'));
  });
  it('terminates evaluation at its hard timeout', async () => {
    const pool = new DuelEvaluationPool(1);
    try { await expect(pool.evaluate(idleModel(), [1, 2, 3])).rejects.toThrow('timed out'); }
    finally { await pool.close(); }
  });
});
