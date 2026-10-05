import lineart from "./emoji-lineart.json";

export type CharmGroup = "Cute" | "Emoji" | "Animals" | "Food" | "Symbols";

export type Charm = {
  id: string;
  label: string;
  emoji: string;
  group: CharmGroup;
};

type Point = { x: number; y: number };
type Part = { points: Point[]; hole?: boolean };

const LINEART = lineart as Record<string, [number, number][][]>;

function emojiArt(id: string): Part[] {
  return (LINEART[id] ?? []).map((ring) => ({
    points: ring.map(([x, y]) => ({ x, y })),
  }));
}

const GROUPS: CharmGroup[] = ["Cute", "Emoji", "Animals", "Food", "Symbols"];

export function charmGroups() {
  return GROUPS;
}

const catalog: Charm[] = [
  { id: "heart", label: "Heart", emoji: "❤️", group: "Cute" },
  { id: "star", label: "Star", emoji: "⭐", group: "Cute" },
  { id: "paw", label: "Paw", emoji: "🐾", group: "Cute" },
  { id: "flower", label: "Flower", emoji: "🌸", group: "Cute" },
  { id: "wings", label: "Wings", emoji: "🪽", group: "Cute" },
  { id: "music", label: "Music", emoji: "🎵", group: "Cute" },
  { id: "snow", label: "Snowflake", emoji: "❄️", group: "Cute" },
  { id: "cloud", label: "Cloud", emoji: "☁️", group: "Cute" },
  { id: "crown", label: "Crown", emoji: "👑", group: "Cute" },
  { id: "moon", label: "Moon", emoji: "🌙", group: "Cute" },
  { id: "sun", label: "Sun", emoji: "☀️", group: "Cute" },
  { id: "bolt", label: "Lightning", emoji: "⚡", group: "Cute" },
  { id: "spark", label: "Sparkles", emoji: "✨", group: "Cute" },
  { id: "bow", label: "Bow", emoji: "🎀", group: "Cute" },
  { id: "diamond", label: "Diamond", emoji: "💎", group: "Cute" },
  { id: "butterfly", label: "Butterfly", emoji: "🦋", group: "Cute" },
  { id: "smile", label: "Smile", emoji: "😊", group: "Emoji" },
  { id: "grin", label: "Grin", emoji: "😁", group: "Emoji" },
  { id: "joy", label: "Joy", emoji: "😂", group: "Emoji" },
  { id: "love", label: "Heart eyes", emoji: "😍", group: "Emoji" },
  { id: "wink", label: "Wink", emoji: "😉", group: "Emoji" },
  { id: "kiss", label: "Kiss", emoji: "😘", group: "Emoji" },
  { id: "cool", label: "Cool", emoji: "😎", group: "Emoji" },
  { id: "tongue", label: "Tongue", emoji: "😛", group: "Emoji" },
  { id: "sad", label: "Sad", emoji: "😢", group: "Emoji" },
  { id: "cry", label: "Cry", emoji: "😭", group: "Emoji" },
  { id: "angry", label: "Angry", emoji: "😠", group: "Emoji" },
  { id: "wow", label: "Surprised", emoji: "😮", group: "Emoji" },
  { id: "halo", label: "Angel", emoji: "😇", group: "Emoji" },
  { id: "party", label: "Party", emoji: "🥳", group: "Emoji" },
  { id: "sleep", label: "Sleepy", emoji: "😴", group: "Emoji" },
  { id: "neutral", label: "Neutral", emoji: "😐", group: "Emoji" },
  { id: "stars", label: "Star struck", emoji: "🤩", group: "Emoji" },
  { id: "plead", label: "Pleading", emoji: "🥺", group: "Emoji" },
  { id: "ghost", label: "Ghost", emoji: "👻", group: "Emoji" },
  { id: "skull", label: "Skull", emoji: "💀", group: "Emoji" },
  { id: "robot", label: "Robot", emoji: "🤖", group: "Emoji" },
  { id: "alien", label: "Alien", emoji: "👽", group: "Emoji" },
  { id: "fire", label: "Fire", emoji: "🔥", group: "Emoji" },
  { id: "thumb", label: "Thumbs up", emoji: "👍", group: "Emoji" },
  { id: "cat", label: "Cat", emoji: "🐱", group: "Animals" },
  { id: "dog", label: "Dog", emoji: "🐶", group: "Animals" },
  { id: "rabbit", label: "Rabbit", emoji: "🐰", group: "Animals" },
  { id: "bear", label: "Bear", emoji: "🐻", group: "Animals" },
  { id: "fox", label: "Fox", emoji: "🦊", group: "Animals" },
  { id: "frog", label: "Frog", emoji: "🐸", group: "Animals" },
  { id: "pig", label: "Pig", emoji: "🐷", group: "Animals" },
  { id: "chick", label: "Chick", emoji: "🐤", group: "Animals" },
  { id: "fish", label: "Fish", emoji: "🐟", group: "Animals" },
  { id: "penguin", label: "Penguin", emoji: "🐧", group: "Animals" },
  { id: "apple", label: "Apple", emoji: "🍎", group: "Food" },
  { id: "cake", label: "Cake", emoji: "🎂", group: "Food" },
  { id: "cookie", label: "Cookie", emoji: "🍪", group: "Food" },
  { id: "icecream", label: "Ice cream", emoji: "🍦", group: "Food" },
  { id: "coffee", label: "Coffee", emoji: "☕", group: "Food" },
  { id: "strawberry", label: "Strawberry", emoji: "🍓", group: "Food" },
  { id: "pizza", label: "Pizza", emoji: "🍕", group: "Food" },
  { id: "candy", label: "Candy", emoji: "🍬", group: "Food" },
  { id: "balloon", label: "Balloon", emoji: "🎈", group: "Symbols" },
  { id: "gift", label: "Gift", emoji: "🎁", group: "Symbols" },
  { id: "house", label: "House", emoji: "🏠", group: "Symbols" },
  { id: "car", label: "Car", emoji: "🚗", group: "Symbols" },
  { id: "plane", label: "Plane", emoji: "✈️", group: "Symbols" },
  { id: "ball", label: "Ball", emoji: "⚽", group: "Symbols" },
  { id: "rainbow", label: "Rainbow", emoji: "🌈", group: "Symbols" },
  { id: "peace", label: "Peace", emoji: "☮️", group: "Symbols" },
];

