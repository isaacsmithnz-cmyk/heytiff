/* The sidebar's Pinned in the browser: a pin shows at once, is written
   behind, and goes back if the write fails. Module state, so each test
   loads the store fresh. */

type Store = typeof import("../pins-store");

export {};

async function load(): Promise<Store> {
  let mod!: Store;
  await jest.isolateModulesAsync(async () => {
    mod = await import("../pins-store");
  });
  return mod;
}

const job = (id: string) => ({ ref: { kind: "job" as const, id }, title: `Job ${id}`, sub: null });
const answer = (ok: boolean) => jest.fn(async () => ({ ok }) as Response);

afterEach(() => {
  (global as { fetch?: unknown }).fetch = undefined;
});

describe("pins in the browser", () => {
  it("takes the server's list until something is pinned here", async () => {
    const s = await load();
    s.seedPins([job("1")]);
    s.seedPins([job("2")]);
    expect(s.pinsSnapshot().map((p) => p.ref.id)).toEqual(["2"]);
    global.fetch = answer(true) as never;
    await s.pin(job("3"));
    s.seedPins([job("2")]);
    expect(s.pinsSnapshot().map((p) => p.ref.id)).toEqual(["3", "2"]);
  });

  it("puts a new pin at the top at once and writes it", async () => {
    const s = await load();
    s.seedPins([job("1")]);
    const fetch = answer(true);
    global.fetch = fetch as never;
    const done = s.pin(job("2"));
    expect(s.pinsSnapshot().map((p) => p.ref.id)).toEqual(["2", "1"]);
    expect(await done).toBe(true);
    expect(fetch).toHaveBeenCalledWith("/api/pins", expect.objectContaining({ method: "PUT" }));
  });

  it("moves a pin already there to the top rather than pinning it twice", async () => {
    const s = await load();
    s.seedPins([job("1"), job("2")]);
    global.fetch = answer(true) as never;
    await s.pin(job("2"));
    expect(s.pinsSnapshot().map((p) => p.ref.id)).toEqual(["2", "1"]);
  });

  it("puts the list back when the write fails", async () => {
    const s = await load();
    s.seedPins([job("1")]);
    global.fetch = answer(false) as never;
    expect(await s.pin(job("2"))).toBe(false);
    expect(s.pinsSnapshot().map((p) => p.ref.id)).toEqual(["1"]);
    expect(await s.unpin({ kind: "job", id: "1" })).toBe(false);
    expect(s.pinsSnapshot().map((p) => p.ref.id)).toEqual(["1"]);
  });

  it("lets one go", async () => {
    const s = await load();
    s.seedPins([job("1"), job("2")]);
    global.fetch = answer(true) as never;
    await s.unpin({ kind: "job", id: "1" });
    expect(s.pinsSnapshot().map((p) => p.ref.id)).toEqual(["2"]);
    expect(s.isPinned(s.pinsSnapshot(), { kind: "job", id: "2" })).toBe(true);
  });
});
