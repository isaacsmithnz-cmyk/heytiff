/* Design Studio — persistence.
   DesignStore is the seam: the studio UI only talks to this interface, so the
   backing can move from localStorage (v1, also the autosave/recovery buffer)
   to Supabase without touching the editor. All methods are async for that
   reason even though the local implementation is synchronous underneath. */

import {
  serializeDesign,
  type DesignDocument,
  type DesignMeta,
} from "./document";
import { openDesignJson } from "./migrations";

/** What the home screen's recent-designs grid needs — listable without
    parsing every full document. */
export interface DesignSummary {
  id: string;
  name: string;
  mode: DesignMeta["mode"];
  createdAt: string;
  updatedAt: string;
  floorCount: number;
  systemCount: number;
}

export interface DesignStore {
  list(): Promise<DesignSummary[]>;
  load(id: string): Promise<DesignDocument | null>;
  save(doc: DesignDocument): Promise<void>;
  remove(id: string): Promise<void>;
  /** Optional cheap crash-buffer write (local only, no network). */
  stash?(doc: DesignDocument): Promise<void>;
  /** Optional: what this machine already knows, WITHOUT the network. The home
      screen paints this first — see SyncedDesignStore.listLocal. */
  listLocal?(): Promise<DesignSummary[]>;
}

/* Minimal Storage surface so tests can pass a plain-object fake. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const INDEX_KEY = "heytiff.studio.index";
const DOC_PREFIX = "heytiff.studio.design.";

export function summarize(doc: DesignDocument): DesignSummary {
  return {
    id: doc.id,
    name: doc.meta.name,
    mode: doc.meta.mode,
    createdAt: doc.meta.createdAt,
    updatedAt: doc.meta.updatedAt,
    floorCount: doc.floors.length,
    systemCount: doc.systems.length,
  };
}

export class LocalDesignStore implements DesignStore {
  constructor(private storage: StorageLike) {}

  private readIndex(): DesignSummary[] {
    const raw = this.storage.getItem(INDEX_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as DesignSummary[]) : [];
    } catch {
      return [];
    }
  }

  private writeIndex(index: DesignSummary[]): void {
    this.storage.setItem(INDEX_KEY, JSON.stringify(index));
  }

  async list(): Promise<DesignSummary[]> {
    return this.readIndex().sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    );
  }

  async load(id: string): Promise<DesignDocument | null> {
    const raw = this.storage.getItem(DOC_PREFIX + id);
    if (!raw) return null;
    const { doc, migratedFrom } = openDesignJson(raw);
    // persist the migrated shape immediately so the stored copy is current
    if (migratedFrom !== null) await this.save(doc);
    return doc;
  }

  async save(doc: DesignDocument): Promise<void> {
    this.storage.setItem(DOC_PREFIX + doc.id, serializeDesign(doc));
    const index = this.readIndex().filter((s) => s.id !== doc.id);
    index.push(summarize(doc));
    this.writeIndex(index);
  }

  async remove(id: string): Promise<void> {
    this.storage.removeItem(DOC_PREFIX + id);
    this.writeIndex(this.readIndex().filter((s) => s.id !== id));
  }
}

/* ── Synced store: server is the source of truth, localStorage is the crash
      buffer and offline fallback. Recency is decided by meta.updatedAt (ISO
      strings compare lexically). Known limitation, tracked on the board: a
      delete that fails remotely can resurface from the server on reconnect. ── */

export class SyncedDesignStore implements DesignStore {
  constructor(
    private remote: DesignStore,
    private local: DesignStore
  ) {}

  /** Instant local-only write — called on every edit so a crash between
      debounced server saves never loses work. */
  stash(doc: DesignDocument): Promise<void> {
    return this.local.save(doc);
  }

  /* WHAT THIS MACHINE ALREADY KNOWS, and knows instantly.

     `list()` below waits on the server before it answers, because the merge
     needs both halves. That is right for the answer and wrong for the FIRST
     paint: the local index is a localStorage read, and holding it behind a
     network round trip left the home screen claiming "No designs yet" for as
     long as the server took — which in production is over three seconds.

     So the home screen paints this, then replaces it with the merged list.
     Stale for that moment by exactly the amount the merge already tolerates:
     a design deleted on another machine lingers for one round trip, which is
     the same window in which `list()` lets unsynced local edits win. */
  listLocal(): Promise<DesignSummary[]> {
    return this.local.list();
  }

  async list(): Promise<DesignSummary[]> {
    const [r, l] = await Promise.allSettled([
      this.remote.list(),
      this.local.list(),
    ]);
    const local = l.status === "fulfilled" ? l.value : [];
    if (r.status !== "fulfilled") return local; // offline — local view
    const byId = new Map(r.value.map((s) => [s.id, s]));
    for (const s of local) {
      const seen = byId.get(s.id);
      if (!seen || s.updatedAt > seen.updatedAt) byId.set(s.id, s); // unsynced local edits win
    }
    return [...byId.values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    );
  }

  async load(id: string): Promise<DesignDocument | null> {
    const [r, l] = await Promise.allSettled([
      this.remote.load(id),
      this.local.load(id),
    ]);
    const remote = r.status === "fulfilled" ? r.value : null;
    const local = l.status === "fulfilled" ? l.value : null;
    if (local && (!remote || local.meta.updatedAt > remote.meta.updatedAt)) {
      // crash/offline recovery: the local buffer is ahead — push it back up
      try {
        await this.remote.save(local);
      } catch {
        /* still offline; the buffer keeps it */
      }
      return local;
    }
    if (remote) await this.local.save(remote); // refresh the buffer
    return remote ?? local;
  }

  async save(doc: DesignDocument): Promise<void> {
    await this.local.save(doc); // never lose it, whatever the network does
    await this.remote.save(doc); // may throw — caller shows "saved locally"
  }

  async remove(id: string): Promise<void> {
    await this.local.remove(id);
    await this.remote.remove(id);
  }
}

/** The browser store. Guarded so importing this module server-side is safe;
    call only from client components. */
export function browserDesignStore(): DesignStore {
  if (typeof window === "undefined") {
    throw new Error("browserDesignStore() is client-only");
  }
  return new LocalDesignStore(window.localStorage);
}

/* ── Design file import/export (Stage 0 Enhance) ── */

export function designFileName(doc: DesignDocument): string {
  const slug =
    doc.meta.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "design";
  return `${slug}.heytiff-design.json`;
}

export function exportDesignJson(doc: DesignDocument): string {
  return JSON.stringify(doc, null, 2);
}