const DRAW: Record<string, () => Part[]> = {
  heart: () => [solid(heart(0, -0.02, 0.46))],
  star: () => [solid(star(0, 0, 0.48, 5))],
  paw: () => [
    solid(ellipse(0, -0.1, 0.2, 0.15)),
    solid(ellipse(-0.2, 0.08, 0.09, 0.12, -0.4)),
    solid(ellipse(-0.07, 0.2, 0.085, 0.12, -0.15)),
    solid(ellipse(0.08, 0.2, 0.085, 0.12, 0.15)),
    solid(ellipse(0.2, 0.08, 0.09, 0.12, 0.4)),
  ],
  flower: () => [
    ...[0, 72, 144, 216, 288].map((degree) => solid(circle(Math.cos(rad(degree - 90)) * 0.24, Math.sin(rad(degree - 90)) * 0.24, 0.16))),
    solid(circle(0, 0, 0.12)),
  ],
  wings: () => featheredWings(),
  music: () => [solid(ellipse(-0.08, -0.22, 0.16, 0.12, -0.4)), solid(rect(0.02, -0.16, 0.08, 0.46)), solid(rect(0.02, 0.22, 0.28, 0.08))],
  snow: () => detailedSnowflake(),
  cloud: () => [solid(circle(-0.12, -0.04, 0.18)), solid(circle(0.1, -0.02, 0.2)), solid(circle(0, 0.1, 0.16)), solid(ellipse(0, -0.08, 0.34, 0.16))],
  crown: () => [solid(poly([[-0.4, -0.16], [0.4, -0.16], [0.4, 0.05], [0.22, -0.08], [0, 0.28], [-0.22, -0.08], [-0.4, 0.05]]))],
  moon: () => [solid(circle(-0.04, 0, 0.4)), hole(circle(0.12, 0.06, 0.3))],
  sun: () => [solid(circle(0, 0, 0.22)), ...sunRays()],
  bolt: () => [solid(poly([[0.08, 0.46], [-0.28, 0.02], [-0.02, 0.02], [-0.1, -0.46], [0.28, 0], [0.02, 0]]))],
  spark: () => [solid(star(0, 0.08, 0.28, 4)), solid(star(-0.28, -0.22, 0.12, 4)), solid(star(0.26, -0.18, 0.1, 4))],
  bow: () => [solid(ellipse(-0.2, 0.04, 0.2, 0.14, 0.5)), solid(ellipse(0.2, 0.04, 0.2, 0.14, -0.5)), solid(circle(0, 0, 0.08)), solid(poly([[-0.06, -0.02], [0.06, -0.02], [0.14, -0.36], [0, -0.22], [-0.14, -0.36]]))],
  diamond: () => [solid(poly([[0, 0.42], [0.32, 0.08], [0, -0.46], [-0.32, 0.08]]))],
  butterfly: () => [solid(ellipse(-0.2, 0.08, 0.2, 0.16)), solid(ellipse(0.2, 0.08, 0.2, 0.16)), solid(ellipse(-0.16, -0.14, 0.14, 0.12)), solid(ellipse(0.16, -0.14, 0.14, 0.12)), solid(ellipse(0, 0, 0.06, 0.28))],
  smile: () => emojiArt("smile"),
  grin: () => emojiArt("grin"),
  joy: () => emojiArt("joy"),
  love: () => emojiArt("love"),
  wink: () => emojiArt("wink"),
  kiss: () => emojiArt("kiss"),
  cool: () => emojiArt("cool"),
  tongue: () => emojiArt("tongue"),
  sad: () => emojiArt("sad"),
  cry: () => emojiArt("cry"),
  angry: () => emojiArt("angry"),
  wow: () => emojiArt("wow"),
  halo: () => emojiArt("halo"),
  party: () => emojiArt("party"),
  sleep: () => emojiArt("sleep"),
  neutral: () => emojiArt("neutral"),
  stars: () => emojiArt("stars"),
  plead: () => emojiArt("plead"),
  ghost: () => emojiArt("ghost"),
  skull: () => emojiArt("skull"),
  robot: () => emojiArt("robot"),
  alien: () => emojiArt("alien"),
  fire: () => emojiArt("fire"),
  thumb: () => emojiArt("thumb"),
  cat: () => [
    solid(circle(0, -0.04, 0.32)),
    solid(poly([[-0.28, 0.12], [-0.12, 0.12], [-0.22, 0.4]])),
    solid(poly([[0.28, 0.12], [0.12, 0.12], [0.22, 0.4]])),
    hole(circle(-0.1, 0.02, 0.05)),
    hole(circle(0.1, 0.02, 0.05)),
    solid(poly([[0, -0.02], [0.06, -0.1], [-0.06, -0.1]])),
  ],
  dog: () => [
    solid(circle(0, -0.02, 0.3)),
    solid(ellipse(-0.28, 0.02, 0.12, 0.2, -0.4)),
    solid(ellipse(0.28, 0.02, 0.12, 0.2, 0.4)),
    hole(circle(-0.1, 0.04, 0.05)),
    hole(circle(0.1, 0.04, 0.05)),
    solid(ellipse(0, -0.1, 0.08, 0.06)),
  ],
  rabbit: () => [
    solid(circle(0, -0.08, 0.28)),
    solid(ellipse(-0.12, 0.28, 0.08, 0.24)),
    solid(ellipse(0.12, 0.28, 0.08, 0.24)),
    hole(circle(-0.08, -0.02, 0.045)),
    hole(circle(0.08, -0.02, 0.045)),
  ],
  bear: () => [
    solid(circle(0, -0.02, 0.32)),
    solid(circle(-0.24, 0.24, 0.12)),
    solid(circle(0.24, 0.24, 0.12)),
    hole(circle(-0.1, 0.02, 0.05)),
    hole(circle(0.1, 0.02, 0.05)),
    solid(ellipse(0, -0.1, 0.1, 0.07)),
  ],
  fox: () => [
    solid(poly([[0, -0.36], [0.34, 0.05], [0.16, 0.4], [0, 0.16], [-0.16, 0.4], [-0.34, 0.05]])),
    hole(circle(-0.1, 0.08, 0.045)),
    hole(circle(0.1, 0.08, 0.045)),
  ],
  frog: () => [
    solid(ellipse(0, -0.06, 0.36, 0.26)),
    solid(circle(-0.16, 0.16, 0.12)),
    solid(circle(0.16, 0.16, 0.12)),
    hole(circle(-0.16, 0.16, 0.05)),
    hole(circle(0.16, 0.16, 0.05)),
  ],
  pig: () => [
    solid(circle(0, 0, 0.36)),
    solid(ellipse(-0.22, 0.28, 0.08, 0.1)),
    solid(ellipse(0.22, 0.28, 0.08, 0.1)),
    hole(circle(-0.1, 0.06, 0.045)),
    hole(circle(0.1, 0.06, 0.045)),
    hole(ellipse(0, -0.1, 0.1, 0.07)),
  ],
  chick: () => [
    solid(circle(0, 0, 0.34)),
    solid(poly([[0.28, 0.02], [0.46, -0.02], [0.28, -0.08]])),
    hole(circle(0.08, 0.08, 0.045)),
  ],
  fish: () => [
    solid(ellipse(-0.04, 0, 0.32, 0.2)),
    solid(poly([[0.24, 0], [0.46, 0.18], [0.46, -0.18]])),
    hole(circle(-0.16, 0.04, 0.04)),
  ],
  penguin: () => [
    solid(ellipse(0, 0, 0.26, 0.4)),
    solid(ellipse(0, -0.05, 0.14, 0.24)),
    hole(circle(-0.08, 0.12, 0.035)),
    hole(circle(0.08, 0.12, 0.035)),
    solid(poly([[0, 0.02], [0.08, -0.02], [-0.08, -0.02]])),
  ],
  apple: () => [solid(circle(0, -0.04, 0.34)), solid(rect(0, 0.32, 0.06, 0.14)), solid(ellipse(0.12, 0.34, 0.1, 0.05, 0.4))],
  cake: () => [
    solid(roundRect(0, -0.08, 0.7, 0.42, 0.06)),
    solid(rect(-0.16, 0.22, 0.04, 0.16)),
    solid(rect(0.16, 0.22, 0.04, 0.16)),
    solid(ellipse(-0.16, 0.32, 0.05, 0.07)),
    solid(ellipse(0.16, 0.32, 0.05, 0.07)),
  ],
  cookie: () => [
    solid(circle(0, 0, 0.4)),
    hole(circle(-0.12, 0.1, 0.05)),
    hole(circle(0.14, 0.08, 0.045)),
    hole(circle(0.02, -0.12, 0.05)),
    hole(circle(-0.14, -0.08, 0.04)),
  ],
  icecream: () => [solid(poly([[-0.16, -0.08], [0.16, -0.08], [0, -0.46]])), solid(circle(0, 0.08, 0.2)), solid(circle(-0.08, 0.2, 0.14))],
  coffee: () => [
    solid(roundRect(-0.04, 0, 0.46, 0.42, 0.06)),
    solid(ring(0.26, 0.02, 0.12, 0.05)),
    solid(ellipse(-0.1, 0.3, 0.04, 0.08)),
  ],
  strawberry: () => [solid(ellipse(0, -0.02, 0.28, 0.36)), solid(poly([[-0.08, 0.28], [0.08, 0.28], [0, 0.46]]))],
  pizza: () => [solid(poly([[0, 0.46], [0.4, -0.36], [-0.4, -0.36]])), hole(circle(-0.08, 0.02, 0.05)), hole(circle(0.1, -0.08, 0.045))],
  candy: () => [solid(ellipse(0, 0, 0.16, 0.22)), solid(poly([[-0.14, 0.08], [-0.4, 0.2], [-0.36, 0], [-0.14, -0.06]])), solid(poly([[0.14, 0.08], [0.4, 0.2], [0.36, 0], [0.14, -0.06]]))],
  balloon: () => [solid(ellipse(0, 0.08, 0.26, 0.32)), solid(poly([[-0.04, -0.22], [0.04, -0.22], [0, -0.32]])), solid(poly([[-0.02, -0.32], [0.02, -0.32], [0.04, -0.46], [-0.04, -0.42]]))],
  gift: () => [
    solid(roundRect(0, -0.08, 0.56, 0.4, 0.04)),
    solid(rect(0, -0.08, 0.1, 0.4)),
    solid(rect(0, 0.16, 0.56, 0.12)),
    solid(ellipse(-0.12, 0.3, 0.12, 0.08)),
    solid(ellipse(0.12, 0.3, 0.12, 0.08)),
  ],
  house: () => [solid(rect(0, -0.16, 0.5, 0.36)), solid(poly([[-0.36, 0.02], [0.36, 0.02], [0, 0.4]])), hole(rect(0, -0.22, 0.14, 0.22))],
  car: () => [solid(roundRect(0, -0.08, 0.78, 0.28, 0.08)), solid(roundRect(-0.02, 0.12, 0.4, 0.2, 0.08)), solid(circle(-0.22, -0.22, 0.1)), solid(circle(0.22, -0.22, 0.1))],
  plane: () => [solid(ellipse(0.05, 0, 0.4, 0.08)), solid(poly([[-0.05, 0], [0.16, 0.28], [0.28, 0.22], [0.08, 0]])), solid(poly([[0.16, -0.02], [0.4, -0.14], [0.16, 0.02]]))],
  ball: () => [solid(circle(0, 0, 0.4)), hole(poly([[-0.08, 0.38], [0.08, 0.38], [0.16, 0.08], [-0.16, 0.08]]))],
  rainbow: () => [solid(ring(0, -0.16, 0.4, 0.08)), solid(ring(0, -0.16, 0.26, 0.07))],
  peace: () => [solid(circle(0, 0, 0.42)), hole(circle(0, 0, 0.3)), solid(rect(0, 0, 0.08, 0.6)), solid(poly([[0, 0], [-0.22, -0.28], [-0.12, -0.32], [0, -0.08]])), solid(poly([[0, 0], [0.22, -0.28], [0.12, -0.32], [0, -0.08]]))],
};

