import type { Hue } from "@/components/parts/state";

/* WHAT A PAGE IS CALLED IN ITS OPEN TAB, when its address can't say it.

   The header names a tab by its address (topbar.tsx, `tabName`): the place
   or screen whose address starts the page's. A record's page is named by
   the record, "3209 Richards", and the header can't read the record. So the
   page says its own name here, keyed by its path, and the header reads it
   first. A job's page names itself with its number, its short name and its
   colour.

   Kept for the browser tab (sessionStorage), as the open tabs are, so a tab
   left on a job keeps its name across a reload; a few dozen at most. */

export type PageName = { label: string; hue?: Hue };
type Names = Readonly<Record<string, PageName>>;

const KEY = "ht:names";
const MAX = 40;
let names: Names = {};
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const read = raw ? (JSON.parse(raw) as unknown) : null;
    if (read && typeof read === "object" && !Array.isArray(read)) {
      const kept: Record<string, PageName> = {};
      for (const [path, n] of Object.entries(read as Record<string, PageName>)) {
        if (typeof n?.label === "string") kept[path] = n.hue ? { label: n.label, hue: n.hue } : { label: n.label };
      }
      names = kept;
    }
  } catch {
    /* a private window or blocked storage: names last for the page only */
  }
}

const pathOf = (href: string) => href.split(/[?#]/)[0] ?? href;

/** The page at this path is called this. The newest names are kept. */
export function namePage(href: string, name: PageName): void {
  load();
  const path = pathOf(href);
  const was = names[path];
  if (was && was.label === name.label && was.hue === name.hue) return;
  const rest = Object.entries(names).filter(([p]) => p !== path);
  names = Object.fromEntries([...rest.slice(Math.max(0, rest.length - (MAX - 1))), [path, name]]);
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(names));
  } catch {
    /* as above */
  }
  for (const l of listeners) l();
}

export function subscribePageNames(fn: () => void): () => void {
  load();
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function pageNamesSnapshot(): Names {
  load();
  return names;
}
const NONE: Names = {};
export const pageNamesServerSnapshot = (): Names => NONE;

/** The name a page gave itself, if it gave one. */
export const pageName = (all: Names, href: string): PageName | null => all[pathOf(href)] ?? null;
