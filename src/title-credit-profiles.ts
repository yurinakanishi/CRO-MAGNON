/** One complete cast for local and public builds, shared by title cards and cave murals. */
export const TITLE_CREDITS = [
  { name: 'yuri', profile: 'https://x.com/yurinakanishi33', qr: 'yuri' },
  { name: 'Ryuichi-typeR', profile: 'https://x.com/WabisukeTyper', qr: 'ryuichi' },
  { name: 'ぬこぬこ / NUKO 🇯🇵', profile: 'https://x.com/nukonuko', qr: 'nukonuko' },
  { name: 'オータニ@AI駆動開発', profile: 'https://x.com/otani_ai_memo', qr: 'otani' },
  {
    name: '浦田 勇樹 | 生成AI×新規プロダクト開発@ブレインパッド',
    profile: 'https://x.com/yuki_urata',
    qr: 'urata',
  },
] as const;

export const TITLE_GUEST = {
  name: 'R-524',
  profile: 'https://x.com/R5ni4',
  qr: 'r524',
} as const;

export const TITLE_SUPPORT = {
  name: 'りも(Limo)',
  profile: 'https://x.com/vibe_walking',
  qr: 'rimo',
} as const;

/**
 * OpenAI's dots, the characters the camp's dots follow. Credited in every build
 * because the dots are always in the world. They have no X profile of their own,
 * so the card does not link out.
 */
export const TITLE_DOTS = {
  name: 'OpenAI Dots',
  profile: '',
  qr: 'dots',
} as const;

/**
 * Retained guest profiles, named as on X, included in both contributor lists.
 * Crediting a person does not release their mascot or its files.
 * They have no QR code; all credit displays use the contributors dialog.
 */
export const TITLE_FRIENDS = [
  { name: 'まるぃも', profile: 'https://x.com/marulimoai', qr: 'maruimo' },
  { name: 'mae616 : 今川焼き', profile: 'https://x.com/mae616_', qr: 'mae' },
  { name: 'りさ', profile: 'https://x.com/eerm16g', qr: 'risa' },
  { name: 'Saber@codexer', profile: 'https://x.com/Saber5656', qr: 'saber' },
  { name: '吉澤フェアリー🇯🇵', profile: 'https://x.com/Fairy_Yoshizawa', qr: 'fairy' },
  {
    name: 'さが@迷えるインドア派アニオタSEおじ',
    profile: 'https://x.com/Sagasa8045',
    qr: 'sagasa',
  },
  { name: 'ほーきー(Hawkie)', profile: 'https://x.com/hawkymisc', qr: 'hawkie' },
  { name: '朝日南', profile: 'https://x.com/asahina_AIauto', qr: 'asahina' },
  // Painted in the deepened cave (2026-10-14); a mural person, not a companion.
  { name: '匿名F＠構造婚', profile: 'https://x.com/daredaro_F', qr: 'daredaro' },
  // Painted at the back of the east wall (2026-10-22); a mural person, not a companion.
  { name: '個人開発・タコス・ビリヤニ・やんこ', profile: 'https://x.com/Jank0vic', qr: 'jank0vic' },
] as const;
