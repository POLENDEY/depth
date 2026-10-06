"use client";

import { useEffect, useRef, useState } from "react";
import { charmGroups, findCharm, listCharms, type CharmGroup } from "@/lib/charms";

export function CharmPicker({ onAdd, onClear }: { onAdd: (id: string) => void; onClear: () => void }) {
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<CharmGroup | "All">("All");
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const charms = listCharms(group === "All" ? undefined : group, query);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-label="Add emoji"
        onClick={() => setOpen((current) => !current)}
        className="grid h-10 w-10 place-items-center rounded-lg border border-[#e6e7ec] bg-white text-zinc-500 hover:bg-zinc-50"
      >
        <PlusIcon />
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-[22rem] rounded-xl border border-[#e6e7ec] bg-white p-3 shadow-xl">
          <div className="mb-2 flex items-center gap-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search emojis"
              className="h-9 min-w-0 flex-1 rounded-lg border border-[#e6e7ec] px-2 text-sm outline-none focus:border-[#8ed4ad]"
            />
            <button
              type="button"
              onClick={() => {
                onClear();
                setOpen(false);
              }}
              className="h-9 rounded-lg border border-[#e6e7ec] px-2 text-xs text-zinc-600 hover:bg-zinc-50"
            >
              None
            </button>
          </div>
          <div className="mb-2 flex gap-1 overflow-x-auto">
            {(["All", ...charmGroups()] as const).map((entry) => (
              <button
                key={entry}
                type="button"
                onClick={() => setGroup(entry)}
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${
                  group === entry ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                }`}
              >
                {entry}
              </button>
            ))}
          </div>
          <div className="grid max-h-72 grid-cols-8 gap-1 overflow-y-auto">
            {charms.map((charm) => (
              <button
                key={charm.id}
                type="button"
                title={charm.label}
                aria-label={charm.label}
                onClick={() => onAdd(charm.id)}
                className="grid h-10 place-items-center rounded-lg text-zinc-900 hover:bg-zinc-100"
              >
                <EmojiArt id={charm.id} />
              </button>
            ))}
          </div>
          {charms.length === 0 ? <p className="px-1 py-6 text-center text-sm text-zinc-400">No matching icons.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export function CharmStrip({
  charms,
  selected,
  onSelect,
  onRemove,
}: {
  charms: { id: string }[];
  selected: number;
  onSelect: (index: number) => void;
  onRemove: (index: number) => void;
}) {
  if (!charms.length) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1">
      {charms.map((charm, index) => {
        const found = findCharm(charm.id);
        return (
          <li key={`${charm.id}-${index}`}>
            <span
              className={`inline-flex items-center gap-0.5 rounded-lg border pl-1 ${
                index === selected ? "border-[#c7b9ff] bg-[#f3efff]" : "border-[#e6e7ec] bg-white"
              }`}
            >
              <button
                type="button"
                aria-label={found?.label ?? "Emoji"}
                aria-pressed={index === selected}
                onClick={() => onSelect(index)}
                className="grid h-8 w-8 place-items-center"
              >
                {found ? <EmojiArt id={found.id} /> : null}
              </button>
              <button
                type="button"
                aria-label={`Remove ${found?.label ?? "emoji"}`}
                onClick={() => onRemove(index)}
                className="grid h-8 w-6 place-items-center text-sm text-zinc-400 hover:text-zinc-700"
              >
                ×
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function EmojiArt({ id }: { id: string }) {
  return <img src={`/emoji/${id}.svg`} alt="" draggable={false} className="h-6 w-6 object-contain" />;
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M8 3.2v9.6M3.2 8h9.6" />
    </svg>
  );
}
