import { COURT, type CourtLayout, type DuelCrate, type DuelProjectile, type DuelRobot, type DuelState, type DuelWall, type ManualInput, type Side, type Strategy, type Vec2 } from './types';

const STEP = 1 / 120;
const EPS = 0.00001;
export const ROBOT_MAX_SPEED = 4.8;
export const ROBOT_CARRY_SPEED = ROBOT_MAX_SPEED * (2.3 / 3.2);
const SCALE_X = COURT.width / 24;
const SCALE_Z = COURT.depth / 14;
export const PROJECTILE_RADIUS = 0.2;
export const PROJECTILE_RANGE = COURT.width * 1.5;
export const SHOT_COOLDOWN = 1.25;
export const PROJECTILE_SPEED = 18;
export const PROJECTILE_DAMAGE = 26;
/** All robots always fire at full power; the old argument remains compatible with saved policies. */
export const shotSpeedForPower = (_power: number = 1) => PROJECTILE_SPEED;
export const pickupRangeForCrate = (size: number) => COURT.robotRadius + size / 2 + 0.75;
type Brain = { coverDone: boolean; coverUntil: number; coverNext: number; coverId: string | null; coverTarget: Vec2; dodgeUntil: number; dodgeNext: number };
type Runtime = { remainder: number; interactHeld: boolean; interactPending: boolean; brains: [Brain, Brain] };
const runtimes = new WeakMap<DuelState, Runtime>();
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
const direction = (side: Side) => side === 0 ? 1 : -1;
const finite = (v: number, fallback = 0) => Number.isFinite(v) ? v : fallback;
function random(state: DuelState) {
  state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0;
  return state.seed / 4294967296;
}
function brain(side: Side): Brain {
  return { coverDone: false, coverUntil: 0, coverNext: 0, coverId: null, coverTarget: { x: (side === 0 ? -6.6 : 6.6) * SCALE_X, z: (side === 0 ? -0.9 : 0.9) * SCALE_Z }, dodgeUntil: 0, dodgeNext: 0 };
}
function runtime(state: DuelState): Runtime {
  let value = runtimes.get(state);
  if (!value) {
    value = { remainder: 0, interactHeld: false, interactPending: false, brains: [brain(0), brain(1)] };
    runtimes.set(state, value);
  }
  return value;
}
function emit(state: DuelState, kind: DuelState['events'][number]['kind'], side: Side, point: Vec2, text: string) {
  state.events.push({ id: state.nextId++, kind, side, x: point.x, z: point.z, text, time: state.time });
  if (state.events.length > 30) state.events.splice(0, state.events.length - 30);
}

function makeWalls(layout: CourtLayout): DuelWall[] {
  const wall = (id: string, x: number, z: number, width: number, depth: number, kind: DuelWall['kind']): DuelWall => ({ id, x: x * SCALE_X, z: z * SCALE_Z, width: width * SCALE_X, depth: depth * SCALE_Z, kind });
  // These are real segments: the gaps and every phase segment let projectiles leave.
  const walls = [
    wall('north-west', -7.6, -6.8, 7.5, 0.32, 'bounce'), wall('north-east', 7.6, -6.8, 7.5, 0.32, 'phase'),
    wall('south-west', -7.6, 6.8, 7.5, 0.32, 'phase'), wall('south-east', 7.6, 6.8, 7.5, 0.32, 'bounce'),
    wall('west', -11.8, 0, 0.32, 8.2, 'bounce'), wall('east', 11.8, 0, 0.32, 8.2, 'bounce'),
  ];
  if (layout === 'classic') walls.push(
    wall('left-glass', -4.3, -3.8, 0.34, 2.4, 'phase'), wall('right-glass', 4.3, 3.8, 0.34, 2.4, 'phase'),
    wall('left-bank', -2.7, 4.8, 3.4, 0.34, 'bounce'), wall('right-bank', 2.7, -4.8, 3.4, 0.34, 'bounce'),
  );
  if (layout === 'ricochet') walls.push(
    wall('north-bank', 0, -5.6, 16.5, 0.36, 'bounce'), wall('south-bank', 0, 5.6, 16.5, 0.36, 'bounce'),
    wall('left-glass', -5, 2.9, 0.34, 2.2, 'phase'), wall('right-glass', 5, -2.9, 0.34, 2.2, 'phase'),
  );
  return walls;
}

