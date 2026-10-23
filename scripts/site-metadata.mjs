// Public identifiers only. Credentials and verification secrets never belong here.
export function publicSiteHtml(bytes, config) {
  const { measurementId, searchConsoleVerification } = config;
  if (measurementId !== null && !/^G-[A-Z0-9]+$/.test(measurementId))
    throw new Error('Invalid GA4 measurement ID');
  if (searchConsoleVerification !== null && !/^[A-Za-z0-9_-]+$/.test(searchConsoleVerification))
    throw new Error('Invalid Search Console HTML verification token');
  let html = bytes.toString('utf8');
  if (!html.includes('data-measurement-id=""')) throw new Error('Missing analytics config slot');
  html = html.replace('data-measurement-id=""', `data-measurement-id="${measurementId ?? ''}"`);
  if (searchConsoleVerification)
    html = html.replace(
      '</head>',
      `  <meta name="google-site-verification" content="${searchConsoleVerification}" />\n  </head>`,
    );
  return Buffer.from(html);
}

export const siteHeaders =
  '/robots.txt\n  Content-Type: text/plain; charset=utf-8\n' +
  '/sitemap.xml\n  Content-Type: application/xml; charset=utf-8\n' +
  '/src/*\n  X-Robots-Tag: noindex\n/shared/*\n  X-Robots-Tag: noindex\n' +
  '/models/*\n  X-Robots-Tag: noindex\n/audio/*\n  X-Robots-Tag: noindex\n';
