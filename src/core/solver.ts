import { createState, isWalkable, step } from './engine';
import { LEVEL_SOLUTIONS, transformAction } from './levels';
import { DELTAS, type Action, type GameState, type Level, type Position } from './types';

/** Validation tooling only. Neural inference never calls or receives this planner. */
export interface SolveOptions { maxStates?: number; maxActions?: number }
const same = (a: Position, b: Position) => a.x === b.x && a.z === b.z;
const ACTIONS: Action[] = [0, 1, 2, 3, 4, 5];

export function stateKey(state: GameState): string {
  return `${state.robot.x},${state.robot.z},${state.robot.facing},${state.robot.carrying ?? ''}|${state.crates.map(crate => `${crate.x},${crate.z}`).join(';')}|${state.switches.map(s => +s.on).join('')}|${Object.keys(state.sequenceProgress ?? {}).sort().map(id => `${id}:${state.sequenceProgress![id]}`).join(',')}`;
}

interface SearchOptions { maxStates: number; maxActions: number; crateId?: string; dropAt?: Position; unrestricted?: boolean }
function search(initial: GameState, done: (state: GameState) => boolean, options: SearchOptions): Action[] | null {
  const nodes: { state: GameState; previous: number; action: Action; depth: number }[] = [{ state: initial, previous: -1, action: 5, depth: 0 }];
  const seen = new Set([stateKey(initial)]);
  for (let cursor = 0; cursor < nodes.length && cursor < options.maxStates; cursor++) {
    const node = nodes[cursor]; const state = node.state;
    if (done(state)) {
      const actions: Action[] = [];
      for (let i = cursor; nodes[i].previous !== -1; i = nodes[i].previous) actions.push(nodes[i].action);
      return actions.reverse();
    }
    if (node.depth >= options.maxActions || state.solved) continue;
    for (const action of ACTIONS) {
      if (!options.unrestricted && action === 4) {
        const delta = DELTAS[state.robot.facing]; const front = { x: state.robot.x + delta.x, z: state.robot.z + delta.z };
        if (state.robot.carrying) {
          if (!options.dropAt || !same(front, options.dropAt)) continue;
        } else {
          const crate = state.crates.find(item => item.id === options.crateId && same(item, front));
          const switch_ = state.switches.find(item => item.mode !== 'pressure' && same(item, front));
          if (!crate && !switch_) continue;
          if (switch_?.mode === 'toggle' && switch_.on) continue;
          if (switch_?.mode === 'sequence') {
            const sequence = state.level.sequences?.find(item => item.id === switch_.sequenceId);
            if (!sequence || sequence.switchIds[state.sequenceProgress?.[sequence.id] ?? 0] !== switch_.id) continue;
          }
        }
      }
      const next = step(state, action);
      if (!options.unrestricted) {
        if (next.crates.some((crate, index) => crate.id !== options.crateId && !same(crate, initial.crates[index]))) continue;
        if (next.robot.carrying && next.robot.carrying !== options.crateId) continue;
      }
      const key = stateKey(next);
      if (seen.has(key)) continue;
      seen.add(key);
      if (nodes.length >= options.maxStates) continue;
      nodes.push({ state: next, previous: cursor, action, depth: node.depth + 1 });
    }
  }
  return null;
}

/** An over-approximation used to avoid searching behind currently closed doors. */
function region(state: GameState): Set<string> {
  const visited = new Set([`${state.robot.x},${state.robot.z}`]); const queue: Position[] = [state.robot];
  for (let i = 0; i < queue.length; i++) for (const delta of DELTAS) {
    const next = { x: queue[i].x + delta.x, z: queue[i].z + delta.z }; const key = `${next.x},${next.z}`;
    if (!visited.has(key) && isWalkable(state, next.x, next.z)) { visited.add(key); queue.push(next); }
  }
  return visited;
}

/**
 * Bounded constructive search: complete reachable switches and placements first,
 * then fall back to a bounded full-state search. Returns an actual replayable
 * certificate or null; it never claims an unverified puzzle is solvable.
 */
export function solveLevel(level: Level | GameState, options: SolveOptions = {}): Action[] | null {
  const initial = 'robot' in level ? level : createState(level);
  const maxStates = Math.max(1, Math.floor(options.maxStates ?? 12_000));
  const maxActions = Math.max(1, Math.floor(options.maxActions ?? 512));
  if (initial.solved) return [];
  const recorded = LEVEL_SOLUTIONS[initial.level.sourceLevelId ?? initial.level.id];
  if (recorded) for (const reflected of [false, true]) for (let rotations = 0; rotations < 4; rotations++) {
    const actions = recorded.map(action => transformAction(action, rotations, reflected));
    if (actions.length <= maxActions && actions.reduce(step, initial).solved) return actions;
  }
  const taskLimit = maxStates;
  let state = initial; const actions: Action[] = [];
  for (let round = 0; round < 32 && !state.solved && actions.length < maxActions; round++) {
    const reachable = region(state); const within = (position: Position) => reachable.has(`${position.x},${position.z}`);
    const taskOptions = { maxStates: taskLimit, maxActions: maxActions - actions.length };
    let found: Action[] | null = null;
    for (const switch_ of state.switches.filter(item => item.mode === 'toggle' && !item.on && within(item))) {
      const controllers = state.doors.filter(door => door.requires.includes(switch_.id));
      if (controllers.length && controllers.every(door => door.inverted)) continue;
      found = search(state, next => Boolean(next.switches.find(item => item.id === switch_.id)?.on), taskOptions);
      if (found?.length) break;
    }
    if (!found?.length) for (const sequence of state.level.sequences ?? []) {
      const progress = state.sequenceProgress?.[sequence.id] ?? 0;
      const nextSwitch = state.switches.find(item => item.id === sequence.switchIds[progress]);
      if (!nextSwitch || !within(nextSwitch)) continue;
      found = search(state, next => (next.sequenceProgress?.[sequence.id] ?? 0) > progress, taskOptions);
      if (found?.length) break;
    }
    if (!found?.length) {
      const destinations = [
        ...state.level.goals.filter(goal => goal.kind !== 'exit').map(goal => ({ ...goal, kind: goal.kind as 'amber' | 'cyan' | undefined })),
        ...state.switches.filter(item => item.mode === 'pressure' && !state.level.goals.some(goal => same(goal, item))).map(item => ({ ...item, kind: undefined })),
      ];
      outer: for (const destination of destinations) {
        if (!within(destination) || state.crates.some(crate => crate.id !== state.robot.carrying && same(crate, destination) && (!destination.kind || crate.kind === destination.kind))) continue;
        for (const crate of state.crates) {
          if (!within(crate) || (destination.kind && crate.kind !== destination.kind)) continue;
          if (state.level.goals.some(goal => goal.kind === crate.kind && same(goal, crate))) continue;
          found = search(state, next => next.crates.some(item => item.id === crate.id && next.robot.carrying !== item.id && same(item, destination)), { ...taskOptions, crateId: crate.id, dropAt: destination });
          if (found?.length) break outer;
        }
      }
    }
    if (!found?.length) found = search(state, next => next.solved, taskOptions);
    if (!found?.length) break;
    actions.push(...found); state = found.reduce(step, state);
  }
  if (state.solved) return actions;
  return search(initial, next => next.solved, { maxStates, maxActions, unrestricted: true });
}