export function createDuel(layout: CourtLayout = 'classic', seed = 42): DuelState {
  const robot = (id: Side): DuelRobot => {
    const x = (id === 0 ? -8.1 : 8.1) * SCALE_X;
    const z = (id === 0 ? -2 : 2) * SCALE_Z;
    return { id, name: id === 0 ? 'ATLAS' : 'KOR', x, z, hp: COURT.maxHp, maxHp: COURT.maxHp, vx: 0, vz: 0, angle: id === 0 ? Math.PI / 2 : -Math.PI / 2, cooldown: 0.6 + id * 0.19, carrying: null, strategy: 'balanced', decision: { action: 'Hazır', reason: 'Kort ve rakip analiz ediliyor.', aim: { x: -x, z: -z }, power: 1, target: { x, z } }, shots: 0, hits: 0, damage: 0, hitFlash: 0, shotFlash: 0, thinkIn: 0 };
  };
  const crates: DuelCrate[] = [0, 1].flatMap(side => [
    { id: `crate-${side}-a`, owner: side as Side, x: side === 0 ? -6.1 : 6.1, z: side === 0 ? -1.5 : 1.5, size: 1.05, hp: 48, maxHp: 48, carriedBy: null },
    { id: `crate-${side}-b`, owner: side as Side, x: side === 0 ? -3.8 : 3.8, z: side === 0 ? 2.2 : -2.2, size: 1.15, hp: 58, maxHp: 58, carriedBy: null },
  ]).map(crate => ({ ...crate, x: crate.x * SCALE_X, z: crate.z * SCALE_Z, size: crate.size * SCALE_X }));
  const state: DuelState = { seed: seed >>> 0, time: 0, phase: 'ready', layout, robots: [robot(0), robot(1)], walls: makeWalls(layout), crates, projectiles: [], events: [], winner: null, nextId: 1 };
  runtime(state);
  return state;
}

export function startDuel(state: DuelState) {
  if (state.phase === 'ready') {
    state.phase = 'running';
    emit(state, 'cover', 0, { x: 0, z: 0 }, 'Düello başladı. Robotlar kendi yarı sahalarında.');
  }
}
export function togglePause(state: DuelState) {
  if (state.phase === 'running') state.phase = 'paused';
  else if (state.phase === 'paused') state.phase = 'running';
}
export function setStrategy(state: DuelState, side: Side, strategy: Strategy) {
  state.robots[side].strategy = strategy;
  state.robots[side].thinkIn = 0;
  runtime(state).brains[side].coverNext = Math.min(runtime(state).brains[side].coverNext, state.time + 1);
}

function rectOverlap(x: number, z: number, half: number, box: DuelWall | DuelCrate) {
  const width = 'width' in box ? box.width : box.size;
  const depth = 'depth' in box ? box.depth : box.size;
  return Math.abs(x - box.x) < half + width / 2 - EPS && Math.abs(z - box.z) < half + depth / 2 - EPS;
}
function circleOverlap(x: number, z: number, r: number, box: DuelWall | DuelCrate) {
  const halfX = ('width' in box ? box.width : box.size) / 2;
  const halfZ = ('depth' in box ? box.depth : box.size) / 2;
  return Math.hypot(x - clamp(x, box.x - halfX, box.x + halfX), z - clamp(z, box.z - halfZ, box.z + halfZ)) < r - EPS;
}
function withinHalf(x: number, z: number, half: number, side: Side) {
  return z >= -COURT.halfDepth + half && z <= COURT.halfDepth - half && (side === 0 ? x >= -COURT.halfWidth + half && x <= -half : x >= half && x <= COURT.halfWidth - half);
}
function cratePosition(robot: DuelRobot, crate: DuelCrate, x = robot.x, z = robot.z): Vec2 {
  return { x: x + direction(robot.id) * (COURT.robotRadius + crate.size / 2 + 0.1), z };
}
function validCrate(state: DuelState, crate: DuelCrate, position: Vec2, carrier?: Side) {
  const half = crate.size / 2;
  return withinHalf(position.x, position.z, half, crate.owner)
    && !state.walls.some(w => rectOverlap(position.x, position.z, half, w))
    && !state.crates.some(c => c.id !== crate.id && c.hp > 0 && rectOverlap(position.x, position.z, half, c))
    && !state.robots.some(r => r.id !== carrier && circleOverlap(r.x, r.z, COURT.robotRadius, { ...crate, ...position }));
}
function validRobot(state: DuelState, robot: DuelRobot, x: number, z: number) {
  if (!withinHalf(x, z, COURT.robotRadius, robot.id)) return false;
  if (state.walls.some(w => circleOverlap(x, z, COURT.robotRadius, w))) return false;
  if (state.crates.some(c => c.hp > 0 && c.carriedBy !== robot.id && circleOverlap(x, z, COURT.robotRadius, c))) return false;
  if (robot.carrying) {
    const crate = state.crates.find(c => c.id === robot.carrying);
    if (crate && !validCrate(state, crate, cratePosition(robot, crate, x, z), robot.id)) return false;
  }
  return true;
}
function interact(state: DuelState, robot: DuelRobot): boolean {
  if (robot.carrying) {
    const crate = state.crates.find(c => c.id === robot.carrying);
    if (!crate) { robot.carrying = null; return false; }
    if (!validCrate(state, crate, crate, robot.id)) return false;
    crate.carriedBy = null;
    robot.carrying = null;
    emit(state, 'cover', robot.id, crate, `${robot.name} siperi yeni konumuna bıraktı.`);
    return true;
  }
  const crate = state.crates.filter(c => c.owner === robot.id && c.hp > 0 && c.carriedBy === null && dist(c, robot) < pickupRangeForCrate(c.size))
    .sort((a, b) => dist(a, robot) - dist(b, robot))[0];
  if (!crate) return false;
  const position = cratePosition(robot, crate);
  if (!validCrate(state, crate, position, robot.id)) return false;
  crate.carriedBy = robot.id;
  Object.assign(crate, position);
  robot.carrying = crate.id;
  emit(state, 'cover', robot.id, robot, `${robot.name} kendi kutusunu siper kurmak için aldı.`);
  return true;
}

