import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Server } from 'node:http';
import { once } from 'node:events';
import { TinyNetwork } from '../src/ml/network';
import { createServer } from './index';
import { challengeSeeds } from './evaluate';
import { ArenaStore } from './store';

const fixedNow = () => new Date('2026-10-16T12:00:00.000Z');
const instances: { listener: Server; close: () => Promise<void> }[] = [];
const directories: string[] = [];

async function start(directory?: string) {
  const storageDirectory = directory ?? await mkdtemp(join(tmpdir(), 'noema-arena-test-'));
  if (!directory) directories.push(storageDirectory);
  const arena = await createServer({ storageDirectory, now: fixedNow, evaluationTimeoutMs: 15000 });
  const listener = arena.app.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  instances.push({ listener, close: arena.close });
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server port.');
  return { base: `http://127.0.0.1:${address.port}`, storageDirectory, listener, close: arena.close };
}
async function stop(instance: { listener: Server; close: () => Promise<void> }) {
  instance.listener.closeAllConnections();
  await new Promise<void>((resolveClose) => instance.listener.close(() => resolveClose()));
  await instance.close();
  const index = instances.findIndex((candidate) => candidate.listener === instance.listener);
  if (index >= 0) instances.splice(index, 1);
}
afterEach(async () => {
  for (const instance of [...instances]) await stop(instance);
  for (const directory of directories.splice(0)) {
    // Verify every recursive cleanup is within the intended OS temp directory.
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('noema-arena-test-')) throw new Error('Unexpected test cleanup path.');
    await rm(directory, { recursive: true, force: true });
  }
});

describe('authoritative arena', () => {
  it('keeps earlier rule versions out of the updated daily board without deleting previous results', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'noema-arena-test-')); directories.push(directory);
    const store = await ArenaStore.open(directory);
    const entry = { id: 'legacy', name: 'Ada', solved: 8, total: 8, moves: 12, submittedAt: fixedNow().toISOString(), modelHash: 'a'.repeat(64) };
    await store.saveEntry(entry, 'same-player', '2026-10-16');
    await store.saveEntry({ ...entry, id: 'updated', solved: 1, moves: 1000 }, 'same-player', '2026-10-16', 'noema-arena-v2-160');
    await store.close();
    const restored = await ArenaStore.open(directory);
    expect(restored.leaderboard('2026-10-16').map(result => result.id)).toEqual(['legacy']);
    expect(restored.leaderboard('2026-10-16', 'noema-arena-v2-160').map(result => result.id)).toEqual(['updated']);
    await restored.close();
  });
  it('requires authentication and strictly validates uploaded weights and names', async () => {
    const { base } = await start();
    const unauthorized = await fetch(`${base}/api/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(unauthorized.status).toBe(401);
    const htmlName = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '<script>x</script>' }) });
    expect(htmlName.status).toBe(400);
    const sessionResponse = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Deniz' }) });
    const session = await sessionResponse.json() as { token: string };
    expect(sessionResponse.status).toBe(201);
    const response = await fetch(`${base}/api/submit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ name: 'Deniz', model: { ...new TinyNetwork().snapshot(), weights: [[1], [], []] } }),
    });
    expect(response.status).toBe(400);
    const wrongOrigin = await fetch(`${base}/api/health`, { headers: { Origin: 'https://untrusted.example' } });
    expect(wrongOrigin.status).toBe(403);
    const trusted = await fetch(`${base}/api/health`, { headers: { Origin: 'capacitor://localhost' } });
    expect(trusted.headers.get('access-control-allow-origin')).toBe('capacitor://localhost');
    expect(trusted.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('executes the actual model in a worker, ignores fake scores, and persists tokens and board across restart', async () => {
    const first = await start();
    const sessionResponse = await fetch(`${first.base}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Ada' }) });
    const session = await sessionResponse.json() as { token: string; playerId: string };
    const network = new TinyNetwork(77);
    for (const layer of network.layers) { layer.weights.fill(0); layer.biases.fill(0); }
    network.layers[2].biases[5] = 4; // A real legal model that always waits.
    const response = await fetch(`${first.base}/api/submit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ name: 'Ada', model: network.snapshot(), solved: 999, score: 999999, moves: 0 }),
    });
    const body = await response.json() as { entry: { solved: number; total: number; moves: number; modelHash: string }; entries: unknown[]; error?: string };
    expect(body.error, JSON.stringify(body)).toBeUndefined();
    expect(response.status).toBe(200);
    expect(body.entry).toMatchObject({ solved: 0, total: 8, moves: 1280 });
    expect(body.entry.modelHash).toMatch(/^[a-f0-9]{64}$/);
    expect(body.entries).toHaveLength(1);
    const disk = await readFile(join(first.storageDirectory, 'arena.json'), 'utf8');
    expect(disk).not.toContain(session.token);
    expect(disk).toContain('tokenHash');
    await stop(first);
    const second = await start(first.storageDirectory);
    const board = await (await fetch(`${second.base}/api/leaderboard`)).json() as { entries: unknown[] };
    expect(board.entries).toHaveLength(1);
    const next = await fetch(`${second.base}/api/submit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ name: 'Ada', model: network.snapshot() }),
    });
    expect(next.status).toBe(200);
    const repeated = await next.json() as { entry: { modelHash: string; solved: number; moves: number }; entries: unknown[] };
    expect(repeated.entry.modelHash).toBe(body.entry.modelHash);
    expect(repeated.entry.solved).toBe(body.entry.solved);
    expect(repeated.entry.moves).toBe(body.entry.moves);
    expect(repeated.entries).toHaveLength(1);
  }, 30000);

  it('uses one secret-seeded daily challenge set shared by all players', () => {
    expect(challengeSeeds('server-secret', '2026-10-16')).toEqual(challengeSeeds('server-secret', '2026-10-16'));
    expect(challengeSeeds('server-secret', '2026-10-16')).not.toEqual(challengeSeeds('server-secret', '2026-10-17'));
    expect(challengeSeeds('server-secret', '2026-10-16')).not.toEqual(challengeSeeds('another-secret', '2026-10-16'));
  });
});
