import { MANY_HEARTHS } from './gulf-region.mjs';
import { pantryAvailable } from './pantry.mjs';
import { interactionVisible } from './interactions.mjs';
import { stopActor } from './combat.mjs';
import type { Inventory } from './types.mjs';
import type { BarterCommand, BarterSnapshot, BarterOffer } from './barter-types.mjs';

// Authored face-to-face agreement, not a reconstructed ancient market institution.
export const BARTER = Object.freeze({
  campReach: 22,
  reach: 4,
  maxQuantity: 20,
  lifetimeMs: 120000,
  resultMs: 10000,
  inviteGapMs: 5000,
});
export const BARTER_ITEMS: readonly { id: keyof Inventory; name: string }[] = Object.freeze([
  { id: 'obsidian', name: '黒曜石' },
  { id: 'obsidianBlade', name: '黒曜石の刃' },
  { id: 'wood', name: '木材' },
  { id: 'stone', name: '石' },
  { id: 'berry', name: 'ベリー' },
  { id: 'seed', name: 'ベリーの種' },
  { id: 'rootSeed', name: '火根草の種' },
  { id: 'herbSeed', name: '香り草の種' },
  { id: 'rawMeat', name: '生肉' },
  { id: 'cookedMeat', name: '焼き肉' },
  { id: 'rawFish', name: '生魚' },
  { id: 'cookedFish', name: '焼き魚' },
  { id: 'rawShellfish', name: '生の貝' },
  { id: 'cookedShellfish', name: '焼いた貝' },
  { id: 'shells', name: '貝殻' },
  { id: 'rawRoot', name: '火根' },
  { id: 'herb', name: '香草' },
  { id: 'cookedRoot', name: '焼き根' },
  { id: 'herbRoot', name: '香草焼き根' },
]);
export interface BarterState extends BarterSnapshot {
  createdAt: number;
  hurtSequences: [number, number];
}
export const barterActive = (t?: BarterSnapshot) =>
  !!t && (t.status === 'invited' || t.status === 'open');
export const barterFor = (trades: BarterSnapshot[] = [], id?: string) =>
  [...trades].reverse().find((t) => t.players.includes(id));
const activeFor = (room, id: string): BarterState | undefined =>
  (room.barters ?? []).find((t) => barterActive(t) && t.players.includes(id));
export function barterAvailable(p, now: number) {
  return (
    pantryAvailable(p, now) &&
    !p.moving &&
    !p.target &&
    !p.path?.length &&
    Math.hypot(p.dx ?? 0, p.dz ?? 0) < 0.01
  );
}
export function barterProblem(a, b, now: number, collision?): string {
  if (!a || !b || a.id === b.id) return '近くにいる別の旅人を選ぼう。';
  if (![a.x, a.z, b.x, b.z].every(Number.isFinite)) return '二人の位置を確認してから交換しよう。';
  if ([a, b].some((p) => Math.hypot(p.x - MANY_HEARTHS.x, p.z - MANY_HEARTHS.z) > BARTER.campReach))
    return '二人で、多くの炉の集い場へ来よう。';
  if (!barterAvailable(a, now) || !barterAvailable(b, now))
    return '二人とも地上で止まり、作業を終えてから交換しよう。';
  if (
    Math.hypot(a.x - b.x, a.z - b.z) > BARTER.reach ||
    (collision && !interactionVisible(collision, a, b))
  )
    return '相手のそばへ近づこう。間がふさがっている時は回り込もう。';
  return '';
}
export const barterOfferLabel = (offer?: BarterOffer | null) =>
  offer
    ? `${BARTER_ITEMS.find((f) => f.id === offer.item)?.name ?? '品物'} ${offer.quantity}個`
    : 'まだ提示していません';