type Collision = { t: number; nx: number; nz: number };
/** Sweep a point against a rectangle expanded by projectile radius. */
function sweepBox(p: Vec2, dx: number, dz: number, box: DuelWall | DuelCrate, radius = 0): Collision | null {
  const hx = ('width' in box ? box.width : box.size) / 2 + radius;
  const hz = ('depth' in box ? box.depth : box.size) / 2 + radius;
  let entry = -Infinity, leave = Infinity, nx = 0, nz = 0;
  for (const [value, delta, lo, hi, axis] of [[p.x, dx, box.x - hx, box.x + hx, 0], [p.z, dz, box.z - hz, box.z + hz, 1]]) {
    if (Math.abs(delta) < EPS) { if (value < lo || value > hi) return null; continue; }
    let near = (lo - value) / delta, far = (hi - value) / delta;
    if (near > far) [near, far] = [far, near];
    if (near > entry) { entry = near; nx = axis === 0 ? -Math.sign(delta) : 0; nz = axis === 1 ? -Math.sign(delta) : 0; }
    leave = Math.min(leave, far);
    if (entry > leave) return null;
  }
  if (leave < 0 || entry > 1) return null;
  if (entry < 0) {
    // A muzzle can begin inside the expanded edge. Reflect back toward free space.
    if (Math.abs(dx) > Math.abs(dz)) return { t: 0, nx: -Math.sign(dx), nz: 0 };
    return { t: 0, nx: 0, nz: -Math.sign(dz) };
  }
  return { t: entry, nx, nz };
}
function sweepCircle(p: Vec2, dx: number, dz: number, target: Vec2, radius: number): number | null {
  const x = p.x - target.x, z = p.z - target.z;
  const a = dx * dx + dz * dz;
  const c = x * x + z * z - radius * radius;
  if (c <= 0) return 0;
  if (a < EPS * EPS) return null;
  const b = 2 * (x * dx + z * dz), discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}
function blocked(state: DuelState, from: Vec2, to: Vec2, owner?: Side, excludeWall?: string) {
  const dx = to.x - from.x, dz = to.z - from.z;
  return state.walls.some(w => w.kind === 'bounce' && w.id !== excludeWall && sweepBox(from, dx, dz, w, PROJECTILE_RADIUS))
    || state.crates.some(c => c.hp > 0 && (owner === undefined || c.owner === owner) && sweepBox(from, dx, dz, c, PROJECTILE_RADIUS));
}

