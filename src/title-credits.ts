import { TITLE_CREDITS, TITLE_GUEST } from './title-credit-profiles.js';
export { TITLE_CREDITS, TITLE_GUEST } from './title-credit-profiles.js';

export function titleCreditsMarkup(): string {
  const card = (
    credit: (typeof TITLE_CREDITS)[number] | typeof TITLE_GUEST,
    size = 74,
    avatarSize = 56,
  ) =>
    `<figure class="credit-person"><img class="credit-avatar" src="/title/avatar-${credit.qr}.jpg" width="${avatarSize}" height="${avatarSize}" alt="${credit.name}のXアイコン" decoding="async"><img class="credit-qr" src="/title/qr-${credit.qr}.png" width="${size}" height="${size}" alt="${credit.name}のXプロフィールのQRコード" decoding="async"><figcaption class="credit-name">${credit.name}</figcaption></figure>`;
  return `<section class="title-credits" data-credits="${TITLE_CREDITS.length > 1 ? 'full' : 'public'}" aria-label="クレジット">
    <div class="credit-production"><h2>${TITLE_CREDITS.length > 1 ? '制作' : '開発者'}</h2>${card(TITLE_CREDITS[0], 148, 112)}</div>
    ${
      TITLE_CREDITS.length > 1
        ? `<div class="credit-planning"><h2>監修</h2><div class="credit-people">${TITLE_CREDITS.slice(
            1,
          )
            .map((credit) => card(credit))
            .join('')}</div></div>`
        : ''
    }
    <div class="credit-guest"><h2>友情出演</h2>${card(TITLE_GUEST)}</div>
  </section>`;
}
