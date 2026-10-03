"use client";

import { parse, type Font } from "opentype.js";
import { useCallback, useEffect, useState } from "react";
import { FONTS, fontById, loadFont, type FontId } from "./fonts";

const DB_NAME = "depth-fonts";
const STORE = "fonts";
const MAX_BYTES = 4 * 1024 * 1024;

export type ImportedFont = {
  id: string;
  name: string;
  family: string;
};

type FontRow = ImportedFont & { buffer: ArrayBuffer };

const parsed = new Map<string, Promise<Font>>();

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open font storage."));
  });
}

async function requestStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = run(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not update saved fonts."));
  });
}

async function readRows() {
  return requestStore<FontRow[]>("readonly", (store) => store.getAll());
}

async function registerFace(row: FontRow) {
  const already = [...document.fonts].some((face) => face.family === row.family);
  if (already) return;
  const face = new FontFace(row.family, row.buffer.slice(0));
  await face.load();
  document.fonts.add(face);
}

export function isBuiltinFont(id: string): id is FontId {
  return FONTS.some((font) => font.id === id);
}

export function useFontLibrary() {
  const [imported, setImported] = useState<ImportedFont[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const rows = await readRows();
    await Promise.all(rows.map((row) => registerFace(row).catch(() => undefined)));
    setImported(rows.map(({ id, name, family }) => ({ id, name, family })));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh().catch(() => {
        setError("Saved fonts could not be loaded.");
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const load = useCallback(async (id: string) => {
    if (isBuiltinFont(id)) return loadFont(fontById(id).file);
    const cached = parsed.get(id);
    if (cached) return cached;
    const pending = readRows().then((rows) => {
      const row = rows.find((entry) => entry.id === id);
      if (!row) throw new Error("That imported font was removed. Choose another font.");
      return parse(row.buffer.slice(0));
    });
    parsed.set(id, pending);
    try {
      return await pending;
    } catch (reason) {
      parsed.delete(id);
      throw reason;
    }
  }, []);

  const importFile = useCallback(async (file: File) => {
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !["ttf", "otf", "woff"].includes(extension)) {
      throw new Error("Use a TTF, OTF, or WOFF font.");
    }
    if (file.size > MAX_BYTES) throw new Error("That font is larger than 4 MB.");
    const buffer = await file.arrayBuffer();
    const parsedFont = parse(buffer.slice(0));
    const glyphCount = parsedFont.glyphs.length;
    if (!glyphCount) throw new Error("That font has no glyphs.");
    const id = `import-${crypto.randomUUID()}`;
    const name =
      parsedFont.names.fullName?.en ||
      parsedFont.names.fontFamily?.en ||
      file.name.replace(/\.[^.]+$/, "");
    const row: FontRow = { id, name, family: `Imported-${id}`, buffer };
    await requestStore("readwrite", (store) => store.put(row));
    await registerFace(row);
    parsed.set(id, Promise.resolve(parsedFont));
    setImported((current) => [...current, { id, name, family: row.family }]);
    setError(null);
    return id;
  }, []);

  const remove = useCallback(async (id: string) => {
    await requestStore("readwrite", (store) => store.delete(id));
    parsed.delete(id);
    setImported((current) => current.filter((font) => font.id !== id));
  }, []);

  const family = useCallback(
    (id: string) => {
      if (isBuiltinFont(id)) return fontById(id).css;
      return imported.find((font) => font.id === id)?.family ?? "system-ui";
    },
    [imported],
  );

  return { imported, error, setError, load, importFile, remove, family };
}
