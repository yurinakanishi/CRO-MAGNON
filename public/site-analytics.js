// Basic consent: no Google script, cookies or pings before an explicit opt-in.
(() => {
  const id = document.currentScript?.dataset.measurementId;
  const eligible = location.origin === 'https://cromagnonmmo.com' && /^G-[A-Z0-9]+$/.test(id || '');
  const key = 'cro-analytics-consent-v1';
  let choice = null;
  try {
    choice = localStorage.getItem(key);
  } catch {
    /* Play works without storage. */
  }
  const english = () => document.documentElement.lang === 'en';
  let loaded = false;
  let panel;
  let referrer = '';
  try {
    const source = new URL(document.referrer);
    if (/^https?:$/.test(source.protocol)) referrer = source.origin + '/';
  } catch {
    /* Direct visit. */
  }
  function start() {
    if (!eligible || choice !== 'granted') return;
    window[`ga-disable-${id}`] = false;
    if (loaded) return;
    loaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () {
      window.dataLayer.push(arguments);
    };
    window.gtag('consent', 'default', {
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    });
    window.gtag('js', new Date());
    window.gtag('config', id, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      cookie_domain: 'none',
      cookie_flags: 'SameSite=Lax;Secure',
      page_location: location.origin + location.pathname,
      page_referrer: referrer,
    });
    // Query/hash and player data are excluded. Language changes do not add pageviews.
    window.gtag('event', 'page_view', {
      page_location: location.origin + location.pathname,
      page_title: document.title,
      page_referrer: referrer,
    });
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
    document.head.append(script);
  }
  function choose(value) {
    choice = value;
    try {
      localStorage.setItem(key, value);
    } catch {
      /* This visit only. */
    }
    panel?.remove();
    if (value === 'granted') start();
    else {
      if (eligible) window[`ga-disable-${id}`] = true;
      // Cookies are host-only; remove GA cookies without touching game settings/saves.
      for (const cookie of document.cookie.split(';')) {
        const name = cookie.trim().split('=')[0];
        if (/^_ga(?:_|$)/.test(name))
          document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax; Secure`;
      }
      // Google's documented kill switch stops collection without reloading a game tab.
    }
  }
  function show() {
    panel?.remove();
    panel = document.createElement('aside');
    panel.id = 'analytics-consent';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', english() ? 'Analytics settings' : 'アクセス解析の設定');
    const text = document.createElement('p');
    text.textContent = !eligible
      ? english()
        ? 'Analytics is inactive on this site.'
        : 'このサイトではアクセス解析は無効です。'
      : english()
        ? 'May we use Google Analytics cookies to measure visits? You can play without allowing this.'
        : 'Google AnalyticsのCookieで利用状況を計測してもよいですか？許可しなくても遊べます。';
    panel.append(text);
    for (const [value, label] of [
      ['denied', english() ? 'Do not allow' : '許可しない'],
      ...(eligible ? [['granted', english() ? 'Allow analytics' : '計測を許可']] : []),
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => choose(value));
      panel.append(button);
    }
    const link = document.createElement('a');
    link.href = english() ? '/en/privacy' : '/privacy';
    link.textContent = english() ? 'Privacy' : 'プライバシー';
    panel.append(link);
    document.body.append(panel);
  }
  document.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('[data-analytics-settings]'))
      show();
  });
  new MutationObserver(() => {
    if (panel?.isConnected) show();
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['lang'],
  });
  // Apply another tab's withdrawal as well.
  window.addEventListener('storage', (event) => {
    if (event.key === key && event.newValue !== choice)
      choose(event.newValue === 'granted' ? 'granted' : 'denied');
  });
  if (eligible) {
    if (choice === 'granted') start();
    else if (choice !== 'denied') show();
  }
})();
