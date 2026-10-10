import { LOAD_TIER, LoadTicket, loadPriority } from './asset-load-queue.js';

/** Horizontal distances (metres) from the local focus. The world fogs out at
 * 118 m and streams scenery within 125 m; players are drawn within 95 m of the
 * focus and enemies within 75 m of the camera. Travel is at most ~7 m/s (boats),
 * so the 30 m between `admit` and `prefetch` gives an approaching actor more
 * than four seconds to load before it can be drawn. */
export const RESIDENCY = Object.freeze({
  /** Interaction and combat range: these actors load ahead of scenery. */
  near: 40,
  /** The player draw range: foreground loads, nearest first. */
  admit: 95,
  /** The streaming radius: actors approaching the draw range load one at a time. */
  prefetch: 125,
  /** A loading or resident actor is kept until it is farther than this. */
  retain: 140,
  /** A resident actor outside `retain` this long is released, as regional scenery is. */
  graceSeconds: 12,
});

export type ResidencyState = 'absent' | 'loading' | 'resident';
export type ResidencyAction = 'load' | 'cancel' | 'evict' | null;

/** Kept on each player/enemy state holder. Only the render actor comes and goes;
 * the holder and its state stay for gameplay, the map and targeting. */
export class ActorResidency {
  state: ResidencyState = 'absent';
  ticket: LoadTicket | null = null;
  /** Identifies the current load; cleared whenever the actor is released. */
  token: object | null = null;
  lastWanted = -Infinity;
}

/** Load priority for an actor this far away, or null when it should not be
 * resident. A loading or resident (`holding`) actor stays until `retain`. */
export function residencyPriority(
  distance: number,
  essential: boolean,
  holding: boolean,
): number | null {
  if (essential) return loadPriority(LOAD_TIER.essential);
  if (!(distance <= (holding ? RESIDENCY.retain : RESIDENCY.prefetch))) return null;
  if (distance <= RESIDENCY.near) return loadPriority(LOAD_TIER.near, distance);
  if (distance <= RESIDENCY.admit) return loadPriority(LOAD_TIER.visible, distance);
  return loadPriority(LOAD_TIER.prefetch, distance);
}

type CarryState = { id: string; carrierId?: string | null; passengerId?: string | null };

/** Players drawn at any distance: the local player and its carry partners. */
export function essentialActorIds(
  players: readonly CarryState[],
  selfId: string | null | undefined,
): Set<string> {
  const ids = new Set<string>();
  const self = players.find((p) => p.id === selfId);
  if (!self) return ids;
  ids.add(self.id);
  if (self.carrierId) ids.add(self.carrierId);
  if (self.passengerId) ids.add(self.passengerId);
  for (const p of players) if (p.carrierId === self.id) ids.add(p.id);
  return ids;
}

/** Advance one holder for this frame; the caller performs the returned action.
 * A wanted holder starts loading with a fresh ticket and token; an unfinished
 * load beyond `retain` is cancelled at once; a resident actor beyond `retain`
 * is evicted after the grace period. */
export function stepResidency(
  record: ActorResidency,
  priority: number | null,
  time: number,
): ResidencyAction {
  if (priority !== null) {
    record.lastWanted = time;
    if (record.state === 'absent') {
      record.state = 'loading';
      record.ticket = new LoadTicket(priority);
      record.token = {};
      return 'load';
    }
    if (record.ticket) record.ticket.priority = priority;
    return null;
  }
  if (record.state === 'loading') return 'cancel';
  if (record.state === 'resident' && time - record.lastWanted >= RESIDENCY.graceSeconds)
    return 'evict';
  return null;
}

/** The load for `token` attached its actor. False when that load is stale: a
 * released holder (null token) can never become resident. */
export function residencyAttached(record: ActorResidency, token: object | null | undefined) {
  if (!token || record.token !== token) return false;
  record.state = 'resident';
  record.ticket?.release();
  record.ticket = null;
  return true;
}

/** Forget the actor and any unfinished load; late results become stale. */
export function releaseResidency(record: ActorResidency) {
  record.ticket?.release();
  record.ticket = null;
  record.token = null;
  record.state = 'absent';
}