/** Exact constant-velocity intercept, then clipped to the target's legal half court. */
export function predictIntercept(from: Vec2, target: DuelRobot, speed: number): Vec2 {
  const rx = target.x - from.x, rz = target.z - from.z;
  const a = target.vx * target.vx + target.vz * target.vz - speed * speed;
  const b = 2 * (rx * target.vx + rz * target.vz), c = rx * rx + rz * rz;
  let travel = Math.sqrt(c) / Math.max(1, speed);
  if (Math.abs(a) > EPS) {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      const roots = [(-b - Math.sqrt(discriminant)) / (2 * a), (-b + Math.sqrt(discriminant)) / (2 * a)].filter(t => t >= 0);
      if (roots.length) travel = Math.min(...roots);
    }
  } else if (Math.abs(b) > EPS && -c / b >= 0) travel = -c / b;
  travel = Math.min(6, travel);
  return {
    x: clamp(target.x + target.vx * travel, target.id === 0 ? -COURT.halfWidth + COURT.robotRadius : COURT.robotRadius, target.id === 0 ? -COURT.robotRadius : COURT.halfWidth - COURT.robotRadius),
    z: clamp(target.z + target.vz * travel, -COURT.halfDepth + COURT.robotRadius, COURT.halfDepth - COURT.robotRadius),
  };
}

function shotAim(state: DuelState, robot: DuelRobot): { aim: Vec2; bank: boolean } {
  const enemy = state.robots[(1 - robot.id) as Side];
  const aim = predictIntercept(robot, enemy, PROJECTILE_SPEED);
  const directBlocked = blocked(state, robot, aim, robot.id);
  if (directBlocked || (state.layout === 'ricochet' && random(state) < 0.24)) {
    const banks = state.walls.filter(w => w.kind === 'bounce' && w.width > w.depth && w.width > 5);
    for (const wall of banks) {
      const surface = wall.z + (robot.z > wall.z ? 1 : -1) * (wall.depth / 2 + PROJECTILE_RADIUS);
      const bankAim = predictIntercept({ x: robot.x, z: 2 * surface - robot.z }, enemy, PROJECTILE_SPEED);
      const mirrored = { x: bankAim.x, z: 2 * surface - bankAim.z };
      const fraction = (surface - robot.z) / (mirrored.z - robot.z);
      const contact = { x: robot.x + (mirrored.x - robot.x) * fraction, z: surface };
      if (fraction > 0 && fraction < 1 && Math.abs(contact.x - wall.x) < wall.width / 2 - 0.3
        && !blocked(state, robot, contact, undefined, wall.id) && !blocked(state, contact, bankAim, undefined, wall.id)) return { aim: mirrored, bank: true };
    }
  }
  return { aim, bank: false };
}

