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

/** A page is its path: its query is where you are on it (a view, the design
    open on the canvas), which the tab keeps but which doesn't make it
    another page. */
const pathOf = (href: string) => href.split(/[?#]/)[0];

/** The page changed, or where you are on it did: the tab you're on now holds
    it, unless another already does. The whole address is kept, query and
    all, so a tab you leave comes back to where you were on its page (Isaac,
    26 October 2026: from Design's canvas to a job's tab and back, it opened
    Design's list of designs, because the tab held only the path). */
export function arrive(href: string): void {
  load();
  const { tabs, on } = state;
  const current = tabs.find((t) => t.id === on);
  /* still the page the tab you're on holds: only where you are on it moved */
  if (current && !current.blank && pathOf(current.href) === pathOf(href)) {
    if (current.href !== href) set({ tabs: tabs.map((t) => (t.id === current.id ? { id: t.id, href } : t)), on });
    return;
  }
  const holder = tabs.find((t) => !t.blank && pathOf(t.href) === pathOf(href));
  if (holder) {
    set({
      tabs: tabs.filter((t) => !(t.blank && t.id !== holder.id)).map((t) => (t.id === holder.id ? { id: t.id, href } : t)),
      on: holder.id,
    });
    return;
  }
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

/** Open a page in a tab of its own (Isaac, 21 October 2026: Design's "open
    job and new tab button… so that you can quickly go back to the job if
    there isn't a tab already open for it"): the tab that already holds it,
    by its address without the query, or else a new one. Returns where to go. */
export function openInTab(href: string, from: string): string {
  load();
  const path = href.split("?")[0];
  const holder = state.tabs.find((t) => !t.blank && t.href.split("?")[0] === path);
  if (holder) return choose(holder.id) ?? href;
  newTab(from);
  return href;
}

/** A new, empty tab you're on; the next page you open fills it. */
export function newTab(from: string): void {
  const id = mint();
  set({ tabs: [...state.tabs.filter((t) => !t.blank), { id, href: from, blank: true }], on: id });
}
