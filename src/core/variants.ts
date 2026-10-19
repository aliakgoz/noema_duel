import { createState, step } from './engine';
import { LEVEL_SOLUTIONS, transformAction, transformLevel } from './levels';
import { solveLevel } from './solver';
import { DELTAS, type Action, type Level, type Position } from './types';

type VariantKind = 'start' | 'layout';
const variants = new Map<string, Level>();
const witnesses = new Map<string, Action[]>();
const same = (a: Position, b: Position) => a.x === b.x && a.z === b.z;

function fingerprint(level: Level): string {
  const value = JSON.stringify([level.id, level.tiles, level.start, level.facing, level.crates, level.switches, level.doors, level.goals, level.surfaces, level.sequences]);
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}

function randomFor(seed: number): () => number {
  let value = seed >>> 0;
  return () => { value = (value + 0x6d2b79f5) >>> 0; let mixed = Math.imul(value ^ (value >>> 15), value | 1); mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61); return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296; };
}
function shuffled<T>(values: T[], random: () => number): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
const verifies = (level: Level, actions: readonly Action[]) => actions.reduce(step, createState(level)).solved;

/** Certificates validate generated rooms, and never select a model's actions. */
function witnessFor(base: Level, key: string): Action[] {
  const cached = witnesses.get(key); if (cached) return cached;
  const recorded = LEVEL_SOLUTIONS[base.sourceLevelId ?? base.id];
  if (recorded) {
    for (const reflected of [false, true]) for (let rotations = 0; rotations < 4; rotations++) {
      const actions = recorded.map(action => transformAction(action, rotations, reflected));
      if (verifies(base, actions)) { witnesses.set(key, actions); return actions; }
    }
  }
  const found = solveLevel(base, { maxStates: 12_000, maxActions: 512 });
  if (!found || !verifies(base, found)) throw new Error('Bu oda için doğrulanmış bir çözüm bulunamadı; yakın deneme oluşturulmadı.');
  witnesses.set(key, found); return found;
}

/**
 * A nearby held-out room, with an actual difference and a replayed solvability
 * certificate. No rotation is used here. A start shift is at most three safe
 * walking tiles; a layout shift changes exactly one interior wall.
 */
export function createTransferVariant(base: Level, seed: number, kind: VariantKind = 'start'): Level {
  if (!Number.isSafeInteger(seed)) throw new RangeError('A variant seed must be a safe integer');
  if (kind !== 'start' && kind !== 'layout') throw new RangeError('Unknown transfer variant kind');
  const baseKey = fingerprint(base); const cacheKey = `${baseKey}:${seed}:${kind}`;
  const existing = variants.get(cacheKey); if (existing) return transformLevel(existing);
  const random = randomFor(seed); const witness = witnessFor(base, baseKey);
  const occupied = (position: Position) => [base.start, ...base.crates, ...base.switches, ...base.doors, ...base.goals, ...(base.surfaces ?? [])].some(entity => same(entity, position));
  const finish = (candidate: Level, changes: string[]): Level => {
    const value = {
      ...candidate, id: `${base.sourceLevelId ?? base.id}-transfer-${kind}-${seed}-${baseKey}`,
      sourceLevelId: base.sourceLevelId ?? base.id, variantKind: kind,
      variantChanges: changes, seed, surprise: kind === 'start' ? 'YAKIN BAŞLANGIÇ' : 'YAKIN HARİTA',
      title: base.title, subtitle: kind === 'start' ? 'Aynı problem, yakın bir başlangıç' : 'Aynı problem, bir engel farklı',
      description: `Öğrendiğin yaklaşımı küçük bir değişiklikte dene. ${changes.join(' ')}`,
    } satisfies Level;
    variants.set(cacheKey, value);
    if (variants.size > 256) variants.delete(variants.keys().next().value!);
    return transformLevel(value);
  };

  if (kind === 'start') {
    const reachable: { position: Position; path: Action[] }[] = [{ position: base.start, path: [] }];
    const seen = new Set([`${base.start.x},${base.start.z}`]);
    for (let cursor = 0; cursor < reachable.length; cursor++) {
      const current = reachable[cursor]; if (current.path.length >= 3) continue;
      for (let action = 0; action < 4; action++) {
        const delta = DELTAS[action]; const position = { x: current.position.x + delta.x, z: current.position.z + delta.z }; const key = `${position.x},${position.z}`;
        if (seen.has(key) || base.tiles[position.z]?.[position.x] !== '.' || occupied(position)) continue;
        seen.add(key); reachable.push({ position, path: [...current.path, action as Action] });
      }
    }
    for (const option of shuffled(reachable.slice(1), random)) {
      const candidate = { ...transformLevel(base), start: { ...option.position } };
      const returnPath = [...option.path].reverse().map(action => ((action + 2) % 4) as Action);
      if (verifies(candidate, [...returnPath, ...witness])) {
        return finish(candidate, [`Başlangıç ${option.path.length} kare kaydı (${base.start.x},${base.start.z} → ${option.position.x},${option.position.z}); hedefler ve nesneler aynı.`]);
      }
    }
    throw new Error('Üç kare içinde güvenli ve çözülebilir başka bir başlangıç bulunamadı.');
  }

  const positions: Position[] = [];
  for (let z = 1; z < base.height - 1; z++) for (let x = 1; x < base.width - 1; x++) {
    const position = { x, z };
    if (occupied(position) || Math.abs(x - base.start.x) + Math.abs(z - base.start.z) < 2) continue;
    if (base.surfaces?.some(surface => Math.abs(surface.x - x) + Math.abs(surface.z - z) <= 1)) continue;
    const neighbors = DELTAS.filter(delta => base.tiles[z + delta.z]?.[x + delta.x] === '.').length;
    if ((base.tiles[z][x] === '#' && neighbors >= 2) || (base.tiles[z][x] === '.' && neighbors >= 3)) positions.push(position);
  }
  const candidates = shuffled(positions, random);
  for (const position of candidates) {
    const candidate = transformLevel(base); const row = [...candidate.tiles[position.z]]; const removed = row[position.x] === '#';
    row[position.x] = removed ? '.' : '#'; candidate.tiles[position.z] = row.join('');
    if (verifies(candidate, witness)) return finish(candidate, [`(${position.x},${position.z}) karesindeki bir engel ${removed ? 'kaldırıldı' : 'eklendi'}; başlangıç, hedefler ve nesneler aynı.`]);
  }
  // Limited explicit validation fallback for very narrow custom rooms.
  for (const position of candidates.slice(0, 3)) {
    const candidate = transformLevel(base); const row = [...candidate.tiles[position.z]]; const removed = row[position.x] === '#';
    row[position.x] = removed ? '.' : '#'; candidate.tiles[position.z] = row.join('');
    const solution = solveLevel(candidate, { maxStates: 3000, maxActions: 512 });
    if (solution && verifies(candidate, solution)) return finish(candidate, [`(${position.x},${position.z}) karesindeki bir engel ${removed ? 'kaldırıldı' : 'eklendi'}; çözüm yeniden doğrulandı.`]);
  }
  throw new Error('Bu odada tek engelle güvenli bir harita değişikliği bulunamadı.');
}
