import { SAMPLE_SPOTIFY_BARS } from "./spotify-code";

export type Pattern = "vertical" | "square" | "smooth";
export type Relief = "embossed" | "debossed";
export type TextFlow = "vertical" | "horizontal";

export const TAG_GROUPS = [
  {
    id: "basic",
    label: "Basic",
    shapes: [
      { value: "circle", label: "Circle" },
      { value: "flower", label: "Flower" },
      { value: "heart", label: "Heart" },
      { value: "star", label: "Star" },
      { value: "square", label: "Square" },
    ],
  },
  {
    id: "food",
    label: "Food",
    shapes: [
      { value: "coffee", label: "Cup of coffee" },
      { value: "bread", label: "Bread" },
      { value: "slice", label: "Slice of bread" },
      { value: "butter", label: "Butter" },
      { value: "croissant", label: "Croissant" },
      { value: "apple", label: "Apple" },
    ],
  },
  {
    id: "animals",
    label: "Animals",
    shapes: [
      { value: "cat", label: "Cat" },
      { value: "dog", label: "Dog" },
      { value: "rabbit", label: "Rabbit" },
      { value: "elephant", label: "Elephant" },
      { value: "bear", label: "Bear" },
    ],
  },
  {
    id: "cute",
    label: "Cute",
    shapes: [
      { value: "character", label: "Cute character" },
      { value: "cloud", label: "Cloud" },
    ],
  },
] as const;

export type TagShape = (typeof TAG_GROUPS)[number]["shapes"][number]["value"];

export type ProductSettings = {
  text: string;
  fontId: string;
  textColor: string;
  baseColor: string;
  letterHeight: number;
  textThickness: number;
  baseThickness: number;
  cableDiameter: number;
  magnetDiameter: number;
  photoWidth: number;
  photoHeight: number;
  innerDiameter: number;
  innerHeight: number;
  maxLength: number;
  holeDiameter: number;
  spotifyBars: string;
  backText: string;
  relief: Relief;
  debossDepth: number;
  textFlow: TextFlow;
  linkHeight: number;
  tagSize: number;
  tagShape: TagShape;
  pattern: Pattern;
};

export type NumberKey = {
  [Key in keyof ProductSettings]: ProductSettings[Key] extends number ? Key : never;
}[keyof ProductSettings];

export type Field =
  | { type: "text"; label: string; maxChars?: number }
  | { type: "font" }
  | { type: "number"; key: NumberKey; label: string; min: number; max: number; step: number }
  | { type: "select"; label: string; options: { value: Pattern; label: string }[] }
  | { type: "shapes"; label: string }
  | { type: "spotify"; label: string }
  | { type: "back-text"; label: string; maxChars?: number }
  | { type: "relief"; label: string }
  | { type: "text-flow"; label: string }
  | { type: "colors"; text: string; base: string };

export type Product = {
  slug: string;
  title: string;
  summary: string;
  button: string;
  settings: ProductSettings;
  fields: Field[];
};

const shared = {
  fontId: "luckiest-guy",
  cableDiameter: 6,
  magnetDiameter: 8,
  photoWidth: 100,
  photoHeight: 140,
  innerDiameter: 100,
  innerHeight: 90,
  maxLength: 120,
  holeDiameter: 5,
  spotifyBars: "",
  backText: "",
  relief: "embossed" as Relief,
  debossDepth: 0.8,
  textFlow: "vertical" as TextFlow,
  linkHeight: 18,
  tagSize: 48,
  tagShape: "circle" as TagShape,
  pattern: "vertical" as Pattern,
};