export function listCharms(group?: CharmGroup, query = "") {
  const needle = query.trim().toLowerCase();
  return catalog.filter((charm) => {
    if (group && charm.group !== group) return false;
    if (!needle) return true;
    return charm.label.toLowerCase().includes(needle) || charm.emoji.includes(needle) || charm.id.includes(needle);
  });
}

export function findCharm(id: string) {
  return catalog.find((charm) => charm.id === id) ?? null;
}

export function isEmojiCharm(id: string) {
  return catalog.some((charm) => charm.id === id && charm.group === "Emoji");
}

export function charmRings(id: string, cx: number, cy: number, size: number, _segments: number) {
  const draw = DRAW[id];
  if (!draw) return [];
  return draw().map((part) => ({
    points: part.points.map((point) => ({ x: cx + point.x * size, y: cy + point.y * size })),
    hole: part.hole,
  }));
}

function solid(points: Point[]): Part {
  return { points: wind(points, false) };
}

function hole(points: Point[]): Part {
  return { points: wind(points, true), hole: true };
}

function wind(points: Point[], asHole: boolean) {
  const ring = points.slice();
  const area = signed(ring);
  if (asHole ? area > 0 : area < 0) ring.reverse();
  return ring;
}

function signed(ring: Point[]) {
  let area = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const next = ring[(index + 1) % ring.length];
    area += ring[index].x * next.y - next.x * ring[index].y;
  }
  return area;
}

