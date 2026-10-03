export type SpotifyBar = { x: number; y: number; w: number; h: number };
export type SpotifyPoint = { x: number; y: number };

const LOGO_PATH =
  "M31.1897 0.0240432C14.6347 -0.632948 0.681043 12.2549 0.024052 28.8097C-0.633075 45.3665 12.2553 59.319 28.8103 59.976C45.366 60.633 59.3188 47.7458 59.976 31.1893C60.633 14.6343 47.7453 0.681005 31.1897 0.0240432ZM43.8535 43.9722C43.4793 44.6292 42.7525 44.9595 42.0468 44.8602C41.829 44.8298 41.6135 44.7582 41.4105 44.6427C37.4455 42.3855 33.1242 40.9165 28.5667 40.276C24.0095 39.6355 19.4507 39.8565 15.0169 40.9335C14.0555 41.1667 13.0871 40.5768 12.8536 39.6155C12.6202 38.654 13.2103 37.6857 14.1715 37.452C19.0471 36.2682 24.058 36.0247 29.0655 36.7285C34.073 37.4322 38.8228 39.0475 43.1828 41.5293C44.0425 42.0187 44.3428 43.1125 43.8535 43.9722ZM47.7962 36.0967C47.1842 37.2277 45.771 37.6495 44.6403 37.037C39.9998 34.527 34.9767 32.879 29.7105 32.139C24.4443 31.3988 19.1614 31.5982 14.0087 32.732C13.7298 32.7935 13.4517 32.8022 13.1846 32.7647C12.2487 32.633 11.4492 31.9355 11.2343 30.9585C10.958 29.7025 11.752 28.4602 13.008 28.184C18.7039 26.9305 24.5416 26.7097 30.3585 27.5272C36.1758 28.3447 41.7262 30.1663 46.8558 32.941C47.987 33.5527 48.408 34.9657 47.7962 36.0967ZM52.1663 27.2192C51.5905 28.3263 50.3935 28.9 49.2245 28.7358C48.9105 28.6915 48.5987 28.5942 48.3012 28.4398C42.8988 25.6305 37.0798 23.7731 31.006 22.9195C24.9326 22.0659 18.8271 22.2474 12.8592 23.4587C11.3078 23.7732 9.79528 22.7712 9.48055 21.2201C9.16582 19.669 10.1679 18.1563 11.7191 17.8414C18.3266 16.5002 25.084 16.2991 31.8038 17.2435C38.5238 18.188 44.9642 20.2439 50.9457 23.3543C52.35 24.0846 52.8963 25.815 52.1663 27.2192Z";

export const SAMPLE_SPOTIFY_BARS =
  "100:44.5:6.71:11,112.42:27:6.71:46,124.84:23.5:6.71:53,137.27:34:6.71:32,149.69:34:6.71:32,162.11:34:6.71:32,174.53:20:6.71:60,186.96:23.5:6.71:53,199.38:30.5:6.71:39,211.8:37.5:6.71:25,224.22:41:6.71:18,236.64:20:6.71:60,249.07:27:6.71:46,261.49:34:6.71:32,273.91:20:6.71:60,286.33:20:6.71:60,298.76:30.5:6.71:39,311.18:44.5:6.71:11,323.6:37.5:6.71:25,336.02:30.5:6.71:39,348.44:27:6.71:46,360.87:20:6.71:60,373.29:44.5:6.71:11";

export function encodeSpotifyBars(bars: SpotifyBar[]) {
  return bars.map((bar) => [bar.x, bar.y, bar.w, bar.h].map((value) => value.toFixed(2)).join(":")).join(",");
}

export function decodeSpotifyBars(value: string): SpotifyBar[] {
  if (!value.trim()) return [];
  return value.split(",").map((part) => {
    const [x, y, w, h] = part.split(":").map(Number);
    if (![x, y, w, h].every((item) => Number.isFinite(item) && item > 0)) {
      throw new Error("That Spotify code could not be read. Generate it again.");
    }
    return { x, y, w, h };
  });
}

export function spotifyUri(input: string) {
  const text = input.trim();
  const direct = text.match(/^spotify:(track|album|playlist|artist|episode|show):([A-Za-z0-9]+)/);
  if (direct) return `spotify:${direct[1]}:${direct[2]}`;
  let url: URL | null = null;
  try {
    url = new URL(text);
  } catch {
    url = null;
  }
  if (url && (url.hostname === "open.spotify.com" || url.hostname.endsWith(".spotify.com"))) {
    const parts = url.pathname.split("/").filter(Boolean);
    const kinds = new Set(["track", "album", "playlist", "artist", "episode", "show"]);
    const index = parts.findIndex((part) => kinds.has(part));
    const id = index >= 0 ? parts[index + 1] : "";
    if (id && /^[A-Za-z0-9]+$/.test(id)) return `spotify:${parts[index]}:${id}`;
  }
  throw new Error("Paste a Spotify song, album, artist, or playlist link.");
}

export function barsFromSvg(svg: string) {
  return [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)]
    .map((match) => ({
      x: Number(match[1]),
      y: Number(match[2]),
      w: Number(match[3]),
      h: Number(match[4]),
    }))
    .filter((bar) => bar.w < 40 && bar.h <= 80);
}

export async function fetchSpotifyBars(input: string) {
  const uri = spotifyUri(input);
  const response = await fetch(`/api/spotify-code?uri=${encodeURIComponent(uri)}`);
  const body = (await response.json().catch(() => null)) as { bars?: string; error?: string } | null;
  if (!response.ok || !body?.bars) {
    throw new Error(body?.error || "Spotify could not make a code for that link.");
  }
  const bars = decodeSpotifyBars(body.bars);
  if (bars.length < 20) throw new Error("Spotify did not return a code for that link.");
  return bars;
}

export function spotifyLogoLoops() {
  return parseLogo(LOGO_PATH).map((loop) => loop.map((point) => ({ x: point.x + 20, y: point.y + 20 })));
}

function parseLogo(path: string) {
  const tokens = path.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const loops: SpotifyPoint[][] = [];
  let index = 0;
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  let current: SpotifyPoint[] | null = null;
  const read = () => Number(tokens[index++]);
  while (index < tokens.length) {
    const command = tokens[index++];
    if (command === "M") {
      cx = read();
      cy = read();
      startX = cx;
      startY = cy;
      current = [{ x: cx, y: cy }];
      continue;
    }
    if (command === "C") {
      if (!current) current = [];
      const x1 = read();
      const y1 = read();
      const x2 = read();
      const y2 = read();
      const x = read();
      const y = read();
      for (let step = 1; step <= 32; step += 1) {
        current.push(cubic(cx, cy, x1, y1, x2, y2, x, y, step / 32));
      }
      cx = x;
      cy = y;
      continue;
    }
    if (command === "Z" || command === "z") {
      if (current && current.length) loops.push(current);
      current = null;
      cx = startX;
      cy = startY;
      continue;
    }
    throw new Error("The Spotify logo could not be drawn.");
  }
  return loops;
}

function cubic(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  t: number,
) {
  const u = 1 - t;
  return {
    x: u ** 3 * x0 + 3 * u ** 2 * t * x1 + 3 * u * t ** 2 * x2 + t ** 3 * x3,
    y: u ** 3 * y0 + 3 * u ** 2 * t * y1 + 3 * u * t ** 2 * y2 + t ** 3 * y3,
  };
}
