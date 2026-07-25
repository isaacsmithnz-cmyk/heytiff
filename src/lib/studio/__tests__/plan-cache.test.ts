/* Plan rasters are cached by REF (field feedback 2026-07-26: "the plan slowly
   loads into frame").

   Opening a design re-downloaded every sheet in full, because each open signs a
   NEW storage URL — so the browser's own cache never had a hope of matching it.
   A ref's bytes never change, so they cache under the ref and later opens paint
   with no network at all. */

const planImageUrl = jest.fn();
const deletePlanImage = jest.fn();
jest.mock("@/app/actions/studio-plans", () => ({
  planImageUrl: (...a: unknown[]) => planImageUrl(...a),
  deletePlanImage: (...a: unknown[]) => deletePlanImage(...a),
  createPlanUpload: jest.fn(),
}));

import { RemotePlanImages } from "../plans";

/* a Cache Storage stand-in — jsdom has none */
class FakeCache {
  store = new Map<string, Blob>();
  async match(k: string) {
    const b = this.store.get(k);
    return b ? { blob: async () => b } : undefined;
  }
  async put(k: string, res: { blob: () => Promise<Blob> }) {
    this.store.set(k, await res.blob());
  }
  async delete(k: string) {
    return this.store.delete(k);
  }
}

let cache: FakeCache;
let fetched: string[];

beforeEach(() => {
  jest.clearAllMocks();
  cache = new FakeCache();
  fetched = [];
  (globalThis as { caches?: unknown }).caches = { open: async () => cache };
  globalThis.fetch = (async (u: string) => {
    fetched.push(u);
    return { ok: true, blob: async () => new Blob(["raster"]) };
  }) as unknown as typeof fetch;
  let n = 0;
  URL.createObjectURL = jest.fn(() => `blob:raster-${++n}`);
  URL.revokeObjectURL = jest.fn();
  // every signing mints a DIFFERENT url — that is the whole problem
  let signed = 0;
  planImageUrl.mockImplementation(async () => `https://store/plan.png?token=${++signed}`);
});

afterEach(() => {
  delete (globalThis as { caches?: unknown }).caches;
});

/** let the background warm-up settle */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("plan raster cache", () => {
  it("first open streams from the signed URL and warms the cache behind it", async () => {
    const images = new RemotePlanImages();
    const url = await images.url("org1/a.png");

    // the caller gets the signed URL straight away — the image starts loading
    // now rather than waiting on a fetch-then-blob round trip
    expect(url).toBe("https://store/plan.png?token=1");
    await settle();
    expect(fetched).toEqual(["https://store/plan.png?token=1"]);
    expect(cache.store.size).toBe(1);
  });

  it("a later open paints from the cache — no signing, no download", async () => {
    const first = new RemotePlanImages();
    await first.url("org1/a.png");
    await settle();

    planImageUrl.mockClear();
    fetched = [];
    // a fresh instance stands in for a fresh page load
    const second = new RemotePlanImages();
    const url = await second.url("org1/a.png");

    expect(url).toMatch(/^blob:/);
    expect(planImageUrl).not.toHaveBeenCalled();
    expect(fetched).toEqual([]);
  });

  it("hands back the same object URL for a ref, rather than leaking one each time", async () => {
    const images = new RemotePlanImages();
    await images.url("org1/a.png");
    await settle();
    const fresh = new RemotePlanImages();
    expect(await fresh.url("org1/a.png")).toBe(await fresh.url("org1/a.png"));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("deleting a sheet drops its cached bytes too", async () => {
    const images = new RemotePlanImages();
    await images.url("org1/a.png");
    await settle();
    expect(cache.store.size).toBe(1);

    await images.remove("org1/a.png");
    expect(deletePlanImage).toHaveBeenCalledWith("org1/a.png");
    expect(cache.store.size).toBe(0);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled(); // nothing was handed out
  });

  it("falls back to the signed URL where there is no Cache Storage", async () => {
    delete (globalThis as { caches?: unknown }).caches;
    const images = new RemotePlanImages();
    expect(await images.url("org1/a.png")).toBe("https://store/plan.png?token=1");
    await settle();
    expect(fetched).toEqual([]); // nothing to warm into
  });

  it("survives a failed warm-up — the plan still draws", async () => {
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const images = new RemotePlanImages();
    expect(await images.url("org1/a.png")).toBe("https://store/plan.png?token=1");
    await settle();
    expect(cache.store.size).toBe(0);
  });
});