function think(state: DuelState, robot: DuelRobot, data: Brain) {
  const enemy = state.robots[(1 - robot.id) as Side];
  const sign = direction(robot.id);
  const attack = shotAim(state, robot);
  robot.decision.aim = attack.aim;
  robot.decision.power = 1;
  const coverAvailable = state.crates.some(c => c.owner === robot.id && c.hp > 0);
  if ((!data.coverDone || (robot.strategy === 'defensive' && state.time > data.coverNext)) && coverAvailable) {
    if (!data.coverId) {
      const crate = state.crates.filter(c => c.owner === robot.id && c.hp > 0 && c.carriedBy === null).sort((a, b) => dist(a, robot) - dist(b, robot))[0];
      if (crate) {
        data.coverId = crate.id;
        data.coverUntil = state.time + 6;
        data.coverTarget = { x: -sign * (robot.strategy === 'defensive' ? 7.1 : 6.1) * SCALE_X, z: clamp(enemy.z * 0.28 + (robot.id === 0 ? -0.7 : 0.7) * SCALE_Z, -3 * SCALE_Z, 3 * SCALE_Z) };
      }
    }
    const crate = state.crates.find(c => c.id === data.coverId && c.hp > 0);
    if (crate && state.time < data.coverUntil) {
      if (!robot.carrying && dist(robot, crate) < pickupRangeForCrate(crate.size)) interact(state, robot);
      if (robot.carrying) {
        robot.decision.target = { ...data.coverTarget };
        robot.decision.action = 'Siper taşıyor';
        robot.decision.reason = 'Kutuyu rakibin atış hattına taşıyıp korunak kuruyor.';
        if (dist(robot, data.coverTarget) < 0.24 || state.time > data.coverUntil - 0.35) {
          interact(state, robot);
          data.coverDone = true;
          data.coverId = null;
          data.coverNext = state.time + 18;
        } else return;
      } else {
        robot.decision.target = { x: crate.x - sign * (crate.size / 2 + COURT.robotRadius + 0.15), z: crate.z };
        robot.decision.action = 'Siper hazırlıyor';
        robot.decision.reason = 'Kendi kutusuna yaklaşıyor; kutular atışları soğurur.';
        return;
      }
    } else {
      if (robot.carrying) interact(state, robot);
      data.coverDone = true;
      data.coverId = null;
      data.coverNext = state.time + 18;
    }
  }
  if (state.time >= data.dodgeNext) {
    for (const shot of state.projectiles) {
      if (shot.owner === robot.id) continue;
      const vx = shot.vx - robot.vx, vz = shot.vz - robot.vz;
      const t = clamp(-((shot.x - robot.x) * vx + (shot.z - robot.z) * vz) / (vx * vx + vz * vz), 0, 0.43);
      const proximity = Math.hypot(shot.x + vx * t - robot.x, shot.z + vz * t - robot.z);
      if (t > 0.045 && proximity < 0.85) {
        const len = Math.hypot(shot.vx, shot.vz);
        const evade = robot.z > 0 ? -1 : 1;
        const candidate = { x: clamp(robot.x - shot.vz / len * evade * 1.6, robot.id === 0 ? -COURT.halfWidth + 1.4 : 1.4, robot.id === 0 ? -1.4 : COURT.halfWidth - 1.4), z: clamp(robot.z + shot.vx / len * evade * sign * 1.6, -COURT.halfDepth + 1.2, COURT.halfDepth - 1.2) };
        if (validRobot(state, robot, candidate.x, candidate.z)) {
          robot.decision.target = candidate;
          robot.decision.action = 'Atıştan kaçıyor';
          robot.decision.reason = 'Gelen taşın kesişme noktasından yana açılıyor.';
          data.dodgeUntil = state.time + 0.42;
          data.dodgeNext = state.time + (robot.strategy === 'defensive' ? 1.05 : 1.6);
          return;
        }
      }
    }
  }
  if (state.time < data.dodgeUntil) return;
  const forward = (robot.strategy === 'aggressive' ? 3.3 : robot.strategy === 'defensive' ? 7.7 : 5.7) * SCALE_X;
  let z = clamp(enemy.z + Math.sin(state.time * 0.65 + robot.id * 2.4) * 1.7 * SCALE_Z, -4.2 * SCALE_Z, 4.2 * SCALE_Z);
  const ownCover = blocked(state, robot, attack.aim, robot.id) ? state.crates.find(c => c.owner === robot.id && c.hp > 0 && sweepBox(robot, attack.aim.x - robot.x, attack.aim.z - robot.z, c, PROJECTILE_RADIUS)) : undefined;
  if (ownCover) z = clamp(ownCover.z + (robot.id === 0 ? -1 : 1) * (ownCover.size / 2 + 1.7), -4.8 * SCALE_Z, 4.8 * SCALE_Z);
  robot.decision.target = { x: -sign * (forward + Math.sin(state.time * 0.43 + robot.id) * 0.6 * SCALE_X), z };
  robot.decision.action = attack.bank ? 'Sekmeli atış arıyor' : robot.strategy === 'defensive' ? 'Siper hattını koruyor' : 'Atış hattı kuruyor';
  robot.decision.reason = attack.bank ? 'Yansıtıcı duvarı kullanarak rakibin siperini aşıyor.' : 'Rakibin hızını hesaba katıp hareket edeceği noktaya nişan alıyor.';
}

