import alias from "./emoji-alias.json";
import catalog from "./emoji-catalog.json";

export type CharmGroup =
  | "Smileys"
  | "People"
  | "Animals"
  | "Food"
  | "Places"
  | "Activities"
  | "Objects"
  | "Symbols"
  | "Flags";

export type Charm = {
  id: string;
  label: string;
  emoji: string;
  group: CharmGroup;
  search: string;
};

const GROUPS: CharmGroup[] = [
  "Smileys",
  "People",
  "Animals",
  "Food",
  "Places",
  "Activities",
  "Objects",
  "Symbols",
  "Flags",
];

const CHARMS = catalog as Charm[];
const BY_ID = new Map(CHARMS.map((charm) => [charm.id, charm]));
const ALIAS = alias as Record<string, string>;
const FACE_GROUPS = new Set<CharmGroup>(["Smileys", "People"]);

type Ring = [number, number][];
type CharmArt = { body: Ring[]; mark: Ring[]; pupil: Ring[] };
const art = new Map<string, CharmArt>();

function asArt(data: unknown): CharmArt {
  if (Array.isArray(data)) return { body: [], mark: data as Ring[], pupil: [] };
  const record = data as Partial<CharmArt>;
  return {
    body: record.body ?? [],
    mark: record.mark ?? [],
    pupil: record.pupil ?? [],
  };
}

export function charmGroups() {
  return GROUPS;
}

export function listCharms(group?: CharmGroup, query = "") {
  const needle = query.trim().toLowerCase();
  return CHARMS.filter((charm) => {
    if (group && charm.group !== group) return false;
    if (!needle) return true;
    return charm.search.includes(needle) || charm.emoji.includes(query.trim()) || charm.id.toLowerCase().includes(needle);
  });
}

export function findCharm(id: string) {
  return BY_ID.get(ALIAS[id] ?? id) ?? null;
}

export function isEmojiCharm(id: string) {
  const charm = findCharm(id);
  return Boolean(charm && FACE_GROUPS.has(charm.group));
}

export async function ensureCharmArt(id: string) {
  if (!id) return;
  const charm = findCharm(id);
  if (!charm) throw new Error("That emoji is not available.");
  if (art.has(charm.id)) return;
  const response = await fetch(`/emoji/${charm.id}.json`);
  if (!response.ok) throw new Error("Could not load that emoji.");
  const loaded = asArt(await response.json());
  if (!loaded.body.length && !loaded.mark.length) throw new Error("Could not load that emoji.");
  art.set(charm.id, loaded);
}

function placeRings(rings: Ring[], cx: number, cy: number, size: number) {
  return rings.map((ring) => ({
    points: ring.map(([x, y]) => ({ x: cx + x * size, y: cy + y * size })),
  }));
}

export function charmLayers(id: string, cx: number, cy: number, size: number) {
  const charm = findCharm(id);
  const loaded = charm ? art.get(charm.id) : undefined;
  if (!loaded || (!loaded.body.length && !loaded.mark.length)) return null;
  return {
    body: placeRings(loaded.body, cx, cy, size),
    mark: placeRings(loaded.mark, cx, cy, size),
    pupil: placeRings(loaded.pupil, cx, cy, size),
  };
}

export function charmRings(id: string, cx: number, cy: number, size: number, _segments: number) {
  const charm = findCharm(id);
  const loaded = charm ? art.get(charm.id) : undefined;
  if (!loaded) return [];
  return placeRings([...loaded.body, ...loaded.mark, ...loaded.pupil], cx, cy, size).map((ring) => ({
    ...ring,
    hole: false,
  }));
}
