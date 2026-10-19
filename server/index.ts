import express, { type NextFunction, type Request, type Response } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TinyNetwork } from '../src/ml/network';
import { MODEL_VERSION } from '../src/core/types';
import { ARENA_PUZZLES, ARENA_RULESET, ARENA_STEP_BUDGET, challengeSeeds } from './evaluate';
import { ArenaBusyError, EvaluationPool } from './pool';
import { ArenaStore, type ArenaEntry } from './store';
import { createDuelRouter } from './duel';

export interface ServerOptions {
  storageDirectory?: string;
  allowedOrigins?: string[];
  now?: () => Date;
  evaluationTimeoutMs?: number;
  duelEvaluationTimeoutMs?: number;
}

function playerName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Bir oyuncu adı gerekli.');
  const name = value.normalize('NFC').trim();
  if ([...name].length < 1 || [...name].length > 24 || !/^[\p{L}\p{N} _.-]+$/u.test(name)) {
    throw new Error('Oyuncu adı 1–24 harf, sayı, boşluk, nokta, tire veya alt çizgi içerebilir.');
  }
  return name;
}

class RateLimits {
  private counters = new Map<string, { started: number; count: number }>();
  allow(key: string, limit: number, now: number): boolean {
    if (this.counters.size > 10000) for (const [entry, value] of this.counters) if (now - value.started >= 60000) this.counters.delete(entry);
    let counter = this.counters.get(key);
    if (!counter || now - counter.started >= 60000) {
      counter = { started: now, count: 0 }; this.counters.set(key, counter);
    }
    if (counter.count >= limit) return false;
    counter.count++;
    return true;
  }
}

export async function createServer(options: ServerOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  const store = await ArenaStore.open(options.storageDirectory ?? resolve(process.cwd(), 'serverdata'));
  const pool = new EvaluationPool(options.evaluationTimeoutMs ?? 10000);
  const now = options.now ?? (() => new Date());
  const limits = new RateLimits();
  const duel = await createDuelRouter({ storageDirectory: options.storageDirectory ?? resolve(process.cwd(), 'serverdata'), store, now, timeoutMs: options.duelEvaluationTimeoutMs });
  const origins = new Set(options.allowedOrigins ?? (process.env.ARENA_ALLOWED_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? [
    'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174', 'http://localhost:5175', 'http://127.0.0.1:5175', 'capacitor://localhost', 'http://localhost', 'https://localhost',
  ]));
  if (origins.has('*') || origins.has('null')) throw new Error('Arena CORS requires exact trusted origins.');
  const challengeDay = () => now().toISOString().slice(0, 10);

  app.use((request: Request, response: Response, next: NextFunction) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.vary('Origin');
    const origin = request.headers.origin;
    if (origin) {
      if (!origins.has(origin)) { response.status(403).json({ error: 'Bu kaynaktan arena bağlantısına izin verilmiyor.' }); return; }
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    if (request.method === 'OPTIONS') { response.status(204).end(); return; }
    next();
  });
  app.use(express.json({ limit: '2mb', strict: true }));
  app.use('/api/duel', duel.router);

  app.get('/api/health', (_request, response) => {
    response.json({ ok: true, version: MODEL_VERSION, ruleset: ARENA_RULESET, challengeDay: challengeDay(), puzzles: ARENA_PUZZLES, stepBudget: ARENA_STEP_BUDGET });
  });
  app.get('/api/leaderboard', (_request, response) => {
    const day = challengeDay();
    response.json({ entries: store.leaderboard(day, ARENA_RULESET), challengeDay: day, ruleset: ARENA_RULESET });
  });
  app.post('/api/session', async (request, response) => {
    const time = now();
    if (!limits.allow(`session:${request.ip ?? 'unknown'}`, 6, time.getTime())) {
      response.setHeader('Retry-After', '60'); response.status(429).json({ error: 'Çok sık oturum açıldı. Bir dakika sonra yeniden dene.' }); return;
    }
    let name: string;
    try { name = playerName(request.body?.name); } catch (error) {
      response.status(400).json({ error: (error as Error).message }); return;
    }
    response.status(201).json(await store.createSession(name, time));
  });
  app.post('/api/submit', async (request, response) => {
    const time = now();
    const header = request.headers.authorization;
    const session = header?.startsWith('Bearer ') ? store.authenticate(header.slice(7), time) : undefined;
    if (!session) { response.status(401).json({ error: 'Geçerli bir arena oturumu gerekli.' }); return; }
    if (!limits.allow(`submit-player:${session.playerId}`, 3, time.getTime())
      || !limits.allow(`submit-ip:${request.ip ?? 'unknown'}`, 6, time.getTime())) {
      response.setHeader('Retry-After', '60'); response.status(429).json({ error: 'Gönderim sınırına ulaşıldı. Bir dakika sonra yeniden dene.' }); return;
    }
    let name: string; let network: TinyNetwork;
    try {
      name = playerName(request.body?.name ?? session.name);
      // Only strictly bounded numerical weights are imported. Client scores are never read.
      network = TinyNetwork.deserialize(request.body?.model);
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : 'Model dosyası geçersiz.' }); return;
    }
    const day = time.toISOString().slice(0, 10);
    try {
      const canonical = network.snapshot();
      const result = await pool.evaluate(canonical, challengeSeeds(store.secret, day));
      const entry: ArenaEntry = {
        id: randomUUID(), name, ...result, submittedAt: now().toISOString(),
        modelHash: createHash('sha256').update(JSON.stringify(canonical)).digest('hex'),
      };
      await store.saveEntry(entry, session.playerId, day, ARENA_RULESET);
      response.json({ entry, entries: store.leaderboard(day, ARENA_RULESET), challengeDay: day, ruleset: ARENA_RULESET });
    } catch (error) {
      if (error instanceof ArenaBusyError) {
        response.setHeader('Retry-After', '5'); response.status(503).json({ error: 'Arena dolu. Birkaç saniye sonra yeniden dene.' });
      } else {
        console.error('Arena evaluation failed:', error instanceof Error ? error.message : 'Unknown error');
        response.status(503).json({ error: 'Model güvenli süre içinde değerlendirilemedi. Yeniden deneyebilirsin.' });
      }
    }
  });
  app.use((_request, response) => { response.status(404).json({ error: 'Arena endpoint bulunamadı.' }); });
  app.use((error: Error & { type?: string }, _request: Request, response: Response, _next: NextFunction) => {
    if (error.type === 'entity.too.large') { response.status(413).json({ error: 'İstek 500 KB sınırını aşıyor.' }); return; }
    if (error instanceof SyntaxError) { response.status(400).json({ error: 'Geçerli bir JSON isteği gerekli.' }); return; }
    console.error('Arena request failed:', error.message);
    response.status(500).json({ error: 'Arena isteği kaydedilemedi.' });
  });

  return { app, close: async () => { await duel.close(); await pool.close(); await store.close(); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.ARENA_PORT ?? 8787);
  const host = process.env.ARENA_HOST ?? '127.0.0.1';
  const arena = await createServer();
  const listener = arena.app.listen(port, host, () => console.log(`Noema arena listening at http://${host}:${port}`));
  const shutdown = () => { listener.close(() => { void arena.close().then(() => process.exit(0)); }); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
