import { DELTAS, MODEL_INPUTS, type Action, type GameState, type Position } from './types';
import { getProgress, isWalkable } from './engine';

const same = (a: Position, b: Position) => a.x === b.x && a.z === b.z;

/**
 * Fixed, visible-state-only representation, shared by local and verified replay.
 * 0..11: pose/carry/progress/room size; 12..74: 3x3 seven-channel tiles;
 * 75..92: relative unsatisfied crates/goals/exit/pressure plate;
 * 93..104: four directional terrain/crate/switch cues;
 * 105..116: last two actions; 117..127: door/toggle/task relative cues.
 * v2 appends 128..159: task direction, visible free rays, forced terrain,
 * sequence progress and gate logic. The original 128 numeric meanings are unchanged.
 * No solution, path planner or future state is exposed.
 */
export function encodeObservation(state: GameState, history: Action[] = []): Float32Array {
  const output = new Float32Array(MODEL_INPUTS);
  const { robot, level } = state;
  const widthScale = Math.max(1, level.width - 1);
  const heightScale = Math.max(1, level.height - 1);
  const carried = state.crates.find(crate => crate.id === robot.carrying);
  output[robot.facing] = 1;
  output[4 + (carried ? carried.kind === 'amber' ? 1 : 2 : 0)] = 1;
  output[7] = robot.x / widthScale;
  output[8] = robot.z / heightScale;
  const progress = getProgress(state);
  output[9] = progress.total ? progress.completed / progress.total : 0;
  output[10] = Math.min(1, level.width / 20);
  output[11] = Math.min(1, level.height / 20);

  const looseCrates = state.crates.filter(crate => crate.id !== robot.carrying);
  const isGoalFilled = (goal: (typeof level.goals)[number]) => goal.kind === 'exit' ? same(goal, robot) : looseCrates.some(crate => crate.kind === goal.kind && same(crate, goal));
  const remainingGoals = level.goals.filter(goal => !isGoalFilled(goal));
  const unsettledCrates = looseCrates.filter(crate => !level.goals.some(goal => goal.kind === crate.kind && same(goal, crate)));
  let index = 12;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = robot.x + dx; const z = robot.z + dz;
      output[index++] = level.tiles[z]?.[x] === '.' ? 0 : 1;
      output[index++] = state.doors.some(door => door.x === x && door.z === z && !door.open) ? 1 : 0;
      output[index++] = looseCrates.some(crate => crate.x === x && crate.z === z && crate.kind === 'amber') ? 1 : 0;
      output[index++] = looseCrates.some(crate => crate.x === x && crate.z === z && crate.kind === 'cyan') ? 1 : 0;
      output[index++] = level.goals.some(goal => goal.x === x && goal.z === z && goal.kind === 'amber') ? 1 : 0;
      output[index++] = level.goals.some(goal => goal.x === x && goal.z === z && goal.kind === 'cyan') ? 1 : 0;
      output[index++] = level.goals.some(goal => goal.x === x && goal.z === z && goal.kind === 'exit') ? 1 : 0;
    }
  }
  const nearest = <T extends Position>(positions: T[]): T | undefined => {
    let candidate: T | undefined; let distance = Infinity;
    for (const position of positions) {
      const next = Math.abs(position.x - robot.x) + Math.abs(position.z - robot.z);
      if (next < distance || (next === distance && candidate && (position.z < candidate.z || (position.z === candidate.z && position.x < candidate.x)))) {
        candidate = position; distance = next;
      }
    }
    return candidate;
  };
  const relative = (position: Position | undefined) => {
    output[index++] = position ? (position.x - robot.x) / widthScale : 0;
    output[index++] = position ? (position.z - robot.z) / heightScale : 0;
    output[index++] = position ? 1 : 0;
  };
  relative(nearest(unsettledCrates.filter(crate => crate.kind === 'amber')));
  relative(nearest(unsettledCrates.filter(crate => crate.kind === 'cyan')));
  relative(nearest(remainingGoals.filter(goal => goal.kind === 'amber')));
  relative(nearest(remainingGoals.filter(goal => goal.kind === 'cyan')));
  relative(nearest(level.goals.filter(goal => goal.kind === 'exit')));
  relative(nearest(state.switches.filter(switch_ => switch_.mode === 'pressure' && !switch_.on)));
  for (const delta of DELTAS) {
    const x = robot.x + delta.x; const z = robot.z + delta.z;
    output[index++] = isWalkable(state, x, z) ? 1 : 0;
    const crate = looseCrates.find(item => item.x === x && item.z === z);
    output[index++] = crate ? crate.kind === 'amber' ? 1 : -1 : 0;
    const switch_ = state.switches.find(item => item.x === x && item.z === z);
    output[index++] = switch_ ? switch_.on ? 1 : -1 : 0;
  }
  for (const offset of [2, 1]) {
    const action = history[history.length - offset];
    if (action !== undefined && action >= 0 && action < 6) output[index + action] = 1;
    index += 6;
  }
  relative(nearest(state.doors.filter(door => !door.open)));
  relative(nearest(state.switches.filter(switch_ => switch_.mode === 'toggle' && !switch_.on)));
  const task = carried
    ? nearest(remainingGoals.filter(goal => goal.kind === carried.kind))
    : nearest(unsettledCrates) ?? nearest(remainingGoals);
  relative(task);
  const plates = state.switches.filter(switch_ => switch_.mode === 'pressure');
  output[index++] = plates.length ? plates.filter(plate => plate.on).length / plates.length : 0;
  output[index++] = Math.min(1, state.doors.length / 4);
  if (index !== 128) throw new Error(`Legacy observation layout mismatch: ${index}`);

  // Short-range and sign representations share spatial meaning across room sizes.
  // They are observations of the task objects, never suggestions for the next action.
  output[index++] = task ? Math.max(-1, Math.min(1, (task.x - robot.x) / 4)) : 0;
  output[index++] = task ? Math.max(-1, Math.min(1, (task.z - robot.z) / 4)) : 0;
  output[index++] = task ? Math.sign(task.x - robot.x) : 0;
  output[index++] = task ? Math.sign(task.z - robot.z) : 0;
  for (const delta of DELTAS) {
    let distance = 0;
    for (let n = 1; n <= 4; n++) {
      const x = robot.x + delta.x * n; const z = robot.z + delta.z * n;
      if (!isWalkable(state, x, z) || looseCrates.some(crate => crate.x === x && crate.z === z)) break;
      distance++;
    }
    output[index++] = distance / 4;
  }
  const neighborhood = [robot, ...DELTAS.map(delta => ({ x: robot.x + delta.x, z: robot.z + delta.z }))];
  const surfaces = level.surfaces ?? [];
  for (const point of neighborhood) {
    const surface = surfaces.find(candidate => same(candidate, point));
    output[index++] = surface?.kind === 'ice' ? -1 : surface?.kind === 'conveyor' ? 1 : 0;
  }
  for (const point of neighborhood) {
    const surface = surfaces.find(candidate => same(candidate, point));
    output[index++] = surface?.kind === 'conveyor' && surface.direction !== undefined ? (surface.direction + 1) / 4 : 0;
  }
  const sequences = level.sequences ?? [];
  const sequenceProgress = state.sequenceProgress ?? {};
  const unfinishedSequences = sequences.filter(sequence => (sequenceProgress[sequence.id] ?? 0) < sequence.switchIds.length);
  const nextSwitches = unfinishedSequences.map(sequence => {
    const progress = sequenceProgress[sequence.id] ?? 0;
    const switch_ = state.switches.find(candidate => candidate.id === sequence.switchIds[progress]);
    return switch_ ? { ...switch_, sequence, progress } : undefined;
  }).filter((item): item is NonNullable<typeof item> => item !== undefined);
  const sequenceTarget = nearest(nextSwitches);
  output[index++] = sequenceTarget ? (sequenceTarget.x - robot.x) / widthScale : 0;
  output[index++] = sequenceTarget ? (sequenceTarget.z - robot.z) / heightScale : 0;
  output[index++] = sequenceTarget ? sequenceTarget.progress / Math.max(1, sequenceTarget.sequence.switchIds.length) : 0;
  output[index++] = sequenceTarget ? 1 : 0;
  const closedDoor = nearest(state.doors.filter(door => !door.open));
  output[index++] = closedDoor?.logic === 'or' ? 1 : 0;
  output[index++] = closedDoor?.inverted ? 1 : 0;
  output[index++] = closedDoor ? Math.min(1, closedDoor.requires.length / 4) : 0;
  output[index++] = closedDoor?.requires.length
    ? closedDoor.requires.filter(id => state.switches.some(switch_ => switch_.id === id && switch_.on)).length / closedDoor.requires.length : 0;
  const forward = DELTAS[robot.facing];
  const front = { x: robot.x + forward.x, z: robot.z + forward.z };
  output[index++] = sequenceTarget && same(sequenceTarget, front) ? 1 : 0;
  output[index++] = sequences.length ? (sequences.length - unfinishedSequences.length) / sequences.length : 0;
  const currentSurface = surfaces.find(surface => same(surface, robot));
  const conveyorDelta = currentSurface?.kind === 'conveyor' && currentSurface.direction !== undefined ? DELTAS[currentSurface.direction] : undefined;
  output[index++] = conveyorDelta?.x ?? 0;
  output[index++] = conveyorDelta?.z ?? 0;
  const frontCrate = looseCrates.find(crate => same(crate, front));
  const behind = { x: front.x + forward.x, z: front.z + forward.z };
  output[index++] = !robot.carrying && frontCrate && isWalkable(state, behind.x, behind.z) && !looseCrates.some(crate => same(crate, behind)) ? 1 : 0;
  output[index++] = robot.carrying && isWalkable(state, front.x, front.z) && !frontCrate ? 1 : 0;
  if (index !== MODEL_INPUTS) throw new Error(`Observation layout mismatch: ${index}`);
  return output;
}
