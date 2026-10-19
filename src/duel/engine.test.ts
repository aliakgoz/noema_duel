import { describe, expect, it } from 'vitest';
import { createDuel, predictIntercept, PROJECTILE_RADIUS, PROJECTILE_RANGE, SHOT_COOLDOWN, ROBOT_MAX_SPEED, setStrategy, shotSpeedForPower, startDuel, stepDuel, togglePause } from './engine';
import { COURT, type CourtLayout, type DuelProjectile, type DuelState, type ManualInput, type Strategy } from './types';

const idle: ManualInput = { move: { x: 0, z: 0 }, aim: { x: 8, z: 0 }, power: 1, fire: false, interact: false };
function simulate(state: DuelState, seconds: number, input?: ManualInput) {
  for (let i = 0; i < Math.round(seconds * 120) && state.phase === 'running'; i++) stepDuel(state, 1 / 120, input);
}
function isolated(): DuelState {
  const state = createDuel('open');
  state.walls = [];
  state.crates = [];
  state.robots.forEach(robot => {
    robot.cooldown = 1000;
    robot.thinkIn = 1000;
    robot.decision.target = { x: robot.x, z: robot.z };
  });
  startDuel(state);
  return state;
}
function shot(overrides: Partial<DuelProjectile> = {}): DuelProjectile {
  return { id: 100, owner: 0, x: -2, z: 0, vx: 90, vz: 0, radius: PROJECTILE_RADIUS, damage: 25, life: 7.5, bounces: 0, trail: [], ...overrides };
}

