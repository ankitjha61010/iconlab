import { useCallback, useRef, useState } from 'react';

const LIMIT = 200;
/**
 * Changes with the same group key closer together than this merge into one
 * undo step (slider drags). Groups starting with "@" always merge — one per
 * drag gesture, however long it pauses.
 */
const MERGE_MS = 700;

/** Structural equality for plain state (objects, arrays, primitives). */
function isEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && isEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

/**
 * Undoable state. `set(next, group)` records a step; rapid calls that share a
 * `group` (e.g. one slider being dragged) collapse into a single step.
 */
export function useHistory<T>(initial: T) {
  const [history, setHistory] = useState<History<T>>({ past: [], present: initial, future: [] });
  const last = useRef<{ group: string | null; at: number }>({ group: null, at: 0 });

  const set = useCallback((update: T | ((prev: T) => T), group: string | null = null) => {
    const now = Date.now();
    const merge = group !== null && last.current.group === group && (group.startsWith('@') || now - last.current.at < MERGE_MS);
    last.current = { group, at: now };
    setHistory((h) => {
      const next = typeof update === 'function' ? (update as (prev: T) => T)(h.present) : update;
      // A change that leaves everything as it was isn't a step.
      if (isEqual(next, h.present)) return h;
      if (merge) {
        // A merged drag that ends back where it started cancels its step.
        const before = h.past[h.past.length - 1];
        if (h.past.length && isEqual(next, before)) {
          // Moving on from here starts a fresh step rather than merging into the previous one.
          last.current.group = null;
          return { past: h.past.slice(0, -1), present: before, future: [] };
        }
        return { past: h.past, present: next, future: [] };
      }
      return { past: [...h.past, h.present].slice(-LIMIT), present: next, future: [] };
    });
  }, []);

  const undo = useCallback(() => {
    last.current.group = null;
    setHistory((h) => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h));
  }, []);

  const redo = useCallback(() => {
    last.current.group = null;
    setHistory((h) => (h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h));
  }, []);

  /** Replaces the state and clears the history (e.g. a new image). */
  const reset = useCallback((value: T) => {
    last.current.group = null;
    setHistory({ past: [], present: value, future: [] });
  }, []);

  return {
    state: history.present,
    set,
    undo,
    redo,
    reset,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}
