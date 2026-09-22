/** Profiles and their bundled X avatars confirmed on 2026-09-22. */
export const TITLE_CREDITS = [
  { name: 'yuri', profile: 'https://x.com/yurinakanishi33', qr: 'yuri' },
  { name: 'Ryuichi-typeR', profile: 'https://x.com/WabisukeTyper', qr: 'ryuichi' },
  { name: 'オータニ@AI駆動開発', profile: 'https://x.com/otani_ai_memo', qr: 'otani' },
  {
    name: '浦田 勇樹 | 生成AI×新規プロダクト開発@ブレインパッド',
    profile: 'https://x.com/yuki_urata',
    qr: 'urata',
  },
  { name: 'ぬこぬこ / NUKO 🇯🇵', profile: 'https://x.com/nukonuko', qr: 'nukonuko' },
] as const;

export const TITLE_GUEST = {
  name: 'R-524',
  profile: 'https://x.com/R5ni4',
  qr: 'r524',
} as const;

export function titleCreditsMarkup(): string {
  const card = (
    credit: (typeof TITLE_CREDITS)[number] | typeof TITLE_GUEST,
    size = 74,
    avatarSize = 56,
  ) =>
    `<figure class="credit-person"><img class="credit-avatar" src="/title/avatar-${credit.qr}.jpg" width="${avatarSize}" height="${avatarSize}" alt="${credit.name}のXアイコン" decoding="async"><img class="credit-qr" src="/title/qr-${credit.qr}.png" width="${size}" height="${size}" alt="${credit.name}のXプロフィールのQRコード" decoding="async"><figcaption class="credit-name">${credit.name}</figcaption></figure>`;
  return `<section class="title-credits" aria-label="クレジット">
    <div class="credit-production"><h2>制作</h2>${card(TITLE_CREDITS[0], 148, 112)}</div>
    <div class="credit-planning"><h2>監修</h2><div class="credit-people">${TITLE_CREDITS.slice(1)
      .map((credit) => card(credit))
      .join('')}</div></div>
    <div class="credit-guest"><h2>友情出演</h2>${card(TITLE_GUEST)}</div>
  </section>`;
}
