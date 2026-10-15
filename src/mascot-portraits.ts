/** Photographs of the delivered companion GLBs, kept apart from their source portraits. */
export const MASCOT_PORTRAITS = [
  {
    key: 'rimo-neko',
    modelKey: 'rimo-neko',
    url: '/models/rimo-neko/portraits/companion-r01.webp',
  },
  {
    key: '524',
    modelKey: 'yellow-524-mascot',
    url: '/models/yellow-524-mascot/portraits/companion-r01.webp',
  },
] as const;

export const mascotPortrait = (key: string) =>
  MASCOT_PORTRAITS.find((portrait) => portrait.key === key)?.url;
