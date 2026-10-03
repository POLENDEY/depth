import { parse, type Font } from "opentype.js";

const fontCache = new Map<string, Promise<Font>>();

export function loadFont(file: string) {
  const cached = fontCache.get(file);
  if (cached) return cached;
  const pending = fetch(file)
    .then((response) => {
      if (!response.ok) throw new Error("Could not load that font.");
      return response.arrayBuffer();
    })
    .then((buffer) => parse(buffer));
  fontCache.set(file, pending);
  return pending;
}

export const FONTS = [
  {
    id: "luckiest-guy",
    name: "Luckiest Guy",
    file: "/fonts/luckiest-guy.woff",
    css: "Luckiest Guy",
  },
  {
    id: "lilita-one",
    name: "Lilita One",
    file: "/fonts/lilita-one.ttf",
    css: "Lilita One",
  },
  {
    id: "bangers",
    name: "Bangers",
    file: "/fonts/bangers.ttf",
    css: "Bangers",
  },
  {
    id: "fredoka",
    name: "Fredoka",
    file: "/fonts/fredoka-bold.woff",
    css: "Fredoka",
  },
  {
    id: "pacifico",
    name: "Pacifico",
    file: "/fonts/pacifico.ttf",
    css: "Pacifico",
  },
  {
    id: "nunito",
    name: "Nunito",
    file: "/fonts/nunito-extrabold.woff",
    css: "Nunito",
  },
] as const;

export type FontId = (typeof FONTS)[number]["id"];

export function fontById(id: FontId) {
  return FONTS.find((font) => font.id === id) ?? FONTS[0];
}
