export interface BarterOffer {
  item: string;
  quantity: number;
}
export interface BarterSnapshot {
  id: string;
  players: [string, string];
  offers: [BarterOffer | null, BarterOffer | null];
  accepted: [boolean, boolean];
  revision: number;
  status: 'invited' | 'open' | 'complete' | 'cancelled';
  expiresAt: number;
  reason: string;
}
export type BarterCommand =
  | { type: 'barter'; kind: 'invite'; targetId: string }
  | { type: 'barter'; kind: 'cancel'; tradeId?: string }
  | { type: 'barter'; kind: 'join' | 'accept'; tradeId: string; revision: number }
  | {
      type: 'barter';
      kind: 'offer';
      tradeId: string;
      revision: number;
      item: string;
      quantity: number;
    };