describe('robot duel physics and lifecycle', () => {
  it('expires every projectile after45m of actual flight regardless of power', () => {
    for (const power of [.15, .5, 1]) {
      const state = isolated(), projectile = shot({ x: 0, z: -5, vx: shotSpeedForPower(power), life: 7.5 });
      state.projectiles = [projectile];
      simulate(state, PROJECTILE_RANGE / shotSpeedForPower(power) + .05, idle);
      expect(state.projectiles).toHaveLength(0);
      expect(projectile.traveled).toBeCloseTo(45, 7);
      expect(projectile.x).toBeCloseTo(45, 7);
    }
  });

  it('counts ricochet segments towards the same45m range', () => {
    const state = isolated();
    state.walls = [{ id: 'right', x: 3, z: -5, width: .2, depth: 3, kind: 'bounce' }, { id: 'left', x: -3, z: -5, width: .2, depth: 3, kind: 'bounce' }];
    const projectile = shot({ x: 0, z: -5, vx: 15, life: 7.5 }); state.projectiles = [projectile];
    simulate(state, 3.1, idle);
    expect(state.projectiles).toHaveLength(0);
    expect(projectile.traveled).toBeCloseTo(45, 6);
    expect(projectile.bounces).toBeGreaterThan(5);
    expect(Math.abs(projectile.x)).toBeLessThan(3);
  });

  it('allows another airborne shot only after the1.25s reload interval', () => {
    const state = isolated(); state.robots[0].cooldown = 0;
    const input = { ...idle, aim: { x: -10, z: -20 }, fire: true };
    stepDuel(state, 1 / 120, input);
    expect(state.robots[0].shots).toBe(1);
    simulate(state, SHOT_COOLDOWN - .025, input);
    expect(state.robots[0].shots).toBe(1);
    simulate(state, .05, input);
    expect(state.robots[0].shots).toBe(2);
    expect(state.projectiles.filter(projectile => projectile.owner === 0)).toHaveLength(2);
  });
  it('keeps each robot inside its own half while manual movement slides along limits', () => {
    const state = isolated();
    simulate(state, 8, { ...idle, move: { x: 1, z: 1 } });
    expect(state.robots[0].x).toBeLessThanOrEqual(-COURT.robotRadius);
    expect(state.robots[0].x).toBeGreaterThan(-0.5);
    expect(state.robots[0].z).toBeLessThanOrEqual(COURT.halfDepth - COURT.robotRadius);
    state.robots[1].decision.target = { x: -10, z: -15 };
    simulate(state, 8, idle);
    expect(state.robots[1].x).toBeGreaterThanOrEqual(COURT.robotRadius);
    expect(state.robots[1].z).toBeGreaterThanOrEqual(-COURT.halfDepth + COURT.robotRadius);
  });

  it('sweeps fast shots against reflecting walls, while phase walls let the same shot through', () => {
    const bounce = isolated(), phase = isolated();
    bounce.walls = [{ id: 'wall', x: 0, z: 0, width: 0.3, depth: 5, kind: 'bounce' }];
    phase.walls = [{ ...bounce.walls[0], kind: 'phase' }];
    bounce.projectiles.push(shot());
    phase.projectiles.push(shot());
    stepDuel(bounce, 0.025, idle);
    stepDuel(phase, 0.025, idle);
    expect(bounce.projectiles[0].bounces).toBe(1);
    expect(bounce.projectiles[0].vx).toBeLessThan(0);
    expect(phase.projectiles[0].bounces).toBe(0);
    expect(phase.projectiles[0].x).toBeGreaterThan(0);
  });

  it('handles several wall reflections within a single frame without tunneling', () => {
    const state = isolated();
    state.walls = [
      { id: 'left', x: -1, z: 0, width: 0.2, depth: 3, kind: 'bounce' },
      { id: 'right', x: 1, z: 0, width: 0.2, depth: 3, kind: 'bounce' },
    ];
    state.projectiles.push(shot({ x: 0, vx: 500 }));
    stepDuel(state, 1 / 120, idle);
    expect(state.projectiles).toHaveLength(1);
    expect(state.projectiles[0].bounces).toBeGreaterThanOrEqual(2);
    expect(Math.abs(state.projectiles[0].x)).toBeLessThan(0.76);
  });

  it('lets shots cross the divider and leave through an unprotected boundary', () => {
    const state = isolated();
    state.projectiles.push(shot({ x: -0.1, z: 0, vx: 90 }));
    stepDuel(state, 1 / 120, idle);
    expect(state.projectiles[0].x).toBeGreaterThan(0);
    expect(state.projectiles[0].bounces).toBe(0);
    state.projectiles[0].z = COURT.halfDepth - 0.2;
    state.projectiles[0].vx = 0;
    state.projectiles[0].vz = 90;
    simulate(state, 0.1, idle);
    expect(state.projectiles[0].z).toBeGreaterThan(COURT.halfDepth);
    expect(state.events.some(event => event.kind === 'bounce')).toBe(false);
    simulate(state, 1, idle);
    expect(state.projectiles).toHaveLength(0);
  });

  it('blocks robot movement on both wall materials', () => {
    for (const kind of ['bounce', 'phase'] as const) {
      const state = isolated();
      state.robots[0].x = -5;
      state.robots[0].z = 0;
      state.walls = [{ id: 'wall', x: -3, z: 0, width: 0.3, depth: 6, kind }];
      simulate(state, 2, { ...idle, move: { x: 1, z: 0 } });
      expect(state.robots[0].x).toBeLessThan(-3.58);
    }
  });

  it('absorbs projectile damage in cover and removes a destroyed crate', () => {
    const state = isolated();
    state.crates = [{ id: 'cover', owner: 1, x: 2, z: 0, size: 1, hp: 40, maxHp: 40, carriedBy: null }];
    state.projectiles.push(shot({ x: 0, vx: 240 }));
    stepDuel(state, 0.025, idle);
    expect(state.crates[0].hp).toBe(15);
    expect(state.projectiles).toHaveLength(0);
    state.projectiles.push(shot({ x: 0, vx: 240 }));
    stepDuel(state, 0.025, idle);
    expect(state.crates).toHaveLength(0);
    expect(state.events.some(event => event.kind === 'destroy')).toBe(true);
  });

  it('picks up only owned cover, carries it to a valid place and drops on a fresh interaction', () => {
    const state = isolated();
    Object.assign(state.robots[0], { x: -6, z: 0 });
    state.crates = [{ id: 'mine', owner: 0, x: -4.8, z: 0, size: 1, hp: 50, maxHp: 50, carriedBy: null }];
    stepDuel(state, 1 / 120, { ...idle, interact: true });
    expect(state.robots[0].carrying).toBe('mine');
    simulate(state, 1, { ...idle, interact: true, move: { x: 0, z: 1 } });
    expect(state.crates[0].z).toBeGreaterThan(2);
    expect(state.robots[0].carrying).toBe('mine');
    stepDuel(state, 1 / 120, idle);
    stepDuel(state, 1 / 120, { ...idle, interact: true });
    expect(state.robots[0].carrying).toBeNull();
    expect(state.crates[0].carriedBy).toBeNull();
    expect(state.crates[0].x + state.crates[0].size / 2).toBeLessThan(0);
    state.crates[0].owner = 1;
    stepDuel(state, 1 / 120, idle);
    stepDuel(state, 1 / 120, { ...idle, interact: true });
    expect(state.robots[0].carrying).toBeNull();
  });

  it('retains a brief manual interaction even when no physics tick occurs in its frame', () => {
    const state = isolated();
    Object.assign(state.robots[0], { x: -6, z: 0 });
    state.crates = [{ id: 'mine', owner: 0, x: -4.8, z: 0, size: 1, hp: 50, maxHp: 50, carriedBy: null }];
    stepDuel(state, 0.002, { ...idle, interact: true });
    expect(state.robots[0].carrying).toBeNull();
    stepDuel(state, 0.007, idle);
    expect(state.robots[0].carrying).toBe('mine');
  });

  it('never substitutes automatic movement or firing while a manual policy is supplied', () => {
    const state = createDuel();
    const initial = { x: state.robots[0].x, z: state.robots[0].z };
    startDuel(state);
    simulate(state, 5, idle);
    expect(state.robots[0].x).toBe(initial.x);
    expect(state.robots[0].z).toBe(initial.z);
    expect(state.robots[0].carrying).toBeNull();
    expect(state.robots[0].shots).toBe(0);
    expect(state.robots[1].shots).toBeGreaterThan(0);
  });

  it('announces a winner only after health reaches zero and freezes a finished match', () => {
    const state = isolated();
    state.robots[1].x = 3;
    state.robots[1].z = 0;
    state.robots[1].decision.target = { x: 3, z: 0 };
    state.robots[1].hp = 10;
    state.projectiles.push(shot({ x: 1, vx: 180 }));
    stepDuel(state, 0.025, idle);
    expect(state.phase).toBe('finished');
    expect(state.winner).toBe(0);
    expect(state.robots[1].hp).toBe(0);
    const snapshot = JSON.stringify(state);
    stepDuel(state, 0.1, idle);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('resolves simultaneous lethal shots as a draw', () => {
    const state = isolated();
    Object.assign(state.robots[0], { x: -3, z: 0, hp: 10 });
    Object.assign(state.robots[1], { x: 3, z: 0, hp: 10 });
    state.robots.forEach(robot => { robot.decision.target = { x: robot.x, z: robot.z }; });
    state.projectiles.push(shot({ x: 2.4, vx: 180 }), shot({ id: 101, owner: 1, x: -2.4, vx: -180 }));
    stepDuel(state, 1 / 120, idle);
    expect(state.winner).toBe('draw');
    expect(state.robots.every(robot => robot.hp === 0)).toBe(true);
  });

  it('keeps ready/paused matches frozen and caps invalid or stalled frame durations', () => {
    const state = createDuel();
    stepDuel(state, 1);
    expect(state.time).toBe(0);
    startDuel(state);
    togglePause(state);
    stepDuel(state, 1);
    expect(state.time).toBe(0);
    togglePause(state);
    stepDuel(state, Infinity);
    stepDuel(state, -1);
    expect(state.time).toBe(0);
    stepDuel(state, 10);
    expect(state.time).toBeCloseTo(0.1);
  });

  it('has deterministic fixed substeps across different frame partitions', () => {
    const a = createDuel('ricochet', 113), b = createDuel('ricochet', 113);
    startDuel(a);
    startDuel(b);
    for (let i = 0; i < 360; i++) stepDuel(a, 1 / 60);
    for (let i = 0; i < 720; i++) stepDuel(b, 1 / 120);
    expect(a).toEqual(b);
  });

  it('uses a larger30×18 court,240HP and50% faster robots', () => {
    const state = isolated();
    expect(COURT.width).toBe(30);
    expect(COURT.depth).toBe(18);
    expect(state.robots.every(robot => robot.hp === 240 && robot.maxHp === 240)).toBe(true);
    expect(Math.abs(state.robots[0].x)).toBeGreaterThan(10);
    const initialZ = state.robots[0].z;
    simulate(state, 1, { ...idle, move: { x: 0, z: 1 } });
    expect(ROBOT_MAX_SPEED).toBe(4.8);
    expect(state.robots[0].z - initialZ).toBeCloseTo(4.8);
  });

  it('always launches a full-power flat stone and leaves readable time to lead a20m target', () => {
    for (const requestedPower of [0, .15, .5, 1]) {
      const state = isolated();
      Object.assign(state.robots[0], { x: -10, z: 0, cooldown: 0 });
      Object.assign(state.robots[1], { x: 10, z: 0 });
      state.robots[1].decision.target = { x: 10, z: 0 };
      stepDuel(state, 1 / 120, { ...idle, aim: { x: 10, z: 0 }, power: requestedPower, fire: true });
      const projectile = state.projectiles[0];
      expect(shotSpeedForPower(requestedPower)).toBe(18);
      expect(Math.hypot(projectile.vx, projectile.vz)).toBeCloseTo(18);
      expect(projectile.damage).toBe(26);
      expect(state.robots[0].decision.power).toBe(1);
      expect('y' in projectile || 'vy' in projectile).toBe(false);
      state.robots[0].cooldown = 1000;
      simulate(state, .75, idle);
      expect(state.robots[1].hp).toBe(COURT.maxHp);
      simulate(state, .4, idle);
      expect(state.robots[1].hp).toBe(COURT.maxHp - 26);
    }
  });

  it('aims ahead and intercepts a moving rival instead of firing at its old position', () => {
    const state = isolated();
    Object.assign(state.robots[0], { x: -10, z: -4 });
    Object.assign(state.robots[1], { x: 10, z: 0, cooldown: 0, thinkIn: 0 });
    const manual = { ...idle, move: { x: 0, z: 1 } };
    stepDuel(state, 1 / 120, manual);
    const target = state.robots[0], shooter = state.robots[1];
    expect(target.vz).toBeCloseTo(4.8);
    expect(shooter.decision.aim.z).toBeGreaterThan(target.z + 4);
    const intercept = predictIntercept(shooter, target, 18);
    const flightTime = Math.hypot(intercept.x - shooter.x, intercept.z - shooter.z) / 18;
    expect(intercept.z).toBeCloseTo(target.z + target.vz * flightTime);
    shooter.cooldown = 1000;
    simulate(state, 2.5, manual);
    expect(target.hp).toBeLessThan(COURT.maxHp);
  });
});

describe('autonomous tactics', () => {
  it('actually picks up and rearranges cover before taking its firing positions', () => {
    const state = createDuel();
    const original = state.crates.map(c => ({ x: c.x, z: c.z }));
    startDuel(state);
    simulate(state, 3.5);
    expect(state.crates.some((crate, i) => Math.hypot(crate.x - original[i].x, crate.z - original[i].z) > 0.4)).toBe(true);
    expect(state.events.some(event => event.kind === 'cover' && event.text.includes('bıraktı'))).toBe(true);
  });

  it('executes deliberate bank shots instead of vetoing contact with the chosen wall', () => {
    const state = createDuel('ricochet', 42);
    startDuel(state);
    let sawBankPlan = false, sawBounce = false;
    for (let i = 0; i < 120 * 20 && state.phase === 'running'; i++) {
      stepDuel(state, 1 / 120);
      sawBankPlan ||= state.robots.some(robot => robot.decision.action === 'Sekmeli atış arıyor');
      sawBounce ||= state.events.some(event => event.kind === 'bounce');
    }
    expect(sawBankPlan).toBe(true);
    expect(sawBounce).toBe(true);
  });

  const layouts: CourtLayout[] = ['classic', 'ricochet', 'open'];
  const strategies: Strategy[] = ['balanced', 'aggressive', 'defensive'];
  for (const layout of layouts) for (const strategy of strategies) {
    it(`resolves a ${layout} / ${strategy} match through projectile damage`, () => {
      const state = createDuel(layout, 42);
      setStrategy(state, 0, strategy);
      setStrategy(state, 1, strategy);
      startDuel(state);
      simulate(state, 360);
      expect(state.phase, JSON.stringify({ time: state.time, robots: state.robots, crates: state.crates })).toBe('finished');
      expect(state.robots.some(robot => robot.hp === 0)).toBe(true);
      expect(state.robots.reduce((sum, robot) => sum + robot.hits, 0)).toBeGreaterThan(0);
      expect(state.events.length).toBeLessThanOrEqual(30);
      expect(state.robots[0].x).toBeLessThanOrEqual(-COURT.robotRadius);
      expect(state.robots[1].x).toBeGreaterThanOrEqual(COURT.robotRadius);
    });
  }

  for (const seed of [3, 97, 2026]) for (const layout of layouts) {
    it(`resolves mixed tactics on${layout}, seed${seed}, without leaving the court`, () => {
      const state = createDuel(layout, seed);
      setStrategy(state, 0, 'aggressive');
      setStrategy(state, 1, 'defensive');
      startDuel(state);
      for (let i = 0; i < 120 * 360 && state.phase === 'running'; i++) {
        stepDuel(state, 1 / 120);
        if (i % 30 !== 0) continue;
        for (const robot of state.robots) {
          expect(Number.isFinite(robot.x + robot.z + robot.hp)).toBe(true);
          expect(Math.abs(robot.z)).toBeLessThanOrEqual(COURT.halfDepth - COURT.robotRadius);
          expect(robot.id === 0 ? robot.x <= -COURT.robotRadius : robot.x >= COURT.robotRadius).toBe(true);
        }
        for (const crate of state.crates) {
          expect(crate.owner === 0 ? crate.x + crate.size / 2 <= 0 : crate.x - crate.size / 2 >= 0).toBe(true);
        }
      }
      expect(state.phase, `${layout}, seed ${seed}`).toBe('finished');
    });
  }
});
