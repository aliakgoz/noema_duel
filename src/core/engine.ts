import { DELTAS, type Action, type Direction, type GameState, type Level } from './types';

const at = (a: { x: number; z: number }, x: number, z: number) => a.x === x && a.z === z;

/** Terrain and doors only; a crate can still occupy a walkable floor tile. */
export function isWalkable(state: GameState, x: number, z: number): boolean {
  if (!Number.isInteger(x) || !Number.isInteger(z) || x < 0 || z < 0 || x >= state.level.width || z >= state.level.height) return false;
  if (state.level.tiles[z]?.[x] !== '.') return false;
  return !state.doors.some(door => at(door, x, z) && !door.open);
}

function updateMechanisms(state: GameState): void {
  for (const plate of state.switches) {
    if (plate.mode === 'pressure') {
      plate.on = at(state.robot, plate.x, plate.z) || state.crates.some(crate => crate.id !== state.robot.carrying && at(crate, plate.x, plate.z));
    }
  }
  for (const door of state.doors) {
    const signals = door.requires.map(id => state.switches.some(switch_ => switch_.id === id && switch_.on));
    const connected = door.logic === 'or' ? signals.some(Boolean) : signals.every(Boolean);
    door.open = door.inverted ? !connected : connected;
  }
}

function syncCarriedCrate(state: GameState): void {
  const carried = state.crates.find(crate => crate.id === state.robot.carrying);
  if (carried) { carried.x = state.robot.x; carried.z = state.robot.z; }
}

/** Each actor settles once per input. Crates settle before the robot; no real-time phase exists. */
function settleSurfaces(state: GameState, robotMomentum?: Direction, pushed?: { id: string; direction: Direction }): boolean {
  let cycle = false;
  const move = (actor: { x: number; z: number }, robot: boolean, id?: string, initialMomentum?: Direction) => {
    let momentum = initialMomentum;
    const visited = new Set<string>();
    const limit = state.level.width * state.level.height * 4;
    for (let count = 0; count < limit; count++) {
      const surface = state.level.surfaces?.find(tile => at(tile, actor.x, actor.z));
      const direction = surface?.kind === 'conveyor' ? surface.direction : surface?.kind === 'ice' ? momentum : undefined;
      if (direction === undefined || !DELTAS[direction]) return;
      const key = `${actor.x},${actor.z},${direction}`;
      if (visited.has(key)) { cycle = true; return; }
      visited.add(key);
      const delta = DELTAS[direction]; const x = actor.x + delta.x; const z = actor.z + delta.z;
      if (!isWalkable(state, x, z) || state.crates.some(crate => crate.id !== id && crate.id !== state.robot.carrying && at(crate, x, z)) || (!robot && at(state.robot, x, z))) return;
      actor.x = x; actor.z = z; momentum = direction;
      if (robot) { state.robot.facing = direction; state.moves++; syncCarriedCrate(state); }
      updateMechanisms(state);
    }
    cycle = true;
  };
  const crates = [...state.crates].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const crate of crates) {
    if (crate.id !== state.robot.carrying) move(crate, false, crate.id, pushed?.id === crate.id ? pushed.direction : undefined);
  }
  move(state.robot, true, undefined, robotMomentum);
  return cycle;
}

function pressSequence(state: GameState, switchId: string, sequenceId?: string): void {
  const sequence = state.level.sequences?.find(item => item.id === sequenceId || (!sequenceId && item.switchIds.includes(switchId)));
  if (!sequence) { state.lastEvent = 'Bu sıra düğmesinin bağlantısı eksik.'; return; }
  const progress = state.sequenceProgress ?? (state.sequenceProgress = {});
  const current = progress[sequence.id] ?? 0;
  if (current === sequence.switchIds.length) { state.lastEvent = 'Bu sıra tamamlandı; bağlantı açık kalıyor.'; return; }
  const correct = sequence.switchIds[current] === switchId;
  const next = correct ? current + 1 : sequence.switchIds[0] === switchId ? 1 : 0;
  progress[sequence.id] = next;
  for (const switch_ of state.switches) {
    const index = sequence.switchIds.indexOf(switch_.id);
    if (index >= 0) switch_.on = index < next;
  }
  state.interactions++;
  state.lastEvent = correct ? next === sequence.switchIds.length ? 'Düğmeleri doğru sırayla açtım. Bağlantı tamamlandı!' : `Doğru sıra: ${next}/${sequence.switchIds.length}.` : 'Sıra değişti; bağlantı başa döndü. Numaraları takip edebilirim.';
}

export function getProgress(state: GameState): { completed: number; total: number } {
  let completed = 0;
  for (const goal of state.level.goals) {
    if (goal.kind === 'exit') {
      if (at(state.robot, goal.x, goal.z)) completed++;
    } else if (state.crates.some(crate => crate.kind === goal.kind && crate.id !== state.robot.carrying && at(crate, goal.x, goal.z))) {
      completed++;
    }
  }
  return { completed, total: state.level.goals.length };
}