function circle(cx: number, cy: number, radius: number, segments = 28) {
  const points: Point[] = [];
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    points.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
  }
  return points;
}

function ellipse(cx: number, cy: number, rx: number, ry: number, tilt = 0, segments = 28) {
  const points: Point[] = [];
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    const x = Math.cos(angle) * rx;
    const y = Math.sin(angle) * ry;
    points.push({ x: cx + x * cos - y * sin, y: cy + x * sin + y * cos });
  }
  return points;
}

function rect(cx: number, cy: number, width: number, height: number) {
  const x = width / 2;
  const y = height / 2;
  return [
    { x: cx - x, y: cy - y },
    { x: cx + x, y: cy - y },
    { x: cx + x, y: cy + y },
    { x: cx - x, y: cy + y },
  ];
}

function roundRect(cx: number, cy: number, width: number, height: number, radius: number) {
  const hw = width / 2;
  const hh = height / 2;
  const r = Math.min(radius, hw, hh);
  const corners = [
    { x: cx + hw - r, y: cy + hh - r, a0: 0, a1: Math.PI / 2 },
    { x: cx - hw + r, y: cy + hh - r, a0: Math.PI / 2, a1: Math.PI },
    { x: cx - hw + r, y: cy - hh + r, a0: Math.PI, a1: Math.PI * 1.5 },
    { x: cx + hw - r, y: cy - hh + r, a0: Math.PI * 1.5, a1: Math.PI * 2 },
  ];
  const points: Point[] = [];
  for (const corner of corners) {
    for (let step = 0; step <= 4; step += 1) {
      const angle = corner.a0 + ((corner.a1 - corner.a0) * step) / 4;
      points.push({ x: corner.x + Math.cos(angle) * r, y: corner.y + Math.sin(angle) * r });
    }
  }
  return points;
}