export const PRODUCTS: Product[] = [
  {
    slug: "name-keychain",
    title: "Name Keychain",
    summary: "Raised letters on a colored outline, with a keyring hole.",
    button: "#ff8f7d",
    settings: {
      ...shared,
      text: "PAUL",
      textColor: "#f4f4f5",
      baseColor: "#8b78f2",
      letterHeight: 18,
      textThickness: 1.6,
      baseThickness: 2.4,
    },
    fields: [],
  },
  {
    slug: "initial-keychain",
    title: "Initial Keychain",
    summary: "One letter on a tag. Pick a basic, food, animal, or cute shape.",
    button: "#ff8f7d",
    settings: {
      ...shared,
      text: "P",
      fontId: "lilita-one",
      textColor: "#fffaf3",
      baseColor: "#f6d56a",
      letterHeight: 22,
      textThickness: 1.4,
      baseThickness: 3.2,
      tagSize: 48,
      tagShape: "flower",
      holeDiameter: 4,
    },
    fields: [
      { type: "text", label: "Letter", maxChars: 2 },
      { type: "font" },
      { type: "shapes", label: "Shape" },
      { type: "number", key: "tagSize", label: "Tag size", min: 32, max: 80, step: 1 },
      { type: "number", key: "letterHeight", label: "Letter height", min: 8, max: 40, step: 0.5 },
      { type: "number", key: "baseThickness", label: "Tag thickness", min: 2, max: 6, step: 0.1 },
      { type: "number", key: "textThickness", label: "Letter thickness", min: 0.8, max: 3, step: 0.1 },
      { type: "number", key: "holeDiameter", label: "Hole diameter", min: 3, max: 8, step: 0.5 },
      { type: "colors", text: "Letter", base: "Tag" },
    ],
  },
  {
    slug: "spotify-code",
    title: "Spotify Code",
    summary: "A Spotify code keychain with custom text on the back and a keyring hole.",
    button: "#1db954",
    settings: {
      ...shared,
      text: "",
      textColor: "#1db954",
      baseColor: "#161616",
      textThickness: 1.2,
      baseThickness: 3,
      holeDiameter: 5,
      maxLength: 90,
      photoWidth: 22,
      spotifyBars: SAMPLE_SPOTIFY_BARS,
      backText: "LOVE",
      relief: "embossed",
      debossDepth: 0.8,
      textFlow: "vertical",
      letterHeight: 14,
    },
    fields: [
      { type: "spotify", label: "Spotify link" },
      { type: "back-text", label: "Back text", maxChars: 18 },
      { type: "font" },
      { type: "text-flow", label: "Text direction" },
      { type: "number", key: "letterHeight", label: "Text size", min: 4, max: 24, step: 0.5 },
      { type: "relief", label: "Style" },
      { type: "number", key: "maxLength", label: "Length", min: 70, max: 160, step: 1 },
      { type: "number", key: "photoWidth", label: "Width", min: 18, max: 34, step: 0.5 },
      { type: "number", key: "baseThickness", label: "Thickness", min: 2, max: 6, step: 0.1 },
      { type: "number", key: "textThickness", label: "Emboss depth", min: 0.6, max: 2.2, step: 0.1 },
      { type: "number", key: "debossDepth", label: "Deboss depth", min: 0.3, max: 2.2, step: 0.1 },
      { type: "number", key: "holeDiameter", label: "Hole diameter", min: 3, max: 8, step: 0.5 },
      { type: "colors", text: "Code & text", base: "Tag" },
    ],
  },
  {
    slug: "cable-tag",
    title: "Cable Tag",
    summary: "A name that clips around a cable. The channel is the cable diameter.",
    button: "#ff5a36",
    settings: {
      ...shared,
      text: "JOHN",
      fontId: "lilita-one",
      textColor: "#d7ecff",
      baseColor: "#f7f7f5",
      letterHeight: 12,
      textThickness: 2.2,
      baseThickness: 1.8,
      cableDiameter: 6,
    },
    fields: [
      { type: "text", label: "Name" },
      { type: "font" },
      { type: "number", key: "letterHeight", label: "Letter height", min: 8, max: 24, step: 0.5 },
      { type: "number", key: "cableDiameter", label: "Cable diameter", min: 3, max: 12, step: 0.5 },
      { type: "number", key: "textThickness", label: "Letter thickness", min: 1, max: 4, step: 0.1 },
      { type: "colors", text: "Letters", base: "Clip" },
    ],
  },
  {
    slug: "articulated-name",
    title: "Articulated Name",
    summary: "Letter links joined side to side, with a keyring hole, so the name can flex.",
    button: "#ff8f7d",
    settings: {
      ...shared,
      text: "ISABELLA",
      fontId: "lilita-one",
      textColor: "#e11d48",
      baseColor: "#d6d3d1",
      letterHeight: 14,
      textThickness: 1.2,
      baseThickness: 5,
      linkHeight: 18,
      holeDiameter: 5,
    },
    fields: [
      { type: "text", label: "Name" },
      { type: "font" },
      { type: "number", key: "letterHeight", label: "Letter height", min: 8, max: 32, step: 0.5 },
      { type: "number", key: "linkHeight", label: "Link height", min: 12, max: 40, step: 0.5 },
      { type: "number", key: "baseThickness", label: "Body thickness", min: 4.8, max: 8, step: 0.1 },
      { type: "number", key: "textThickness", label: "Letter thickness", min: 0.8, max: 3, step: 0.1 },
      { type: "number", key: "holeDiameter", label: "Hole diameter", min: 3, max: 8, step: 0.1 },
      { type: "colors", text: "Tops", base: "Body" },
    ],
  },
  {
    slug: "pen-holder",
    title: "Pen Holder",
    summary: "Standing letters with a socket on each character for a pen or pencil.",
    button: "#ff5a36",
    settings: {
      ...shared,
      text: "JUNE",
      fontId: "bangers",
      textColor: "#f97316",
      baseColor: "#1c1917",
      letterHeight: 36,
      textThickness: 16,
      baseThickness: 4,
      maxLength: 140,
    },
    fields: [
      { type: "text", label: "Name" },
      { type: "font" },
      { type: "number", key: "letterHeight", label: "Letter height", min: 24, max: 60, step: 1 },
      { type: "number", key: "maxLength", label: "Maximum length", min: 60, max: 220, step: 1 },
      { type: "number", key: "textThickness", label: "Letter depth", min: 10, max: 28, step: 1 },
      { type: "colors", text: "Letters", base: "Sockets" },
    ],
  },
  {
    slug: "picture-frame",
    title: "Picture Frame",
    summary: "A standing frame with a photo opening and a name down one side.",
    button: "#ff5a36",
    settings: {
      ...shared,
      text: "PARIS",
      fontId: "lilita-one",
      textColor: "#e7e5e4",
      baseColor: "#d6d3d1",
      letterHeight: 16,
      textThickness: 3,
      baseThickness: 8,
      photoWidth: 90,
      photoHeight: 130,
    },
    fields: [
      { type: "text", label: "Side text" },
      { type: "font" },
      { type: "number", key: "photoWidth", label: "Photo width", min: 50, max: 200, step: 1 },
      { type: "number", key: "photoHeight", label: "Photo height", min: 50, max: 260, step: 1 },
      { type: "number", key: "letterHeight", label: "Letter height", min: 8, max: 28, step: 0.5 },
      { type: "colors", text: "Text", base: "Frame" },
    ],
  },
  {
    slug: "nameplate",
    title: "Nameplate",
    summary: "Block letters standing on a desk plate.",
    button: "#ff5a36",
    settings: {
      ...shared,
      text: "OLIVER",
      fontId: "lilita-one",
      textColor: "#3b82f6",
      baseColor: "#1d4ed8",
      letterHeight: 22,
      textThickness: 8,
      baseThickness: 4,
    },
    fields: [
      { type: "text", label: "Text" },
      { type: "font" },
      { type: "number", key: "letterHeight", label: "Size", min: 12, max: 48, step: 1 },
      { type: "number", key: "textThickness", label: "Letter depth", min: 4, max: 16, step: 0.5 },
      { type: "number", key: "baseThickness", label: "Plate thickness", min: 2, max: 8, step: 0.5 },
      { type: "colors", text: "Letters", base: "Plate" },
    ],
  },
  {
    slug: "planter",
    title: "Planter",
    summary: "A ribbed pot sized by the inside diameter and height.",
    button: "#ff5a36",
    settings: {
      ...shared,
      text: "PLANT",
      textColor: "#ecfccb",
      baseColor: "#4d7c0f",
      letterHeight: 18,
      textThickness: 3,
      baseThickness: 2.4,
      innerDiameter: 100,
      innerHeight: 90,
      pattern: "vertical",
    },
    fields: [
      { type: "number", key: "innerDiameter", label: "Inside diameter", min: 40, max: 180, step: 1 },
      { type: "number", key: "innerHeight", label: "Inside height", min: 30, max: 180, step: 1 },
      {
        type: "select",
        label: "Pattern",
        options: [
          { value: "vertical", label: "Vertical" },
          { value: "square", label: "Square" },
          { value: "smooth", label: "Smooth" },
        ],
      },
      { type: "colors", text: "Rim", base: "Pot" },
    ],
  },
  {
    slug: "plant-label",
    title: "Plant Label",
    summary: "A stake with a name on top, for a pot or garden bed.",
    button: "#ff5a36",
    settings: {
      ...shared,
      text: "MINT",
      fontId: "lilita-one",
      textColor: "#166534",
      baseColor: "#86efac",
      letterHeight: 14,
      textThickness: 2.4,
      baseThickness: 2,
    },
    fields: [
      { type: "text", label: "Name" },
      { type: "font" },
      { type: "number", key: "letterHeight", label: "Letter height", min: 8, max: 28, step: 0.5 },
      { type: "number", key: "textThickness", label: "Thickness", min: 1.2, max: 4, step: 0.1 },
      { type: "colors", text: "Letters", base: "Stake" },
    ],
  },
  {
    slug: "magnet",
    title: "Magnet",
    summary: "A flat name with a round pocket on the back for a magnet.",
    button: "#ff5a36",
    settings: {
      ...shared,
      text: "Amelia",
      fontId: "pacifico",
      textColor: "#f5f5f4",
      baseColor: "#a8a29e",
      letterHeight: 22,
      textThickness: 2.2,
      baseThickness: 2,
      magnetDiameter: 8,
    },
    fields: [
      { type: "text", label: "Name" },
      { type: "font" },
      { type: "number", key: "letterHeight", label: "Letter height", min: 12, max: 40, step: 0.5 },
      { type: "number", key: "magnetDiameter", label: "Magnet diameter", min: 4, max: 20, step: 0.5 },
      { type: "number", key: "baseThickness", label: "Pocket depth", min: 1, max: 4, step: 0.1 },
      { type: "colors", text: "Letters", base: "Back" },
    ],
  },
  {
    slug: "wall-art",
    title: "Wall Art",
    summary: "Large letters on a backplate, with two mounting holes.",
    button: "#ff5a36",
    settings: {
      ...shared,
      text: "Wall Art",
      fontId: "pacifico",
      textColor: "#fafaf9",
      baseColor: "#e7e5e4",
      letterHeight: 40,
      textThickness: 3,
      baseThickness: 3,
    },
    fields: [
      { type: "text", label: "Text" },
      { type: "font" },
      { type: "number", key: "letterHeight", label: "Letter height", min: 20, max: 80, step: 1 },
      { type: "number", key: "textThickness", label: "Letter thickness", min: 1.5, max: 8, step: 0.1 },
      { type: "number", key: "baseThickness", label: "Backplate", min: 2, max: 6, step: 0.1 },
      { type: "colors", text: "Letters", base: "Backplate" },
    ],
  },
  {
    slug: "glass-marker",
    title: "Glass Marker",
    summary: "A small name on a clip that hangs on a glass.",
    button: "#ff5a36",
    settings: {
      ...shared,
      text: "SOFIA",
      fontId: "bangers",
      textColor: "#fb7185",
      baseColor: "#44403c",
      letterHeight: 10,
      textThickness: 2.4,
      baseThickness: 2,
      cableDiameter: 8,
    },
    fields: [
      { type: "text", label: "Name" },
      { type: "font" },
      { type: "number", key: "letterHeight", label: "Letter height", min: 7, max: 16, step: 0.5 },
      { type: "number", key: "cableDiameter", label: "Clip opening", min: 4, max: 14, step: 0.5 },
      { type: "colors", text: "Letters", base: "Clip" },
    ],
  },
  {
    slug: "headband",
    title: "Headband",
    summary: "Raised letters on a curved band.",
    button: "#ff5a36",
    settings: {
      ...shared,
      text: "NATHAN",
      fontId: "lilita-one",
      textColor: "#1d4ed8",
      baseColor: "#f8fafc",
      letterHeight: 12,
      textThickness: 2.6,
      baseThickness: 2.4,
    },
    fields: [
      { type: "text", label: "Name" },
      { type: "font" },
      { type: "number", key: "letterHeight", label: "Letter height", min: 8, max: 20, step: 0.5 },
      { type: "number", key: "textThickness", label: "Letter thickness", min: 1.2, max: 4, step: 0.1 },
      { type: "colors", text: "Letters", base: "Band" },
    ],
  },
];

export function productBySlug(slug: string) {
  return PRODUCTS.find((product) => product.slug === slug);
}
