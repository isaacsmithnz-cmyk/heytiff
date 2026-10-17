/* OPEN TABS (docs/design.md rules 10 and 11), desktop only.

   A tab holds a page. Moving about in the app moves the tab you're on; a
   tab you aren't on keeps the page it was left on. Two tabs never show the
   same page: going to a page another tab already holds switches to that tab,
   and the one you came from keeps where it was.

   The list lives for the browser tab (sessionStorage), the way a browser's
   own tabs do, so a reload keeps it and a new window starts with one. It is
   a small external store rather than state in the header, so the header can
   be a server slot and still read it. */

export type OpenTab = { id: string; href: string; blank?: true };
type State = { tabs: OpenTab[]; on: string | null };

const KEY = "ht:tabs";
let state: State = { tabs: [], on: null };
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw) {
      const read = JSON.parse(raw) as State;
      if (Array.isArray(read.tabs)) state = { tabs: read.tabs.filter((t) => typeof t?.href === "string"), on: read.on ?? null };
    }
  } catch {
    /* a private window or blocked storage: tabs last for the page only */
  }
}

function set(next: State) {
  state = next;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* as above */
  }
  for (const l of listeners) l();
}

let seq = 0;
const mint = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

export function subscribeTabs(fn: () => void): () => void {
  load();
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function tabsSnapshot(): State {
  load();
  return state;
}
const EMPTY: State = { tabs: [], on: null };
export function tabsServerSnapshot(): State {
  return EMPTY;
}

/** The page changed: the tab you're on now holds it, unless another already does. */
export function arrive(href: string): void {
  load();
  const { tabs, on } = state;
  const holder = tabs.find((t) => t.href === href && !t.blank);
  if (holder) {
    if (holder.id !== on) set({ tabs: tabs.filter((t) => !(t.blank && t.id !== holder.id)), on: holder.id });
    return;
  }
  const current = tabs.find((t) => t.id === on);
  if (!current) {
    const id = mint();
    set({ tabs: [...tabs, { id, href }], on: id });
    return;
  }
  set({ tabs: tabs.map((t) => (t.id === current.id ? { id: t.id, href } : t)), on: current.id });
}

/** Go to a tab. Returns the page to show. */
export function choose(id: string): string | null {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab) return null;
  set({ tabs: state.tabs.filter((t) => !t.blank || t.id === id), on: id });
  return tab.href;
}

/** Close a tab. Returns the page to show when it was the one you're on. */
export function closeTab(id: string): string | null {
  const i = state.tabs.findIndex((t) => t.id === id);
  if (i < 0) return null;
  const tabs = state.tabs.filter((t) => t.id !== id);
  if (state.on !== id) {
    set({ tabs, on: state.on });
    return null;
  }
  const next = tabs[Math.min(i, tabs.length - 1)] ?? null;
  set({ tabs, on: next?.id ?? null });
  return next?.href ?? null;
}

/** A new, empty tab you're on; the next page you open fills it. */
export function newTab(from: string): void {
  const id = mint();
  set({ tabs: [...state.tabs.filter((t) => !t.blank), { id, href: from, blank: true }], on: id });
}
