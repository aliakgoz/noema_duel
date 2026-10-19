import { describe, expect, it } from 'vitest';
import { createState, getProgress, isWalkable, step } from './engine';
import { generateChallenge, getLevel, LEVELS, LEVEL_SOLUTIONS, transformAction, transformLevel } from './levels';
import { solveLevel } from './solver';
import { createTransferVariant } from './variants';
import { encodeObservation } from './observation';
import { DELTAS, MODEL_INPUTS, type Action, type GameState, type Level, type Position } from './types';

const same = (a: Position, b: Position) => a.x === b.x && a.z === b.z;
const play = (level: Level, actions: readonly Action[]) => actions.reduce(step, createState(level));
const fixture = (overrides: Partial<Level> = {}): Level => ({
  id: 'test', title: 'Test', subtitle: '', chapter: 1, difficulty: 1,
  width: 7, height: 5, tiles: ['#######', '#.....#', '#.....#', '#.....#', '#######'],
  start: { x: 1, z: 2 }, facing: 1, crates: [], switches: [], doors: [],
  goals: [{ x: 5, z: 2, kind: 'exit' }], par: 4, description: '', ...overrides,
});

/** Independent short return route, excluding puzzle objects and forced surfaces. */
function returnToStart(base: Level, variant: Level): Action[] | null {
  const queue = [{ position: variant.start, actions: [] as Action[] }];
  const seen = new Set<string>();
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const { position, actions } = queue[cursor];
    if (same(position, base.start)) return actions;
    if (actions.length >= 3) continue;
    for (let direction = 0; direction < 4; direction++) {
      const delta = DELTAS[direction]; const next = { x: position.x + delta.x, z: position.z + delta.z }; const key = `${next.x},${next.z}`;
      if (seen.has(key) || base.tiles[next.z]?.[next.x] !== '.') continue;
      if (!same(next, base.start) && [...base.crates, ...base.switches, ...base.doors, ...base.goals, ...(base.surfaces ?? [])].some(entity => same(entity, next))) continue;
      seen.add(key); queue.push({ position: next, actions: [...actions, direction as Action] });
    }
  }
  return null;
}

describe('immutable deterministic puzzle engine', () => {
  it('moves, turns against walls and preserves the previous state', () => {
    const initial = createState(fixture()); const snapshot = JSON.stringify(initial);
    const turned = step(initial, 3);
    expect(turned.robot).toMatchObject({ x: 1, z: 2, facing: 3 });
    expect(turned.moves).toBe(0); expect(turned.tick).toBe(1);
    expect(JSON.stringify(initial)).toBe(snapshot);
    expect(isWalkable(initial, -1, 2)).toBe(false); expect(isWalkable(initial, 1.5, 2)).toBe(false);
    expect(() => step(initial, 9 as Action)).toThrow(RangeError);
    expect(step(initial, 1)).toEqual(step(initial, 1));
  });

  it('supports pushing, carrying and matching only released crates', () => {
    const level = fixture({ crates: [{ id: 'a', x: 2, z: 2, kind: 'amber' }], goals: [{ x: 3, z: 2, kind: 'amber' }, { x: 5, z: 2, kind: 'exit' }] });
    const pushed = step(createState(level), 1);
    expect(pushed.crates[0]).toMatchObject({ x: 3, z: 2 }); expect(getProgress(pushed)).toEqual({ completed: 1, total: 2 });
    let carried = play(level, [4, 1, 1]);
    expect(carried.robot.carrying).toBe('a'); expect(carried.crates[0]).toMatchObject({ x: 3, z: 2 }); expect(getProgress(carried).completed).toBe(0);
    carried = step(carried, 4);
    expect(carried.robot.carrying).toBeNull(); expect(carried.crates[0]).toMatchObject({ x: 4, z: 2 });
    expect(createState({ ...level, crates: [{ id: 'c', x: 3, z: 2, kind: 'cyan' }] }).solved).toBe(false);
  });

  it('blocks stacking, pushing while carrying and dropping into walls', () => {
    const level = fixture({ crates: [{ id: 'a', x: 2, z: 2, kind: 'amber' }, { id: 'b', x: 3, z: 2, kind: 'cyan' }] });
    expect(step(createState(level), 1).robot.x).toBe(1);
    const carrying = play(level, [4, 1]);
    expect(step(carrying, 1).robot.x).toBe(2); expect(step(carrying, 4).robot.carrying).toBe('a');
    expect(play(level, [4, 3, 4]).robot.carrying).toBe('a');
  });

  it('combines pressure and toggle conditions using AND', () => {
    const level = fixture({
      switches: [{ id: 'toggle', x: 1, z: 1, mode: 'toggle', on: false }, { id: 'plate', x: 3, z: 2, mode: 'pressure', on: false }],
      doors: [{ id: 'door', x: 4, z: 2, requires: ['toggle', 'plate'], open: false }], crates: [{ id: 'a', x: 2, z: 2, kind: 'amber' }],
    });
    let state = play(level, [2, 0, 4, 1]);
    expect(state.switches.map(s => s.on)).toEqual([true, true]); expect(state.doors[0].open).toBe(true);
    state = step(state, 4);
    expect(state.robot.carrying).toBe('a'); expect(state.switches[1].on).toBe(false); expect(state.doors[0].open).toBe(false);
    expect(isWalkable(state, 4, 2)).toBe(false);
  });

  it('supports OR and inverted logic without treating a missing switch as active', () => {
    const level = fixture({ switches: [{ id: 'a', x: 1, z: 1, mode: 'toggle', on: true }, { id: 'b', x: 3, z: 1, mode: 'toggle', on: false }], doors: [{ id: 'd', x: 4, z: 2, requires: ['a', 'b'], logic: 'or', open: false }] });
    expect(createState(level).doors[0].open).toBe(true);
    expect(createState({ ...level, doors: [{ ...level.doors[0], logic: 'and' }] }).doors[0].open).toBe(false);
    expect(createState({ ...level, doors: [{ ...level.doors[0], inverted: true }] }).doors[0].open).toBe(false);
    expect(createState({ ...level, doors: [{ ...level.doors[0], requires: ['missing'] }] }).doors[0].open).toBe(false);
  });

  it('requires every goal and makes a solved state terminal', () => {
    const level = fixture({ crates: [{ id: 'a', x: 1, z: 1, kind: 'amber' }], goals: [{ x: 1, z: 1, kind: 'amber' }, { x: 5, z: 2, kind: 'exit' }] });
    const state = play(level, [1, 1, 1, 1]); expect(state.solved).toBe(true); expect(step(state, 3)).toBe(state);
    expect(createState(fixture({ goals: [] })).solved).toBe(false);
  });
});