function ring(cx: number, cy: number, radius: number, thickness: number) {
  return band(cx, cy, radius, thickness, 0, Math.PI * 2, 32);
}

function poly(points: [number, number][]) {
  return points.map(([x, y]) => ({ x, y }));
}

function star(cx: number, cy: number, radius: number, points: number) {
  const ringPoints: Point[] = [];
  for (let index = 0; index < points * 2; index += 1) {
    const length = index % 2 === 0 ? radius : radius * 0.42;
    const angle = -Math.PI / 2 + (index * Math.PI) / points;
    ringPoints.push({ x: cx + Math.cos(angle) * length, y: cy + Math.sin(angle) * length });
  }
  return ringPoints;
}

function heart(cx: number, cy: number, scale: number) {
  const points: Point[] = [];
  for (let index = 0; index < 40; index += 1) {
    const t = (index / 40) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    points.push({ x: cx + (x / 34) * scale * 2, y: cy + (y / 34) * scale * 2 });
  }
  return points;
}

function band(cx: number, cy: number, radius: number, thickness: number, start: number, end: number, steps: number) {
  const points: Point[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const angle = start + ((end - start) * step) / steps;
    points.push({ x: cx + Math.cos(angle) * (radius + thickness / 2), y: cy + Math.sin(angle) * (radius + thickness / 2) });
  }
  for (let step = steps; step >= 0; step -= 1) {
    const angle = start + ((end - start) * step) / steps;
    points.push({ x: cx + Math.cos(angle) * Math.max(0.02, radius - thickness / 2), y: cy + Math.sin(angle) * Math.max(0.02, radius - thickness / 2) });
  }
  return points;
}

