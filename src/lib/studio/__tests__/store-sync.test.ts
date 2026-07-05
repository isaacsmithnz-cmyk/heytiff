/* SyncedDesignStore: server is source of truth, localStorage is the crash
   buffer / offline fallback. These tests pin the recovery semantics. */

import { createDesign, type DesignDocument } from "../document";
import {
  LocalDesignStore,
  SyncedDesignStore,
  summarize,
  type DesignStore,
  type DesignSummary,
  type StorageLike,
} from "../store";

function fakeStorage(): StorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

class FakeRemote implements DesignStore {
  fail = false;
  docs = new Map<string, DesignDocument>();
  savedIds: string[] = [];

  private guard() {
    if (this.fail) throw new Error("network down");
  }
  async list(): Promise<DesignSummary[]> {
    this.guard();
    return [...this.docs.values()].map(summarize);
  }
  async load(id: string) {
    this.guard();
    return this.docs.get(id) ?? null;
  }
  async save(doc: DesignDocument) {
    this.guard();
    this.docs.set(doc.id, doc);
    this.savedIds.push(doc.id);
  }
  async remove(id: string) {
    this.guard();
    this.docs.delete(id);
  }
}

function setup() {
  const remote = new FakeRemote();
  const local = new LocalDesignStore(fakeStorage());
  return { remote, local, store: new SyncedDesignStore(remote, local) };
}

function touched(doc: DesignDocument, updatedAt: string): DesignDocument {
  return { ...doc, meta: { ...doc.meta, updatedAt } };
}

describe("SyncedDesignStore", () => {
  it("save writes to both stores", async () => {
    const { remote, local, store } = setup();
    const d = createDesign({ name: "Both", mode: "plan" });
    await store.save(d);
    expect(remote.docs.get(d.id)).toEqual(d);
    expect(await local.load(d.id)).toEqual(d);
  });

  it("save keeps the design locally even when the server is down", async () => {
    const { remote, local, store } = setup();
    remote.fail = true;
    const d = createDesign({ name: "Offline", mode: "plan" });
    await expect(store.save(d)).rejects.toThrow("network down");
    expect(await local.load(d.id)).toEqual(d);
  });

  it("list merges server rows with newer local edits and local-only designs", async () => {
    const { remote, local, store } = setup();
    const synced = createDesign({ name: "Synced", mode: "plan", now: "2026-07-01T00:00:00.000Z" });
    const edited = createDesign({ name: "Edited", mode: "plan", now: "2026-07-01T00:00:00.000Z" });
    const offlineOnly = createDesign({ name: "Offline only", mode: "blank", now: "2026-07-03T00:00:00.000Z" });
    remote.docs.set(synced.id, synced);
    remote.docs.set(edited.id, edited);
    await local.save(touched({ ...edited, meta: { ...edited.meta, name: "Edited v2" } }, "2026-07-02T00:00:00.000Z"));
    await local.save(offlineOnly);

    const list = await store.list();
    expect(list.map((s) => s.name)).toEqual(["Offline only", "Edited v2", "Synced"]);
  });

  it("list falls back to the local view when the server is down", async () => {
    const { remote, local, store } = setup();
    const d = createDesign({ name: "Local view", mode: "plan" });
    await local.save(d);
    remote.fail = true;
    expect((await store.list()).map((s) => s.id)).toEqual([d.id]);
  });

  it("load recovers a newer local copy and pushes it back to the server", async () => {
    const { remote, local, store } = setup();
    const base = createDesign({ name: "Recover", mode: "plan", now: "2026-07-01T00:00:00.000Z" });
    remote.docs.set(base.id, base);
    const newer = touched({ ...base, meta: { ...base.meta, name: "Recover (newer)" } }, "2026-07-02T00:00:00.000Z");
    await local.save(newer);

    const loaded = await store.load(base.id);
    expect(loaded?.meta.name).toBe("Recover (newer)");
    expect(remote.docs.get(base.id)?.meta.name).toBe("Recover (newer)");
  });

  it("load refreshes the local buffer from a newer server copy", async () => {
    const { remote, local, store } = setup();
    const base = createDesign({ name: "Stale local", mode: "plan", now: "2026-07-01T00:00:00.000Z" });
    await local.save(base);
    const serverNewer = touched({ ...base, meta: { ...base.meta, name: "Server copy" } }, "2026-07-02T00:00:00.000Z");
    remote.docs.set(base.id, serverNewer);

    const loaded = await store.load(base.id);
    expect(loaded?.meta.name).toBe("Server copy");
    expect((await local.load(base.id))?.meta.name).toBe("Server copy");
  });

  it("load works offline from the buffer alone", async () => {
    const { remote, local, store } = setup();
    const d = createDesign({ name: "Buffer only", mode: "blank" });
    await local.save(d);
    remote.fail = true;
    expect(await store.load(d.id)).toEqual(d);
  });

  it("remove deletes from both stores", async () => {
    const { remote, local, store } = setup();
    const d = createDesign({ name: "Gone", mode: "plan" });
    await store.save(d);
    await store.remove(d.id);
    expect(remote.docs.has(d.id)).toBe(false);
    expect(await local.load(d.id)).toBeNull();
  });
});
