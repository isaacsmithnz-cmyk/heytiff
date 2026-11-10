"use client";

import { useSyncExternalStore } from "react";
import type { Person } from "@/lib/staff/people-named";

/* THE NAMES THE BOX KNOWS (Isaac, 11 November 2026, "yes" to the web's box
   colouring a person's name as the phone's does). The workspace's people from
   api/people, read once for every box on the page and again at most every
   ten minutes. Until they've come, and wherever the read fails, the names
   stay plain. The server's first paint has none, so it and the browser's
   agree. */

const FRESH_MS = 10 * 60_000;
const NONE: Person[] = [];

let known: Person[] = NONE;
let readAt = 0;
let reading = false;
const listeners = new Set<() => void>();

function refresh() {
  if (reading || Date.now() - readAt < FRESH_MS) return;
  reading = true;
  void Promise.resolve()
    .then(() => fetch("/api/people", { cache: "no-store" }))
    .then((r) => (r.ok ? (r.json() as Promise<{ people?: unknown }>) : { people: undefined }))
    .catch(() => ({ people: undefined }))
    .then((b) => {
      reading = false;
      readAt = Date.now();
      if (!Array.isArray(b.people)) return;
      known = (b.people as Person[]).filter((p) => p && typeof p.name === "string" && Array.isArray(p.words));
      for (const fire of listeners) fire();
    });
}

export function usePeople(): readonly Person[] {
  return useSyncExternalStore(
    (fire) => {
      listeners.add(fire);
      refresh();
      return () => listeners.delete(fire);
    },
    () => known,
    () => NONE,
  );
}

/** For tests: forget what was read. */
export function forgetPeople(next: Person[] = NONE) {
  known = next;
  readAt = next === NONE ? 0 : Date.now();
  reading = false;
}
