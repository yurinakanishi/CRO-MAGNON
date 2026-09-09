/** Profile names and destinations confirmed in Chrome on 2026-09-09. */
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

export function titleCreditsMarkup(): string {
  const card = (credit: (typeof TITLE_CREDITS)[number]) =>
    `<figure class="credit-person"><img src="/title/qr-${credit.qr}.png" width="111" height="111" alt="${credit.name}のXプロフィールのQRコード" decoding="async"><figcaption class="credit-name">${credit.name}</figcaption></figure>`;
  return `<section class="title-credits" aria-label="クレジット">
    <div class="credit-production"><h2>制作</h2>${card(TITLE_CREDITS[0])}</div>
    <div class="credit-planning"><h2>監修</h2><div class="credit-people">${TITLE_CREDITS.slice(1).map(card).join('')}</div></div>
  </section>`;
}
