import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { DuelArenaEntry } from '../src/duel/online';

interface StoredEntry extends DuelArenaEntry { playerId: string; day: string; ruleset: string }
export class DuelStore {
  private entries: StoredEntry[] = [];
  private writes: Promise<void> = Promise.resolve();
  private constructor(private readonly directory: string) {}
  static async open(directory: string) {
    const store = new DuelStore(directory); await mkdir(directory, { recursive: true });
    try {
      const data = JSON.parse(await readFile(join(directory, 'duel.json'), 'utf8')) as { version: number; entries: StoredEntry[] };
      if (data.version !== 1 || !Array.isArray(data.entries)) throw new Error('Invalid Duel storage.');
      store.entries = data.entries;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return store;
  }
  leaderboard(day: string, ruleset: string): DuelArenaEntry[] {
    return this.entries.filter(e => e.day === day && e.ruleset === ruleset).sort((a, b) => b.score - a.score || a.submittedAt.localeCompare(b.submittedAt)).slice(0, 100)
      .map(({ playerId: _playerId, day: _day, ruleset: _ruleset, ...entry }) => entry);
  }
  async save(entry: DuelArenaEntry, playerId: string, day: string, ruleset: string) {
    const existing = this.entries.find(e => e.playerId === playerId && e.day === day && e.ruleset === ruleset);
    if (existing && existing.score >= entry.score) return;
    this.entries = this.entries.filter(e => !(e.playerId === playerId && e.day === day && e.ruleset === ruleset));
    this.entries.push({ ...entry, playerId, day, ruleset });
    this.entries = this.entries.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)).slice(0, 10000);
    const content = JSON.stringify({ version: 1, entries: this.entries });
    const write = this.writes.then(async () => {
      await writeFile(join(this.directory, 'duel.json.tmp'), content, { encoding: 'utf8', mode: 0o600 });
      await rename(join(this.directory, 'duel.json.tmp'), join(this.directory, 'duel.json'));
    });
    this.writes = write.catch(() => undefined); await write;
  }
  async close() { await this.writes; }
}
