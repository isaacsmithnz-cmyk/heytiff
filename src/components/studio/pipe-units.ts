"use client";
/* ── how pipe sizes read: inches (the default — copper is sold in inches
   here) or millimetres (the books' figures). A setting about the person at
   this machine, like the tool hints (hints.ts), so it lives in localStorage
   and not in the document. */

import { useSyncExternalStore } from "react";
import type { PipeUnits } from "@/lib/studio/pipe-sizes";

const KEY = "ht-studio-pipe-units";

function read(): PipeUnits {
  try {
    return localStorage.getItem(KEY) === "mm" ? "mm" : "in";
  } catch {
    return "in";
  }
}
const serverUnits = (): PipeUnits => "in";

const listeners = new Set<() => void>();
export function setPipeUnits(units: PipeUnits) {
  try {
    localStorage.setItem(KEY, units);
  } catch {
    /* private mode — the choice won't survive a reload, but it works now */
  }
  listeners.forEach((l) => l());
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

/** inches or millimetres, live across every canvas and browser tab */
export function usePipeUnits(): PipeUnits {
  return useSyncExternalStore(subscribe, read, serverUnits);
}