export function createState(level: Level): GameState {
  const state: GameState = {
    level,
    robot: { ...level.start, facing: level.facing, carrying: null },
    crates: level.crates.map(crate => ({ ...crate })),
    switches: level.switches.map(switch_ => ({ ...switch_ })),
    doors: level.doors.map(door => ({ ...door, requires: [...door.requires] })),
    moves: 0, interactions: 0, solved: false, tick: 0,
    lastAction: 5, lastEvent: 'Hazır. Bir yol göster.',
    sequenceProgress: Object.fromEntries((level.sequences ?? []).map(sequence => [sequence.id, 0])),
  };
  for (const switch_ of state.switches) if (switch_.mode === 'sequence') switch_.on = false;
  updateMechanisms(state);
  state.solved = level.goals.length > 0 && getProgress(state).completed === level.goals.length;
  return state;
}

/** A tick is an attempted action; moves/interactions count successful actions. */
export function step(previous: GameState, action: Action): GameState {
  if (!Number.isInteger(action) || action < 0 || action > 5) throw new RangeError('Unknown robot action');
  if (previous.solved) return previous;
  const state: GameState = {
    ...previous,
    robot: { ...previous.robot },
    crates: previous.crates.map(crate => ({ ...crate })),
    switches: previous.switches.map(switch_ => ({ ...switch_ })),
    doors: previous.doors.map(door => ({ ...door, requires: [...door.requires] })),
    tick: previous.tick + 1,
    lastAction: action,
    lastEvent: 'Bir an bekledim.',
    sequenceProgress: { ...previous.sequenceProgress },
  };
  let robotMomentum: Direction | undefined;
  let pushed: { id: string; direction: Direction } | undefined;
  if (action < 4) {
    state.robot.facing = action as Direction;
    const delta = DELTAS[action];
    const x = state.robot.x + delta.x;
    const z = state.robot.z + delta.z;
    const crate = state.crates.find(item => item.id !== state.robot.carrying && at(item, x, z));
    if (!isWalkable(state, x, z)) {
      state.lastEvent = 'Bu yol kapalı. Başka bir yön deneyebilirim.';
    } else if (crate) {
      const nextX = x + delta.x;
      const nextZ = z + delta.z;
      const occupied = state.crates.some(item => item.id !== state.robot.carrying && at(item, nextX, nextZ));
      if (state.robot.carrying || !isWalkable(state, nextX, nextZ) || occupied) {
        state.lastEvent = state.robot.carrying ? 'Ellerim dolu; önce taşıdığım kutuyu bırakmalıyım.' : 'Kutunun arkasında yer yok. Onu kaldırabilirim.';
      } else {
        crate.x = nextX;
        crate.z = nextZ;
        pushed = { id: crate.id, direction: action as Direction };
        state.robot.x = x;
        state.robot.z = z;
        state.moves++;
        robotMomentum = action as Direction;
        state.lastEvent = 'Kutuyu ittim.';
      }
    } else {
      state.robot.x = x;
      state.robot.z = z;
      state.moves++;
      robotMomentum = action as Direction;
      state.lastEvent = state.robot.carrying ? 'Kutuyu taşıyorum.' : 'Bir adım attım.';
    }
    if (state.robot.carrying) {
      const carried = state.crates.find(item => item.id === state.robot.carrying);
      if (carried) { carried.x = state.robot.x; carried.z = state.robot.z; }
    }
  } else if (action === 4) {
    const delta = DELTAS[state.robot.facing];
    const x = state.robot.x + delta.x;
    const z = state.robot.z + delta.z;
    const crate = state.crates.find(item => item.id !== state.robot.carrying && at(item, x, z));
    const switch_ = state.switches.find(item => item.mode !== 'pressure' && at(item, x, z));
    if (state.robot.carrying) {
      if (isWalkable(state, x, z) && !crate) {
        const carried = state.crates.find(item => item.id === state.robot.carrying);
        if (carried) { carried.x = x; carried.z = z; }
        state.robot.carrying = null;
        state.interactions++;
        state.lastEvent = 'Kutuyu önümdeki yere bıraktım.';
      } else state.lastEvent = 'Kutuyu bırakmak için önümde boş bir yer olmalı.';
    } else if (crate && isWalkable(state, x, z)) {
      state.robot.carrying = crate.id;
      crate.x = state.robot.x;
      crate.z = state.robot.z;
      state.interactions++;
      state.lastEvent = 'Kutuyu kaldırdım. E ile önümdeki yere bırakabilirim.';
    } else if (switch_) {
      if (switch_.mode === 'sequence') pressSequence(state, switch_.id, switch_.sequenceId);
      else {
        switch_.on = !switch_.on;
        state.interactions++;
        state.lastEvent = switch_.on ? 'Anahtarı açtım.' : 'Anahtarı kapattım.';
      }
    } else state.lastEvent = 'Önümde kaldırılacak kutu veya değiştirilecek anahtar yok.';
  }
  updateMechanisms(state);
  const cycle = settleSurfaces(state, robotMomentum, pushed);
  updateMechanisms(state);
  state.solved = state.level.goals.length > 0 && getProgress(state).completed === state.level.goals.length;
  if (cycle) state.lastEvent = 'Akış bir döngü oluşturdu; güvenli bir karede durdum. Başka bir yön deneyebilirim.';
  if (state.solved) state.lastEvent = 'Bütün hedefler tamamlandı. Bu yolu öğrendim!';
  return state;
}
