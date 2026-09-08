/** Platform-independent values shared by simulation and presentation. */
export interface Point {
  x: number;
  z: number;
}
export type Species = 'cro' | 'nea' | 'cat' | 'bear';
export type Gender = 'female' | 'male';
export type ResourceKind = 'wood' | 'stone' | 'berry' | 'obsidian';
export interface CharacterProfile {
  species?: unknown;
  gender?: unknown;
  spearHead?: 'wood' | 'obsidian';
}
export interface CharacterModel {
  species: Species;
  gender: Gender;
  key: string;
  name: string;
  weapon?: 'katana' | 'magic';
  height?: number;
  radius?: number;
  walkSpeed?: number;
  runSpeed?: number;
}
export interface Resource extends Point {
  id: string;
  type: ResourceKind;
  amount: number;
  maxAmount: number;
  regeneratedAt?: number;
  regionId?: string;
  appearanceBiome?: string;
}
export interface Inventory {
  rawShellfish?: number;
  cookedShellfish?: number;
  shells?: number;
  obsidianBlade?: number;
  rawFish?: number;
  cookedFish?: number;
  obsidian?: number;
  seed?: number;
  water?: number;
  wood: number;
  stone: number;
  berry: number;
  rawMeat: number;
  cookedMeat: number;
}
export interface SceneryPlacement extends Point {
  key: string;
  id?: string;
  yaw: number;
  scale: number | number[];
  biome?: string;
  surface?: string;
  height?: number;
}
export interface Obstacle extends Point {
  id?: string;
  middenId?: string;
  resourceId?: string;
  type: string;
  radius?: number;
  hx?: number;
  hz?: number;
  c?: number;
  s?: number;
  height?: number;
  groundX?: number;
  groundZ?: number;
  groundOffset?: number;
}
export interface EnemyGround extends Point {
  id: string;
  radius: number;
  roamRadius: number;
  name?: string;
  regionId?: string;
  maxHealth?: number;
}
export interface Rift extends Point {
  id: string;
  name: string;
  destination: string;
  exit?: boolean;
}
export interface MovableActor extends Point, CharacterProfile {
  radius: number;
  dx: number;
  dz: number;
  speed: number;
  facing: number;
  target: Point | null;
  path: Point[];
  lastInput: number;
  moving: boolean;
  running: boolean;
  runningRequested: boolean;
  navigationGoal?: Point | null;
  navigationEnd?: Point | null;
  nextNavigationAt?: number;
}