describe('new transport and sequence mechanics', () => {
  it('slides a robot across contiguous ice, stopping on dry floor or before a blocker', () => {
    const level = fixture({ surfaces: [{ x: 2, z: 2, kind: 'ice' }, { x: 3, z: 2, kind: 'ice' }] });
    const state = step(createState(level), 1);
    expect(state.robot).toMatchObject({ x: 4, z: 2 }); expect(state.tick).toBe(1); expect(state.moves).toBe(3);
    const blocked = step(createState({ ...level, crates: [{ id: 'stop', x: 4, z: 2, kind: 'cyan' }] }), 1);
    expect(blocked.robot.x).toBe(3); expect(blocked.crates[0].x).toBe(4);
  });

  it('slides pushed crates while held crates remain attached and cannot fill goals', () => {
    const level = fixture({ crates: [{ id: 'a', x: 2, z: 2, kind: 'amber' }], surfaces: [{ x: 3, z: 2, kind: 'ice' }, { x: 4, z: 2, kind: 'ice' }], goals: [{ x: 5, z: 2, kind: 'amber' }, { x: 5, z: 1, kind: 'exit' }] });
    expect(step(createState(level), 1).crates[0]).toMatchObject({ x: 5, z: 2 });
    const carrying = play(level, [4, 1, 1]);
    expect(carrying.robot.x).toBe(5); expect(carrying.crates[0]).toMatchObject({ x: 5, z: 2 });
    expect(carrying.robot.carrying).toBe('a'); expect(getProgress(carrying).completed).toBe(0);
  });

  it('follows directional conveyor corners, including a carried crate', () => {
    const surfaces = [{ x: 2, z: 2, kind: 'conveyor' as const, direction: 1 as const }, { x: 3, z: 2, kind: 'conveyor' as const, direction: 0 as const }, { x: 3, z: 1, kind: 'conveyor' as const, direction: 1 as const }];
    const level = fixture({ surfaces, crates: [{ id: 'a', x: 2, z: 2, kind: 'amber' }] });
    const carried = play(level, [4, 1]);
    expect(carried.robot).toMatchObject({ x: 4, z: 1, carrying: 'a' }); expect(carried.crates[0]).toMatchObject({ x: 4, z: 1 });
    const waiting = step(createState(level), 5);
    expect(waiting.robot).toMatchObject({ x: 1, z: 2 }); expect(waiting.crates[0]).toMatchObject({ x: 4, z: 1 });
  });

  it('bounds conveyor loops deterministically instead of hanging a frame', () => {
    const level = fixture({ start: { x: 2, z: 1 }, surfaces: [{ x: 2, z: 1, kind: 'conveyor', direction: 1 }, { x: 3, z: 1, kind: 'conveyor', direction: 2 }, { x: 3, z: 2, kind: 'conveyor', direction: 3 }, { x: 2, z: 2, kind: 'conveyor', direction: 0 }] });
    const initial = createState(level); const snapshot = JSON.stringify(initial); const result = step(initial, 5);
    expect(result.robot).toMatchObject({ x: 2, z: 1 }); expect(result.moves).toBe(4); expect(result.lastEvent).toContain('döngü');
    expect(result).toEqual(step(initial, 5)); expect(JSON.stringify(initial)).toBe(snapshot);
  });

  it('records ordered switch memory, resets wrong input and latches a completed sequence', () => {
    const level = fixture({ start: { x: 1, z: 2 }, facing: 0,
      switches: [1, 3, 5].map((x, i) => ({ x, z: 1, id: `s${i}`, mode: 'sequence' as const, sequenceId: 'seq', on: false })),
      sequences: [{ id: 'seq', switchIds: ['s0', 's1', 's2'] }],
      doors: [{ id: 'door', x: 4, z: 3, requires: ['s2'], open: false }], goals: [{ x: 5, z: 3, kind: 'amber' }],
    });
    const press = (state: GameState, x: number): GameState => {
      while (state.robot.x !== x) state = step(state, state.robot.x < x ? 1 : 3);
      return [2, 0, 4].reduce((next, action) => step(next, action as Action), state);
    };
    let state = press(createState(level), 1); expect(state.sequenceProgress?.seq).toBe(1);
    state = press(state, 5); expect(state.sequenceProgress?.seq).toBe(0); expect(state.switches.every(s => !s.on)).toBe(true);
    state = press(state, 1); state = press(state, 3); const previous = JSON.stringify(state);
    const finished = press(state, 5);
    expect(finished.sequenceProgress?.seq).toBe(3); expect(finished.doors[0].open).toBe(true);
    expect(step(finished, 4).sequenceProgress?.seq).toBe(3); expect(JSON.stringify(state)).toBe(previous);
  });
});

