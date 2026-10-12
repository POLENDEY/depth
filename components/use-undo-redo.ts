"use client";

import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";

const MAX_HISTORY = 50;
const GROUP_DELAY = 500;

export function useUndoRedo<T>(initialState: T) {
  const [state, setState] = useState(initialState);
  const [availability, setAvailability] = useState({ canUndo: false, canRedo: false });
  const stateRef = useRef(state);
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const lastChange = useRef(0);

  const refreshAvailability = useCallback(() => {
    setAvailability({
      canUndo: past.current.length > 0,
      canRedo: future.current.length > 0,
    });
  }, []);

  const update = useCallback((action: SetStateAction<T>) => {
    const current = stateRef.current;
    const next = typeof action === "function" ? (action as (previous: T) => T)(current) : action;
    if (JSON.stringify(current) === JSON.stringify(next)) return;

    const now = Date.now();
    if (now - lastChange.current > GROUP_DELAY) {
      past.current.push(current);
      if (past.current.length > MAX_HISTORY) past.current.shift();
    }
    lastChange.current = now;
    future.current = [];
    stateRef.current = next;
    setState(next);
    refreshAvailability();
  }, [refreshAvailability]);

  const undo = useCallback(() => {
    const previous = past.current.pop();
    if (previous === undefined) return;
    future.current.push(stateRef.current);
    stateRef.current = previous;
    lastChange.current = 0;
    setState(previous);
    refreshAvailability();
  }, [refreshAvailability]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (next === undefined) return;
    past.current.push(stateRef.current);
    stateRef.current = next;
    lastChange.current = 0;
    setState(next);
    refreshAvailability();
  }, [refreshAvailability]);

  const { canUndo, canRedo } = availability;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable='true']")) return;

      if (event.key.toLowerCase() === "z") {
        if (event.shiftKey ? canRedo : canUndo) {
          event.preventDefault();
          if (event.shiftKey) redo();
          else undo();
        }
      } else if (event.key.toLowerCase() === "y" && canRedo) {
        event.preventDefault();
        redo();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [canRedo, canUndo, redo, undo]);

  return { state, update, undo, redo, canUndo, canRedo };
}
