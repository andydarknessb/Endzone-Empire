// ESPN full headshots are 350x254 at about 230 KB; the combiner serves the resized PNG at 2x the square avatar's height (the square crop trims the width).
const ESPN_HEADSHOT = /^https?:\/\/a\.espncdn\.com(\/i\/headshots\/[^?#]*)/;

export function headshotSrc(url, size) {
  const match = url && ESPN_HEADSHOT.exec(url);
  if (!match) return url;
  const h = Math.ceil(size * 2);
  const w = Math.ceil((h * 350) / 254);
  return `https://a.espncdn.com/combiner/i?img=${match[1]}&w=${w}&h=${h}`;
}