function sunRays() {
  const rays: Part[] = [];
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2;
    rays.push(solid(rect(0, 0.36, 0.08, 0.16).map((point) => rotate(point, angle))));
  }
  return rays;
}

function detailedSnowflake() {
  const parts: Part[] = [solid(circle(0, 0, 0.12, 6))];
  for (let index = 0; index < 6; index += 1) {
    const angle = -Math.PI / 2 + (index / 6) * Math.PI * 2;
    parts.push(solid(spin(crystalArm(), angle)));
    for (const branch of crystalBranches()) parts.push(solid(spin(branch, angle)));
  }
  return parts;
}

function crystalArm() {
  return ribbon(
    [
      { x: -0.04, y: 0 },
      { x: 0.12, y: 0 },
      { x: 0.28, y: 0 },
      { x: 0.4, y: 0 },
      { x: 0.5, y: 0 },
    ],
    [0.12, 0.078, 0.056, 0.04, 0.022],
  );
}

function crystalBranches() {
  const specs = [
    { t: 0.22, length: 0.105, width: 0.042, twig: 0.05 },
    { t: 0.34, length: 0.12, width: 0.036, twig: 0.055 },
  ];
  const shapes: Point[][] = [];
  for (const spec of specs) {
    for (const sign of [-1, 1]) {
      const angle = sign * (Math.PI / 3);
      const direction = { x: Math.cos(angle), y: Math.sin(angle) };
      const start = { x: spec.t * 0.92, y: 0 };
      const end = { x: start.x + direction.x * spec.length, y: start.y + direction.y * spec.length };
      shapes.push(ribbon([start, { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, end], [spec.width, spec.width * 0.62, 0.016]));
      const mid = {
        x: start.x + direction.x * spec.length * 0.62,
        y: start.y + direction.y * spec.length * 0.62,
      };
      const twigAngle = angle + sign * (Math.PI / 3.4);
      shapes.push(
        ribbon(
          [
            mid,
            {
              x: mid.x + Math.cos(twigAngle) * spec.twig,
              y: mid.y + Math.sin(twigAngle) * spec.twig,
            },
          ],
          [spec.width * 0.62, 0.014],
        ),
      );
    }
  }
  return shapes;
}

function ribbon(points: Point[], widths: number[]) {
  const left: Point[] = [];
  const right: Point[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const prev = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const length = Math.hypot(tx, ty) || 1;
    tx /= length;
    ty /= length;
    const half = (widths[index] ?? widths[widths.length - 1] ?? 0.02) / 2;
    left.push({ x: points[index].x - ty * half, y: points[index].y + tx * half });
    right.push({ x: points[index].x + ty * half, y: points[index].y - tx * half });
  }
  const end = points[points.length - 1];
  const before = points[points.length - 2] ?? points[0];
  let tx = end.x - before.x;
  let ty = end.y - before.y;
  const length = Math.hypot(tx, ty) || 1;
  tx /= length;
  ty /= length;
  const radius = (widths[widths.length - 1] ?? 0.02) / 2;
  const cap: Point[] = [];
  for (let step = 1; step < 11; step += 1) {
    const turn = Math.atan2(ty, tx) + Math.PI / 2 - (Math.PI * step) / 11;
    cap.push({ x: end.x + Math.cos(turn) * radius, y: end.y + Math.sin(turn) * radius });
  }
  return [...left, ...cap, ...right.reverse()];
}

function spin(points: Point[], angle: number) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return points.map((point) => ({
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  }));
}

function featheredWings() {
  const parts: Part[] = [];
  for (const side of [-1, 1]) {
    parts.push(solid(ellipse(side * 0.22, 0.08, 0.24, 0.1, side * -0.5)));
    parts.push(solid(ellipse(side * 0.2, -0.02, 0.22, 0.09, side * -0.2)));
    parts.push(solid(ellipse(side * 0.16, -0.12, 0.16, 0.08, side * 0.15)));
  }
  return parts;
}

function rotate(point: Point, angle: number) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

function rad(degrees: number) {
  return (degrees * Math.PI) / 180;
}
