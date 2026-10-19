export type Action = 0 | 1 | 2 | 3 | 4 | 5;
export type Direction = 0 | 1 | 2 | 3;
export interface Position { x: number; z: number }
export interface Crate extends Position { id: string; kind: 'amber' | 'cyan' }
export interface Switch extends Position { id: string; on: boolean; mode: 'toggle' | 'pressure' | 'sequence'; sequenceId?: string }
export interface Door extends Position { id: string; open: boolean; requires: string[]; logic?: 'and' | 'or'; inverted?: boolean }
export interface Surface extends Position { kind: 'ice' | 'conveyor'; direction?: Direction }
export interface SequenceDefinition { id: string; switchIds: string[] }
export interface Goal extends Position { kind: 'amber' | 'cyan' | 'exit' }
export interface Level {
  id: string; title: string; subtitle: string; chapter: number; difficulty: number;
  width: number; height: number; tiles: string[]; start: Position; facing: Direction;
  crates: Crate[]; switches: Switch[]; doors: Door[]; goals: Goal[];
  par: number; description: string; seed?: number; surprise?: string;
  surfaces?: Surface[]; sequences?: SequenceDefinition[];
  sourceLevelId?: string; variantKind?: 'start' | 'layout'; variantChanges?: string[];
}
export interface GameState {
  level: Level;
  robot: Position & { facing: Direction; carrying: string | null };
  crates: Crate[]; switches: Switch[]; doors: Door[];
  moves: number; interactions: number; solved: boolean; tick: number;
  lastAction: Action; lastEvent: string;
  sequenceProgress?: Record<string, number>;
}
export const ACTION_NAMES = ['Yukarı', 'Sağ', 'Aşağı', 'Sol', 'Etkileşim', 'Bekle'] as const;
export const ACTION_KEYS = ['↑', '→', '↓', '←', 'E', '·'] as const;
export const DELTAS: Position[] = [{ x: 0, z: -1 }, { x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }];
export const MODEL_INPUTS = 160;
export const MODEL_HIDDEN = 96;
export const MODEL_OUTPUTS = 6;
export const MODEL_VERSION = 'noema-160-96-gru96-64-6-v3';
