export type Side = 0 | 1;
export type Strategy = 'balanced' | 'aggressive' | 'defensive';
export type CourtLayout = 'classic' | 'ricochet' | 'open';
export type DuelPhase = 'ready' | 'running' | 'paused' | 'finished';
export interface Vec2 { x: number; z: number }
export interface DuelDecision {
  action: string;
  reason: string;
  aim: Vec2;
  power: number;
  target: Vec2;
}
export interface DuelRobot extends Vec2 {
  id: Side;
  name: string;
  hp: number;
  maxHp: number;
  vx: number;
  vz: number;
  angle: number;
  cooldown: number;
  carrying: string | null;
  strategy: Strategy;
  decision: DuelDecision;
  shots: number;
  hits: number;
  damage: number;
  hitFlash: number;
  shotFlash: number;
  thinkIn: number;
}
export interface DuelWall extends Vec2 {
  id: string;
  width: number;
  depth: number;
  kind: 'bounce' | 'phase';
}
export interface DuelCrate extends Vec2 {
  id: string;
  owner: Side;
  size: number;
  hp: number;
  maxHp: number;
  carriedBy: Side | null;
}
export interface DuelProjectile extends Vec2 {
  id: number;
  owner: Side;
  vx: number;
  vz: number;
  radius: number;
  damage: number;
  life: number;
  bounces: number;
  traveled?: number;
  trail: Vec2[];
}
export interface DuelEvent extends Vec2 {
  id: number;
  kind: 'shot' | 'hit' | 'bounce' | 'cover' | 'destroy' | 'win';
  side: Side;
  text: string;
  time: number;
}
export interface DuelState {
  seed: number;
  time: number;
  phase: DuelPhase;
  layout: CourtLayout;
  robots: [DuelRobot, DuelRobot];
  walls: DuelWall[];
  crates: DuelCrate[];
  projectiles: DuelProjectile[];
  events: DuelEvent[];
  winner: Side | 'draw' | null;
  nextId: number;
}
export interface ManualInput {
  move: Vec2;
  aim: Vec2;
  power: number;
  fire: boolean;
  interact: boolean;
}
export const COURT = { width: 30, depth: 18, halfWidth: 15, halfDepth: 9, robotRadius: 0.44, maxHp: 240 } as const;
export const STRATEGIES: Record<Strategy, { label: string; description: string }> = {
  balanced: { label: 'Dengeli', description: 'Atış, kaçış ve siperi birlikte değerlendirir.' },
  aggressive: { label: 'Hücum', description: 'Öne çıkar, hızlı ve güçlü atışlar arar.' },
  defensive: { label: 'Savunma', description: 'Siper kurar, tehlikeden kaçar ve fırsat kollar.' },
};
export const LAYOUTS: Record<CourtLayout, { label: string; description: string }> = {
  classic: { label: 'Arena 01', description: 'Dengeli arena' },
  ricochet: { label: 'Arena 02', description: 'Sekme koridorları' },
  open: { label: 'Arena 03', description: 'Açık mücadele' },
};