function closeTrade(t: BarterState, status: 'complete' | 'cancelled', reason: string, now: number) {
  t.status = status;
  t.reason = reason;
  t.expiresAt = now + BARTER.resultMs;
}
export function cancelBarter(
  room,
  id: string,
  now: number,
  reason = '交換を中止しました。品物はもちものに残っています。',
) {
  const t = activeFor(room, id);
  if (!t) return false;
  closeTrade(t, 'cancelled', reason, now);
  return true;
}
export function updateBarters(room, now: number) {
  const trades: BarterState[] = room.barters ?? [];
  let changed = false;
  room.barters = trades.filter((t) => barterActive(t) || t.expiresAt > now);
  if (room.barters.length !== trades.length) changed = true;
  for (const t of room.barters as BarterState[]) {
    if (!barterActive(t)) continue;
    const ps = t.players.map((id) => room.players.get(id));
    const reason =
      now >= t.expiresAt
        ? '時間になったので交換を中止しました。品物はもちものに残っています。'
        : ps.some((p) => !p)
          ? '相手が接続を離れたので交換を中止しました。'
          : ps.some((p, i) => (p.hurtSequence ?? 0) !== t.hurtSequences[i])
            ? '攻撃を受けたので交換を中止しました。'
            : barterProblem(ps[0], ps[1], now, room.collision);
    if (reason) {
      closeTrade(t, 'cancelled', reason, now);
      changed = true;
    }
  }
  return changed;
}
export function barterSnapshots(room): BarterSnapshot[] {
  return (room.barters ?? []).map(
    ({ id, players, offers, accepted, revision, status, expiresAt, reason }) => ({
      id,
      players: [...players],
      offers: offers.map((o) => (o ? { ...o } : null)),
      accepted: [...accepted],
      revision,
      status,
      expiresAt,
      reason,
    }),
  );
}
const inventoryCount = (p, item: string) => p.inventory[item] ?? 0;
function exchangeProblem(ps, offers: [BarterOffer | null, BarterOffer | null]) {
  if (offers.some((o) => !o)) return '二人とも、渡す品物を提示しよう。';
  for (let i = 0; i < 2; i++) {
    const out = offers[i],
      incoming = offers[1 - i];
    for (const item of new Set([out.item, incoming.item])) {
      const count = inventoryCount(ps[i], item);
      if (!Number.isSafeInteger(count) || count < 0 || count > 99)
        return 'もちものを確認してから、もう一度提示しよう。';
      if (item === out.item && count < out.quantity)
        return '提示した品物が足りなくなりました。内容を見直そう。';
      const next =
        count -
        (item === out.item ? out.quantity : 0) +
        (item === incoming.item ? incoming.quantity : 0);
      if (next > 99) return '受け取る人のもちものがいっぱいです。数量を見直そう。';
    }
  }
  return '';
}
export function handleBarterCommand(
  room,
  p,
  message: BarterCommand,
  now: number,
  newId: () => string,
): { ok: boolean; changed: boolean; text?: string } {
  const updated = updateBarters(room, now);
  const fail = (text: string) => ({ ok: false, changed: updated, text });
  if (message.kind === 'cancel') {
    const t = activeFor(room, p.id);
    if (!t || (message.tradeId && t.id !== message.tradeId)) return { ok: true, changed: updated };
    cancelBarter(room, p.id, now);
    return { ok: true, changed: true };
  }
  if (message.kind === 'invite') {
    const other = room.players.get(message.targetId);
    if (activeFor(room, p.id) || activeFor(room, message.targetId))
      return fail('どちらかが別の交換を相談中です。');
    const problem = barterProblem(p, other, now, room.collision);
    if (problem) return fail(problem);
    if (room.barters.some((t) => t.players[0] === p.id && now - t.createdAt < BARTER.inviteGapMs))
      return fail('誘い直す前に、少し待とう。');
    const trade: BarterState = {
      id: newId(),
      players: [p.id, other.id],
      offers: [null, null],
      accepted: [false, false],
      revision: 0,
      status: 'invited',
      createdAt: now,
      expiresAt: now + BARTER.lifetimeMs,
      hurtSequences: [p.hurtSequence ?? 0, other.hurtSequence ?? 0],
      reason: '',
    };
    room.barters.push(trade);
    stopActor(p);
    return { ok: true, changed: true };
  }
  const t: BarterState = (room.barters ?? []).find((t) => t.id === message.tradeId);
  if (!t || !barterActive(t) || !t.players.includes(p.id))
    return fail('その交換は終わったか、あなたの交換ではありません。');
  if (message.revision !== t.revision)
    return fail('交換する内容が更新されました。もう一度確認しよう。');
  const index = t.players.indexOf(p.id);
  if (message.kind === 'join') {
    if (t.status !== 'invited' || index !== 1) return fail('相手の参加を待とう。');
    t.status = 'open';
    t.revision++;
    stopActor(p);
    return { ok: true, changed: true };
  }
  if (t.status !== 'open') return fail('相手が参加してから品物を相談しよう。');
  if (message.kind === 'offer') {
    const item = BARTER_ITEMS.find((f) => f.id === message.item);
    if (
      !item ||
      !Number.isSafeInteger(message.quantity) ||
      message.quantity < 1 ||
      message.quantity > BARTER.maxQuantity
    )
      return fail('交換する品物と、1〜20個の数量を選ぼう。');
    const owned = inventoryCount(p, item.id);
    if (!Number.isSafeInteger(owned) || owned < message.quantity || owned > 99)
      return fail('提示する品物が足りません。');
    t.offers[index] = { item: item.id, quantity: message.quantity };
    t.accepted = [false, false];
    t.revision++;
    t.reason = '';
    return { ok: true, changed: true };
  }
  if (message.kind !== 'accept') return fail('その交換操作は見つかりません。');
  const ps = t.players.map((id) => room.players.get(id));
  const problem = exchangeProblem(ps, t.offers);
  if (problem) {
    t.accepted = [false, false];
    t.revision++;
    t.reason = problem;
    return { ok: false, changed: true, text: problem };
  }
  if (t.accepted[index]) return { ok: true, changed: updated };
  t.accepted[index] = true;
  if (t.accepted.every(Boolean)) {
    // Both inventories are validated before either side is changed. No escrow or refund path.
    for (let i = 0; i < 2; i++) {
      const out = t.offers[i],
        incoming = t.offers[1 - i];
      for (const item of new Set([out.item, incoming.item]))
        ps[i].inventory[item] =
          inventoryCount(ps[i], item) -
          (item === out.item ? out.quantity : 0) +
          (item === incoming.item ? incoming.quantity : 0);
    }
    closeTrade(t, 'complete', '二人の品物を交換しました。もちものを確認しよう。', now);
  }
  return { ok: true, changed: true };
}
