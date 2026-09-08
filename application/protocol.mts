export type ClientCommand =
  | { type: 'leave' }
  | { type: 'move'; dx: number; dz: number; running?: boolean }
  | { type: 'gait'; running: boolean }
  | { type: 'target'; x: number; z: number; running?: boolean }
  | { type: 'expedition'; destination: string }
  | { type: 'action'; action: string; targetId?: string; regionId?: string }
  | { type: 'chat'; text: string }
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
    case 'leave':
      return { type: 'leave' };
    case 'move':
      return finite(message.dx) && finite(message.dz)
        ? { type: 'move', dx: message.dx, dz: message.dz, running: message.running === true }
        : null;
    case 'gait':
      return typeof message.running === 'boolean'
        ? { type: 'gait', running: message.running }
        : null;
    case 'target':
      return finite(message.x) && finite(message.z)
        ? { type: 'target', x: message.x, z: message.z, running: message.running === true }
        : null;
    case 'expedition':
      return typeof message.destination === 'string'
        ? { type: 'expedition', destination: message.destination }
        : null;
    case 'action':
      return typeof message.action === 'string'
        ? {
            type: 'action',
            action: message.action,
            targetId: typeof message.targetId === 'string' ? message.targetId : undefined,
            regionId: typeof message.regionId === 'string' ? message.regionId : undefined,
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
