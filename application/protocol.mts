import type { BarterCommand } from '../shared/barter-types.mjs';
import { validMapPinPoint } from '../shared/map-pins.mjs';
export type ClientCommand =
  | BarterCommand
  | { type: 'leave'; keepSession?: boolean }
  | { type: 'move'; dx: number; dz: number; running?: boolean }
  | { type: 'gait'; running: boolean }
  | { type: 'action'; action: string; targetId?: string; regionId?: string; cropId?: string }
  | { type: 'chat'; text: string }
  | { type: 'mapPin'; x: number; z: number }
  | { type: 'clearMapPin' }
  | { type: 'ping'; at: number | string };

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** JSON is untrusted until its discriminant and payload have been checked. */
export function decodeCommand(text: string): ClientCommand | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  switch (message.type) {
    case 'mapPin':
      return validMapPinPoint(message.x, message.z)
        ? { type: 'mapPin', x: message.x as number, z: message.z as number }
        : null;
    case 'clearMapPin':
      return { type: 'clearMapPin' };
    case 'barter': {
      const id = (v: unknown): v is string =>
        typeof v === 'string' && v.length > 0 && v.length <= 80;
      if (message.kind === 'invite')
        return id(message.targetId)
          ? { type: 'barter', kind: 'invite', targetId: message.targetId }
          : null;
      if (message.kind === 'cancel')
        return message.tradeId === undefined || id(message.tradeId)
          ? {
              type: 'barter',
              kind: 'cancel',
              ...(message.tradeId === undefined ? {} : { tradeId: message.tradeId as string }),
            }
          : null;
      if (
        !id(message.tradeId) ||
        !finite(message.revision) ||
        !Number.isSafeInteger(message.revision) ||
        message.revision < 0
      )
        return null;
      if (message.kind === 'join' || message.kind === 'accept')
        return {
          type: 'barter',
          kind: message.kind,
          tradeId: message.tradeId,
          revision: message.revision,
        };
      if (
        message.kind === 'offer' &&
        typeof message.item === 'string' &&
        message.item.length <= 24 &&
        finite(message.quantity) &&
        Number.isSafeInteger(message.quantity) &&
        message.quantity >= 1 &&
        message.quantity <= 20
      )
        return {
          type: 'barter',
          kind: 'offer',
          tradeId: message.tradeId,
          revision: message.revision,
          item: message.item,
          quantity: message.quantity,
        };
      return null;
    }
    case 'leave':
      return { type: 'leave', ...(message.keepSession === true ? { keepSession: true } : {}) };
    case 'move':
      return finite(message.dx) && finite(message.dz)
        ? { type: 'move', dx: message.dx, dz: message.dz, running: message.running === true }
        : null;
    case 'gait':
      return typeof message.running === 'boolean'
        ? { type: 'gait', running: message.running }
        : null;
    case 'action':
      if (
        message.cropId !== undefined &&
        (typeof message.cropId !== 'string' || message.cropId.length > 24)
      )
        return null;
      return typeof message.action === 'string'
        ? {
            type: 'action',
            action: message.action,
            targetId: typeof message.targetId === 'string' ? message.targetId : undefined,
            regionId: typeof message.regionId === 'string' ? message.regionId : undefined,
            ...(message.cropId === undefined ? {} : { cropId: message.cropId as string }),
          }
        : null;
    case 'chat':
      return typeof message.text === 'string' ? { type: 'chat', text: message.text } : null;
    case 'ping':
      return typeof message.at === 'string' || finite(message.at)
        ? { type: 'ping', at: message.at }
        : null;
    default:
      return null;
  }
}
