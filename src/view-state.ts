import type { GameSnapshot as Snapshot } from '../shared/snapshots.mjs';
import type { Resource } from '../shared/types.mjs';

/** The browser receives a full world once, then merges incremental snapshots. */
export type ViewState = Omit<Partial<Snapshot>, 'resources'> & {
  players: Snapshot['players'];
  resources: readonly Resource[];
  camp: Snapshot['camp'];
  npc: Snapshot['npc'];
};
