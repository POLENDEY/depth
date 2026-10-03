import { barsFromSvg, encodeSpotifyBars } from "@/lib/spotify-code";

const URI = /^spotify:(track|album|playlist|artist|episode|show):[A-Za-z0-9]+$/;

export async function GET(request: Request) {
  const uri = new URL(request.url).searchParams.get("uri")?.trim() ?? "";
  if (!URI.test(uri)) {
    return Response.json({ error: "Paste a Spotify song, album, artist, or playlist link." }, { status: 400 });
  }
  try {
    const upstream = await fetch(`https://scannables.scdn.co/uri/plain/svg/000000/white/640/${uri}`, {
      cache: "no-store",
    });
    if (!upstream.ok) {
      return Response.json({ error: "Spotify could not make a code for that link." }, { status: 502 });
    }
    const bars = barsFromSvg(await upstream.text());
    if (bars.length < 20) {
      return Response.json({ error: "Spotify did not return a code for that link." }, { status: 502 });
    }
    return Response.json({ bars: encodeSpotifyBars(bars) });
  } catch {
    return Response.json({ error: "Spotify could not be reached. Try again." }, { status: 502 });
  }
}
