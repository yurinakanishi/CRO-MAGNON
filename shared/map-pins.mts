import { WORLD_BOUNDS as WORLD } from './world-bounds.mjs';

export const MAP_PIN_LIFETIME_MS = 5 * 60 * 1000;
export const MAP_PIN_COOLDOWN_MS = 1500;
export interface MapPin {
  id: string;
  ownerId: string;
  name: string;
  color: string;
  x: number;
  z: number;
  expiresAt: number;
}
export function validMapPinPoint(x: unknown, z: unknown): boolean {
  return (
    typeof x === 'number' &&
    Number.isFinite(x) &&
    typeof z === 'number' &&
    Number.isFinite(z) &&
    x >= WORLD.minX &&
    x <= WORLD.maxX &&
    z >= WORLD.minZ &&
    z <= WORLD.maxZ
  );
}

export function activeMapPins(
  room: { mapPins?: MapPin[]; players: { has(id: string): boolean } },
  now: number,
): MapPin[] {
  return (room.mapPins ?? []).filter(
    (pin: MapPin) => pin.expiresAt > now && room.players.has(pin.ownerId),
  );
}