function moveRobot(state: DuelState, robot: DuelRobot, move: Vec2, dt: number) {
  const length = Math.hypot(move.x, move.z);
  const scale = length > 1 ? 1 / length : 1;
  const speed = robot.carrying ? ROBOT_CARRY_SPEED : ROBOT_MAX_SPEED;
  const dx = move.x * scale * speed * dt, dz = move.z * scale * speed * dt;
  const beforeX = robot.x, beforeZ = robot.z;
  // Sliding along either axis prevents walls from trapping a moving robot at a corner.
  if (validRobot(state, robot, robot.x + dx, robot.z + dz)) { robot.x += dx; robot.z += dz; }
  else {
    if (validRobot(state, robot, robot.x + dx, robot.z)) robot.x += dx;
    if (validRobot(state, robot, robot.x, robot.z + dz)) robot.z += dz;
  }
  robot.vx = (robot.x - beforeX) / dt;
  robot.vz = (robot.z - beforeZ) / dt;
  if (robot.carrying) {
    const crate = state.crates.find(c => c.id === robot.carrying);
    if (crate) Object.assign(crate, cratePosition(robot, crate));
  }
}
function fire(state: DuelState, robot: DuelRobot) {
  if (robot.cooldown > 0 || robot.carrying || robot.hp <= 0) return;
  const aim = robot.decision.aim;
  const dx = aim.x - robot.x, dz = aim.z - robot.z, length = Math.hypot(dx, dz);
  if (length < 0.01) return;
  robot.decision.power = 1;
  state.projectiles.push({ id: state.nextId++, owner: robot.id, x: robot.x + dx / length * 0.6, z: robot.z + dz / length * 0.6, vx: dx / length * PROJECTILE_SPEED, vz: dz / length * PROJECTILE_SPEED, radius: PROJECTILE_RADIUS, damage: PROJECTILE_DAMAGE, life: 7.5, bounces: 0, traveled: 0, trail: [] });
  robot.shots++;
  robot.shotFlash = 0.14;
  robot.cooldown = SHOT_COOLDOWN;
  emit(state, 'shot', robot.id, robot, robot.name + ' %100 güçle ateş etti.');
}

function advanceShot(state: DuelState, shot: DuelProjectile, dt: number): boolean {
  shot.life -= dt;
  shot.trail.push({ x: shot.x, z: shot.z });
  if (shot.trail.length > 8) shot.trail.shift();
  let remaining = dt;
  shot.traveled ??= 0;
  for (let attempt = 0; attempt < 5 && remaining > EPS; attempt++) {
    const speed = Math.hypot(shot.vx, shot.vz);
    if (speed < EPS || shot.traveled >= PROJECTILE_RANGE - EPS) return false;
    const travelTime = Math.min(remaining, (PROJECTILE_RANGE - shot.traveled) / speed);
    const dx = shot.vx * travelTime, dz = shot.vz * travelTime;
    let earliest = 1 + EPS;
    let collision: Collision | null = null;
    let obstacle: DuelWall | DuelCrate | DuelRobot | null = null;
    for (const wall of state.walls) {
      if (wall.kind !== 'bounce') continue;
      const hit = sweepBox(shot, dx, dz, wall, shot.radius);
      if (hit && hit.t < earliest) { earliest = hit.t; collision = hit; obstacle = wall; }
    }
    for (const crate of state.crates) {
      if (crate.hp <= 0) continue;
      const hit = sweepBox(shot, dx, dz, crate, shot.radius);
      if (hit && hit.t < earliest) { earliest = hit.t; collision = hit; obstacle = crate; }
    }
    const enemy = state.robots[(1 - shot.owner) as Side];
    const t = sweepCircle(shot, dx, dz, enemy, COURT.robotRadius + shot.radius);
    if (t !== null && t < earliest) { earliest = t; obstacle = enemy; collision = null; }
    if (!obstacle) { shot.x += dx; shot.z += dz; shot.traveled += speed * travelTime; break; }
    shot.x += dx * earliest;
    shot.z += dz * earliest;
    shot.traveled += speed * travelTime * earliest;
    if ('kind' in obstacle) {
      if (!collision || shot.bounces >= 64) return false;
      if (collision.nx) shot.vx *= -1;
      if (collision.nz) shot.vz *= -1;
      shot.x += collision.nx * 0.002;
      shot.z += collision.nz * 0.002;
      shot.bounces++;
      shot.damage *= 0.94;
      emit(state, 'bounce', shot.owner, shot, 'Taş yansıtıcı duvardan sekti.');
      remaining -= travelTime * earliest;
    } else if ('carriedBy' in obstacle) {
      obstacle.hp = Math.max(0, obstacle.hp - shot.damage);
      emit(state, obstacle.hp === 0 ? 'destroy' : 'cover', shot.owner, obstacle, obstacle.hp === 0 ? 'Siper parçalandı; atış hattı açıldı.' : 'Kutu atışı soğurdu.');
      if (obstacle.hp === 0 && obstacle.carriedBy !== null) state.robots[obstacle.carriedBy].carrying = null;
      return false;
    } else {
      const dealt = Math.min(obstacle.hp, shot.damage);
      obstacle.hp = Math.max(0, obstacle.hp - dealt);
      obstacle.hitFlash = 0.25;
      state.robots[shot.owner].hits++;
      state.robots[shot.owner].damage += dealt;
      emit(state, 'hit', shot.owner, obstacle, obstacle.name + ' ' + Math.round(dealt) + ' hasar aldı.');
      return false;
    }
  }
  return shot.life > 0 && shot.traveled < PROJECTILE_RANGE - EPS;
}

