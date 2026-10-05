"use client";

import { useEffect, useRef, useState } from "react";
import { charmGroups, charmRings, findCharm, isEmojiCharm, listCharms, type CharmGroup } from "@/lib/charms";

export function CharmPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<CharmGroup | "All">("All");
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const selected = findCharm(value);
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
        aria-label={selected ? `Icon ${selected.label}` : "Add icon"}
        onClick={() => setOpen((current) => !current)}
        className={`grid h-10 w-10 place-items-center rounded-lg border ${
          selected
            ? "border-[#c7b9ff] bg-[#f3efff] text-zinc-900"
            : "border-[#e6e7ec] bg-white text-zinc-500 hover:bg-zinc-50"
        }`}
      >
        {selected ? <CharmMark id={selected.id} className="h-6 w-6" /> : <PawIcon />}
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-[22rem] rounded-xl border border-[#e6e7ec] bg-white p-3 shadow-xl">
          <div className="mb-2 flex items-center gap-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search icons"
              className="h-9 min-w-0 flex-1 rounded-lg border border-[#e6e7ec] px-2 text-sm outline-none focus:border-[#8ed4ad]"
            />
            <button
              type="button"
              onClick={() => {
                onChange("");
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
          <div className="grid max-h-64 grid-cols-6 gap-1 overflow-y-auto">
            {charms.map((charm) => (
              <button
                key={charm.id}
                type="button"
                title={charm.label}
                aria-label={charm.label}
                aria-pressed={charm.id === value}
                onClick={() => {
                  onChange(charm.id);
                  setOpen(false);
                }}
                className={`grid h-10 place-items-center rounded-lg text-zinc-900 hover:bg-zinc-100 ${
                  charm.id === value ? "bg-[#f3efff]" : ""
                }`}
              >
                <CharmMark id={charm.id} className="h-7 w-7" />
              </button>
            ))}
          </div>
          {charms.length === 0 ? <p className="px-1 py-6 text-center text-sm text-zinc-400">No matching icons.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function CharmMark({ id, className }: { id: string; className?: string }) {
  const parts = charmRings(id, 0, 0, 1, 48);
  const path = parts
    .map((part) => {
      const commands = part.points.map((point) => `${point.x.toFixed(3)} ${(-point.y).toFixed(3)}`);
      return `M ${commands.join(" L ")} Z`;
    })
    .join(" ");
  return (
    <svg viewBox="-0.58 -0.58 1.16 1.16" className={className} aria-hidden="true">
      {isEmojiCharm(id) ? <circle cx="0" cy="0" r="0.44" fill="currentColor" opacity="0.28" /> : null}
      <path d={path} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

function PawIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <ellipse cx="8" cy="10.2" rx="2.5" ry="2.1" />
      <circle cx="4.7" cy="7.2" r="1.25" />
      <circle cx="8" cy="5.6" r="1.25" />
      <circle cx="11.3" cy="7.2" r="1.25" />
    </svg>
  );
}
