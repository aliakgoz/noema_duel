import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

export interface ArenaEntry {
  id: string; name: string; solved: number; total: number; moves: number; submittedAt: string; modelHash: string;
}
interface StoredEntry extends ArenaEntry { playerId: string; challengeDay: string; ruleset?: string }
interface Session { playerId: string; name: string; tokenHash: string; createdAt: string }
interface DiskData { version: 1; secret: string; tokenSalt: string; sessions: Session[]; entries: StoredEntry[] }

const compare = (a: ArenaEntry, b: ArenaEntry) => b.solved - a.solved || a.moves - b.moves || a.submittedAt.localeCompare(b.submittedAt);
const publicEntry = ({ id, name, solved, total, moves, submittedAt, modelHash }: ArenaEntry): ArenaEntry => ({ id, name, solved, total, moves, submittedAt, modelHash });

export class ArenaStore {
  private data!: DiskData;
  private writes: Promise<void> = Promise.resolve();
  private constructor(private readonly directory: string) {}

  static async open(directory: string): Promise<ArenaStore> {
    const store = new ArenaStore(directory);
    await mkdir(directory, { recursive: true });
    try {
      const text = await readFile(join(directory, 'arena.json'), 'utf8');
      const data = JSON.parse(text) as DiskData;
      if (data.version !== 1 || !/^[a-f0-9]{64}$/.test(data.secret) || !/^[a-f0-9]{64}$/.test(data.tokenSalt)
        || !Array.isArray(data.sessions) || !Array.isArray(data.entries)) throw new Error('Invalid arena data.');
      store.data = data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Arena storage could not be loaded safely.');
      store.data = { version: 1, secret: randomBytes(32).toString('hex'), tokenSalt: randomBytes(32).toString('hex'), sessions: [], entries: [] };
      await store.persist();
    }
    return store;
  }

  get secret(): string { return this.data.secret; }

  private hashToken(token: string): string {
    return createHash('sha256').update(this.data.tokenSalt).update(':').update(token).digest('hex');
  }

  async createSession(name: string, now: Date): Promise<{ token: string; playerId: string; name: string }> {
    const token = randomBytes(32).toString('base64url');
    const playerId = randomUUID();
    const cutoff = now.getTime() - 30 * 24 * 60 * 60 * 1000;
    this.data.sessions = this.data.sessions.filter((session) => Date.parse(session.createdAt) > cutoff).slice(-4999);
    this.data.sessions.push({ playerId, name, tokenHash: this.hashToken(token), createdAt: now.toISOString() });
    await this.persist();
    return { token, playerId, name };
  }

  authenticate(token: string, now: Date): Session | undefined {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
    const hash = this.hashToken(token);
    return this.data.sessions.find((session) => session.tokenHash === hash
      && now.getTime() - Date.parse(session.createdAt) < 30 * 24 * 60 * 60 * 1000);
  }

  leaderboard(day: string, ruleset = 'legacy-v1'): ArenaEntry[] {
    return this.data.entries.filter((entry) => entry.challengeDay === day && (entry.ruleset ?? 'legacy-v1') === ruleset).sort(compare).slice(0, 100).map(publicEntry);
  }

  async saveEntry(entry: ArenaEntry, playerId: string, day: string, ruleset = 'legacy-v1'): Promise<void> {
    const existing = this.data.entries.find((candidate) => candidate.playerId === playerId && candidate.challengeDay === day && (candidate.ruleset ?? 'legacy-v1') === ruleset);
    if (existing && compare(existing, entry) <= 0) return;
    this.data.entries = this.data.entries.filter((candidate) => !(candidate.playerId === playerId && candidate.challengeDay === day && (candidate.ruleset ?? 'legacy-v1') === ruleset));
    this.data.entries.push({ ...entry, playerId, challengeDay: day, ruleset });
    // Bounded history; UTC-day boards never mix incomparable challenge sets.
    this.data.entries = this.data.entries.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)).slice(0, 10000);
    await this.persist();
  }

  private persist(): Promise<void> {
    const content = JSON.stringify(this.data);
    const write = this.writes.then(async () => {
      const temporary = join(this.directory, 'arena.json.tmp');
      await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, join(this.directory, 'arena.json'));
    });
    // Failed writes reject the calling request but do not permanently poison the queue.
    this.writes = write.catch(() => undefined);
    return write;
  }

  async close(): Promise<void> { await this.writes; }
}
