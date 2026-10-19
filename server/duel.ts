import { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { isDuelModel, MODEL_VERSION } from '../src/duel/learning';
import { DUEL_RULESET, DUEL_ROUNDS, DUEL_ROUND_SECONDS, duelChallengeSeeds } from './duel-evaluate';
import { DuelStore } from './duel-store';
import { DuelEvaluationPool } from './duel-pool';
import { ArenaBusyError } from './pool';
import type { ArenaStore } from './store';
import type { DuelArenaEntry } from '../src/duel/online';

export async function createDuelRouter(options: { storageDirectory: string; store: ArenaStore; now: () => Date; timeoutMs?: number }) {
  const router = Router(), storage = await DuelStore.open(options.storageDirectory), pool = new DuelEvaluationPool(options.timeoutMs ?? 30000);
  const counters = new Map<string, { time: number; count: number }>();
  const allow = (key: string, now: number, max: number) => {
    if (counters.size > 10000) for (const [k, v] of counters) if (now - v.time >= 60000) counters.delete(k);
    const old = counters.get(key), value = old && now - old.time < 60000 ? old : { time: now, count: 0 };
    counters.set(key, value); return ++value.count <= max;
  };
  router.get('/health', (_request, response) => response.json({ ok: true, version: MODEL_VERSION, ruleset: DUEL_RULESET, rounds: DUEL_ROUNDS, roundSeconds: DUEL_ROUND_SECONDS }));
  router.get('/leaderboard', (_request, response) => {
    const day = options.now().toISOString().slice(0, 10);
    response.json({ entries: storage.leaderboard(day, DUEL_RULESET), challengeDay: day, ruleset: DUEL_RULESET });
  });
  router.post('/submit', async (request, response) => {
    const now = options.now(), header = request.headers.authorization;
    const session = header?.startsWith('Bearer ') ? options.store.authenticate(header.slice(7), now) : undefined;
    if (!session) { response.status(401).json({ error: 'Geçerli bir arena oturumu gerekli.' }); return; }
    if (!allow(`player:${session.playerId}`, now.getTime(), 3) || !allow(`ip:${request.ip}`, now.getTime(), 6)) {
      response.setHeader('Retry-After', '60'); response.status(429).json({ error: 'Gönderim sınırına ulaşıldı. Bir dakika sonra yeniden dene.' }); return;
    }
    const rawName = request.body?.name ?? session.name;
    const name = typeof rawName === 'string' ? rawName.normalize('NFC').trim() : '';
    if ([...name].length < 1 || [...name].length > 24 || !/^[\p{L}\p{N} _.-]+$/u.test(name)) { response.status(400).json({ error: 'Oyuncu adı 1–24 harf, sayı, boşluk, nokta veya tire içerebilir.' }); return; }
    const model = request.body?.model;
    if (!isDuelModel(model) || model.trainedSteps < 1) { response.status(400).json({ error: 'Önce atölyede Duel robotunu eğit. Uyumlu bir GRU modeli gerekli.' }); return; }
    const day = now.toISOString().slice(0, 10);
    try {
      const result = await pool.evaluate(model, duelChallengeSeeds(options.store.secret, day));
      const entry: DuelArenaEntry = { ...result, id: randomUUID(), name, submittedAt: options.now().toISOString(), modelHash: createHash('sha256').update(JSON.stringify(model)).digest('hex') };
      await storage.save(entry, session.playerId, day, DUEL_RULESET);
      response.json({ entry, entries: storage.leaderboard(day, DUEL_RULESET), challengeDay: day, ruleset: DUEL_RULESET });
    } catch (error) {
      response.status(503).json({ error: error instanceof ArenaBusyError ? 'Arena şu an dolu. Birkaç saniye sonra yeniden dene.' : 'Model süre sınırı içinde değerlendirilemedi. Yeniden deneyebilirsin.' });
    }
  });
  return { router, close: async () => { await pool.close(); await storage.close(); } };
}
