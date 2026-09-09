export const SEASONS = [
  { name: '芽吹き', growMs: 180000 },
  { name: '夏の集い', growMs: 150000 },
  { name: '実り', growMs: 180000 },
  { name: '冬の炉', growMs: 240000 },
];
export const gulfSeason = (now: number, createdAt: number) =>
  SEASONS[Math.floor(Math.max(0, now - createdAt) / 720000) % 4];
