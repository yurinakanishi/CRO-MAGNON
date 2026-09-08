// Application limits are conservative usage controls. The Free account plan is
// the billing boundary; these counters must never be used to justify Paid usage.
export const FREE_LIMITS = Object.freeze({
  activeMs: 12 * 60 * 60 * 1000,
  messages: 400000,
  connections: 2000,
  writes: 20000,
});
export const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
export const nextDay = (now = Date.now()) => Date.parse(`${utcDay(now)}T00:00:00Z`) + 86400000;
export function freshBudget(now = Date.now()) {
  return { day: utcDay(now), activeMs: 0, messages: 0, connections: 0, writes: 0 };
}
export type Budget = ReturnType<typeof freshBudget>;
export type BudgetKind = keyof typeof FREE_LIMITS;
export function reserve(
  budget: Budget,
  kind: BudgetKind,
  amount: number,
  now = Date.now(),
  limits: Readonly<Record<BudgetKind, number>> = FREE_LIMITS,
) {
  if (budget.day !== utcDay(now)) Object.assign(budget, freshBudget(now));
  if (!(kind in limits) || !Number.isFinite(amount) || amount < 0)
    throw new Error('Invalid reservation');
  if (budget[kind] + amount > limits[kind]) return false;
  budget[kind] += amount;
  return true;
}