describe('56-room curriculum, validation certificates and nearby transfer', () => {
  it('contains seven chapters of eight valid, replayably solvable authored rooms', () => {
    expect(LEVELS).toHaveLength(56); expect(new Set(LEVELS.map(level => level.id)).size).toBe(56);
    expect([1, 2, 3, 4, 5, 6, 7].map(chapter => LEVELS.filter(level => level.chapter === chapter).length)).toEqual([8, 8, 8, 8, 8, 8, 8]);
    for (const level of LEVELS) {
      expect(getLevel(level.id)).toBe(level);
      expect(level.tiles.every(row => row.length === level.width && /^[.#]+$/.test(row))).toBe(true);
      for (const entity of [level.start, ...level.crates, ...level.switches, ...level.doors, ...level.goals, ...(level.surfaces ?? [])]) expect(level.tiles[entity.z][entity.x], level.id).toBe('.');
      const certificate = LEVEL_SOLUTIONS[level.id]; expect(certificate.length).toBeLessThanOrEqual(160);
      expect(play(level, certificate).solved, level.id).toBe(true);
      const found = solveLevel(level); expect(found, level.id).not.toBeNull(); expect(play(level, found!).solved).toBe(true);
    }
    expect(LEVEL_SOLUTIONS['room-01']).toHaveLength(10); expect(getLevel('missing')).toBeUndefined();
  });

  it('rotates and mirrors every mechanic together with its replay certificate', () => {
    for (const index of [0, 23, 26, 33, 38, 45, 47, 48, 50, 52, 55]) for (const reflected of [false, true]) for (let turns = 0; turns < 4; turns++) {
      const base = LEVELS[index]; const rotated = transformLevel(base, turns, reflected);
      const certificate = LEVEL_SOLUTIONS[base.id].map(action => transformAction(action, turns, reflected));
      expect(play(rotated, certificate).solved, `${base.id}/${turns}/${reflected}`).toBe(true);
      expect(rotated.sequences).toEqual(base.sequences);
    }
    expect(transformLevel(LEVELS[32], 1).surfaces?.[0].direction).toBe(2);
    for (const seed of [0, 1, 2, 7, 42, 128, 2026, -17]) {
      const generated = generateChallenge(seed); expect(generated).toEqual(generateChallenge(seed));
      const found = solveLevel(generated); expect(found).not.toBeNull(); expect(play(generated, found!).solved).toBe(true);
    }
    expect(() => generateChallenge(Number.NaN)).toThrow(RangeError);
  });

  it('creates real deterministic nearby differences for all 56 rooms and verifies their solutions', () => {
    for (const base of LEVELS) {
      const snapshot = JSON.stringify(base);
      for (const seed of [17, 73]) for (const kind of ['start', 'layout'] as const) {
        const variant = createTransferVariant(base, seed, kind);
        expect(variant).toEqual(createTransferVariant(base, seed, kind)); expect(variant.id).not.toBe(base.id);
        expect(variant.sourceLevelId).toBe(base.id); expect(variant.variantKind).toBe(kind); expect(variant.variantChanges?.length).toBeGreaterThan(0);
        expect(variant.goals).toEqual(base.goals); expect(variant.crates).toEqual(base.crates); expect(variant.doors).toEqual(base.doors);
        if (kind === 'start') {
          const distance = Math.abs(variant.start.x - base.start.x) + Math.abs(variant.start.z - base.start.z);
          expect(distance).toBeGreaterThan(0); expect(distance).toBeLessThanOrEqual(3); expect(variant.tiles).toEqual(base.tiles);
          const prefix = returnToStart(base, variant); expect(prefix, variant.id).not.toBeNull();
          expect(play(variant, [...prefix!, ...LEVEL_SOLUTIONS[base.id]]).solved, variant.id).toBe(true);
        } else {
          expect(variant.start).toEqual(base.start);
          const differences = base.tiles.flatMap((row, z) => [...row].map((tile, x) => tile !== variant.tiles[z][x] ? 1 : 0)).reduce<number>((a, b) => a + b, 0);
          expect(differences).toBe(1); expect(play(variant, LEVEL_SOLUTIONS[base.id]).solved, variant.id).toBe(true);
        }
      }
      expect(JSON.stringify(base)).toBe(snapshot);
    }
  }, 30_000);

  it('supports transfer from rotated challenges and protects its cached output from callers', () => {
    for (const index of [0, 23, 26, 38, 47, 48, 50, 54, 55]) {
      const original = LEVELS[index]; const base = { ...transformLevel(original, 1, true), id: `rotated-${original.id}`, sourceLevelId: original.id };
      const certificate = LEVEL_SOLUTIONS[original.id].map(action => transformAction(action, 1, true));
      for (const kind of ['start', 'layout'] as const) {
        const variant = createTransferVariant(base, 101, kind);
        const prefix = kind === 'start' ? returnToStart(base, variant)! : [];
        expect(play(variant, [...prefix, ...certificate]).solved).toBe(true);
      }
    }
    const variant = createTransferVariant(LEVELS[0], 404); variant.tiles[1] = 'changed';
    expect(createTransferVariant(LEVELS[0], 404).tiles[1]).toBe(LEVELS[0].tiles[1]);
    expect(() => createTransferVariant(LEVELS[0], 0.5)).toThrow(RangeError);
  });

  it('searches custom fixtures without a prerecorded certificate and respects finite bounds', () => {
    const custom = fixture({ id: 'unrecorded', crates: [{ id: 'a', x: 2, z: 2, kind: 'amber' }], goals: [{ x: 4, z: 2, kind: 'amber' }, { x: 5, z: 1, kind: 'exit' }] });
    const found = solveLevel(custom, { maxStates: 2000 }); expect(found).not.toBeNull(); expect(play(custom, found!).solved).toBe(true);
    const impossible = fixture({ tiles: ['#######', '#..#..#', '#..#..#', '#..#..#', '#######'] });
    expect(solveLevel(impossible, { maxStates: 100 })).toBeNull();
  });

  it('requires opening a separate chamber, retrieving its crate and releasing it back in the starting room', () => {
    const level = LEVELS[48]; const initial = createState(level); const door = initial.doors[0]; const crate = initial.crates[0];
    const goal = level.goals.find(item => item.kind === 'amber')!;
    expect(initial.robot.x).toBeLessThan(door.x); expect(goal.x).toBeLessThan(door.x); expect(crate.x).toBeGreaterThan(door.x);
    expect(door.open).toBe(false);
    // The closed door completes the wall between the two chambers: there is no initial bypass.
    const seen = new Set([`${initial.robot.x},${initial.robot.z}`]); const queue: Position[] = [initial.robot];
    for (let cursor = 0; cursor < queue.length; cursor++) for (const delta of DELTAS) {
      const position = { x: queue[cursor].x + delta.x, z: queue[cursor].z + delta.z }; const key = `${position.x},${position.z}`;
      if (!seen.has(key) && isWalkable(initial, position.x, position.z)) { seen.add(key); queue.push(position); }
    }
    expect(seen.has(`${crate.x},${crate.z}`)).toBe(false);
    let state = initial; let openedAt = -1; let visitedDepotAt = -1; let tookCrateAt = -1; let returnedAt = -1;
    LEVEL_SOLUTIONS[level.id].forEach((action, index) => {
      state = step(state, action);
      if (openedAt < 0 && state.doors[0].open) openedAt = index;
      if (visitedDepotAt < 0 && state.robot.x > door.x) visitedDepotAt = index;
      if (tookCrateAt < 0 && state.robot.carrying === crate.id) tookCrateAt = index;
      if (returnedAt < 0 && !state.robot.carrying && same(state.crates[0], goal)) returnedAt = index;
    });
    expect(openedAt).toBeGreaterThanOrEqual(0); expect(visitedDepotAt).toBeGreaterThan(openedAt);
    expect(tookCrateAt).toBeGreaterThan(visitedDepotAt); expect(returnedAt).toBeGreaterThan(tookCrateAt);
    expect(state.robot.x).toBeLessThan(door.x); expect(state.solved).toBe(true);
  });

  it('keeps the helper crate on a plate until the remote crate has returned, then completes its own goal', () => {
    for (const index of [50, 54, 55]) {
      const level = LEVELS[index]; let state = createState(level);
      const amberGoal = level.goals.find(goal => goal.kind === 'amber')!;
      const cyanGoal = level.goals.find(goal => goal.kind === 'cyan')!;
      const pressure = state.switches.find(switch_ => switch_.mode === 'pressure')!;
      let pressureOnAt = -1; let amberPickedAt = -1; let amberReturnedAt = -1; let cyanFinishedAt = -1;
      LEVEL_SOLUTIONS[level.id].forEach((action, actionIndex) => {
        state = step(state, action);
        if (pressureOnAt < 0 && state.switches.find(switch_ => switch_.id === pressure.id)!.on) pressureOnAt = actionIndex;
        if (amberPickedAt < 0 && state.crates.some(crate => crate.kind === 'amber' && state.robot.carrying === crate.id)) amberPickedAt = actionIndex;
        if (amberReturnedAt < 0 && state.crates.some(crate => crate.kind === 'amber' && state.robot.carrying !== crate.id && same(crate, amberGoal))) amberReturnedAt = actionIndex;
        if (cyanFinishedAt < 0 && state.crates.some(crate => crate.kind === 'cyan' && state.robot.carrying !== crate.id && same(crate, cyanGoal))) cyanFinishedAt = actionIndex;
      });
      expect(pressureOnAt, level.id).toBeGreaterThanOrEqual(0);
      expect(amberPickedAt, level.id).toBeGreaterThan(pressureOnAt);
      expect(amberReturnedAt, level.id).toBeGreaterThan(amberPickedAt);
      expect(cyanFinishedAt, level.id).toBeGreaterThan(amberReturnedAt);
      expect(state.switches.find(switch_ => switch_.id === pressure.id)!.on).toBe(false);
      expect(state.solved).toBe(true);
    }
  });
});

describe('visible model observation integration', () => {
  it('has the model-contract size, finite values, stable history and no state mutation', () => {
    const state = createState(LEVELS[0]); const snapshot = JSON.stringify(state);
    const encoded = encodeObservation(state, [0, 1]);
    expect(encoded).toBeInstanceOf(Float32Array); expect(encoded.length).toBe(MODEL_INPUTS);
    expect([...encoded].every(value => Number.isFinite(value) && value >= -1 && value <= 1)).toBe(true);
    expect(encoded).toEqual(encodeObservation(state, [0, 1])); expect(encoded).not.toEqual(encodeObservation(state, [1, 0]));
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});