function tick(state: DuelState, data: Runtime, manual: ManualInput | undefined) {
  state.time += STEP;
  for (const robot of state.robots) {
    robot.cooldown = Math.max(0, robot.cooldown - STEP);
    robot.hitFlash = Math.max(0, robot.hitFlash - STEP);
    robot.shotFlash = Math.max(0, robot.shotFlash - STEP);
    robot.thinkIn -= STEP;
    if (robot.id === 0 && manual) {
      robot.decision.aim = { x: finite(manual.aim.x, 8), z: finite(manual.aim.z) };
      robot.decision.power = 1;
      robot.decision.action = robot.carrying ? 'Siper taşıyor' : 'Manuel kontrol';
      robot.decision.reason = 'Hareket, nişan ve siper oyuncu tarafından yönetiliyor. Atışlar %100 güçte.';
      moveRobot(state, robot, { x: finite(manual.move.x), z: finite(manual.move.z) }, STEP);
      robot.decision.target = { x: robot.x + finite(manual.move.x), z: robot.z + finite(manual.move.z) };
      if (data.interactPending) { interact(state, robot); data.interactPending = false; }
      if (manual.fire) fire(state, robot);
    } else {
      if (robot.thinkIn <= 0) { think(state, robot, data.brains[robot.id]); robot.thinkIn += 0.15; }
      const target = robot.decision.target;
      const dx = target.x - robot.x, dz = target.z - robot.z;
      const length = Math.hypot(dx, dz);
      moveRobot(state, robot, length > 0.06 ? { x: dx / Math.max(1, length), z: dz / Math.max(1, length) } : { x: 0, z: 0 }, STEP);
      // A planned bank deliberately intersects a bounce wall. Only friendly cover
      // vetoes firing here; wall contact itself is part of the aiming decision.
      const aim = robot.decision.aim;
      const friendlyCover = state.crates.some(c => c.owner === robot.id && c.hp > 0 && sweepBox(robot, aim.x - robot.x, aim.z - robot.z, c, PROJECTILE_RADIUS));
      if (!friendlyCover) fire(state, robot);
    }
    robot.angle = Math.atan2(robot.decision.aim.x - robot.x, robot.decision.aim.z - robot.z);
  }
  state.projectiles = state.projectiles.filter(shot => advanceShot(state, shot, STEP));
  state.crates = state.crates.filter(c => c.hp > 0);
  const dead0 = state.robots[0].hp <= 0, dead1 = state.robots[1].hp <= 0;
  if (dead0 || dead1) {
    state.phase = 'finished';
    state.winner = dead0 && dead1 ? 'draw' : dead0 ? 1 : 0;
    state.robots.forEach(robot => { robot.vx = 0; robot.vz = 0; robot.decision.action = 'Düello bitti'; robot.decision.reason = state.winner === 'draw' ? 'İki robotun da enerjisi tükendi.' : state.winner === robot.id ? 'Rakibin enerjisi tükendi. Zafer!' : 'Enerji tükendi. Yeni bir taktik deneyebilirsin.'; });
    emit(state, 'win', state.winner === 'draw' ? 0 : state.winner!, { x: 0, z: 0 }, state.winner === 'draw' ? 'Berabere!' : `${state.robots[state.winner!].name} kazandı!`);
  }
}

/** Advance by real seconds. A long frame is capped; fixed substeps keep fast shots reliable. */
export function stepDuel(state: DuelState, dt: number, manual?: ManualInput): void {
  if (state.phase !== 'running' || !Number.isFinite(dt) || dt <= 0) return;
  const data = runtime(state);
  if (manual?.interact && !data.interactHeld) data.interactPending = true;
  data.interactHeld = Boolean(manual?.interact);
  data.remainder += Math.min(dt, 0.1);
  while (data.remainder + EPS * 0.01 >= STEP && state.phase === 'running') {
    data.remainder -= STEP;
    tick(state, data, manual);
  }
}
