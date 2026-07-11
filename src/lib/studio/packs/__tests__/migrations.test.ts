/* Stage-2 seam: pack schema versioning + migrations. Proves the chain runner
   works (via a fake multi-step chain — there are no real migrations yet) and
   that the real v1 seed passes through untouched. This is the insurance that
   lets heavy future systems grow the schema without breaking pinned designs. */

import { emptyPack, type DataPack } from "../schema";
import {
  runPackMigrations,
  migratePack,
  DataPackError,
  type PackMigration,
} from "../migrations";

function packAt(version: number): Record<string, unknown> {
  const p = emptyPack({ brand: "me", version: "x", packSchemaVersion: version, name: "t" }) as unknown as Record<string, unknown>;
  return p;
}

/** a fake chain: v1→v2→v3, each bumping packSchemaVersion (stand-in for real ones) */
const fakeChain: Record<number, PackMigration> = {
  1: (p) => ({ ...p, meta: { ...(p.meta as object), packSchemaVersion: 2 }, migratedThrough1: true }),
  2: (p) => ({ ...p, meta: { ...(p.meta as object), packSchemaVersion: 3 }, migratedThrough2: true }),
};

describe("runPackMigrations — the chain runner", () => {
  it("applies every step from start to target", () => {
    const { pack, migratedFrom } = runPackMigrations(packAt(1), fakeChain, 3);
    expect(migratedFrom).toBe(1);
    expect((pack.meta as { packSchemaVersion: number }).packSchemaVersion).toBe(3);
    expect(pack.migratedThrough1).toBe(true);
    expect(pack.migratedThrough2).toBe(true);
  });

  it("is a no-op when already at target", () => {
    const { pack, migratedFrom } = runPackMigrations(packAt(3), fakeChain, 3);
    expect(migratedFrom).toBeNull();
    expect((pack.meta as { packSchemaVersion: number }).packSchemaVersion).toBe(3);
  });

  it("rejects a pack from a newer schema", () => {
    expect(() => runPackMigrations(packAt(4), fakeChain, 3)).toThrow(DataPackError);
    try {
      runPackMigrations(packAt(4), fakeChain, 3);
    } catch (e) {
      expect((e as DataPackError).code).toBe("future-version");
    }
  });

  it("refuses a gap with no registered migration", () => {
    try {
      runPackMigrations(packAt(1), { 1: fakeChain[1] }, 3); // no 2→3
      fail("should have thrown");
    } catch (e) {
      expect((e as DataPackError).code).toBe("missing-migration");
    }
  });

  it("rejects a migration that fails to bump the version", () => {
    const noBump: Record<number, PackMigration> = { 1: (p) => ({ ...p }) };
    try {
      runPackMigrations(packAt(1), noBump, 2);
      fail("should have thrown");
    } catch (e) {
      expect((e as DataPackError).code).toBe("missing-migration");
    }
  });
});

describe("migratePack — the real registry", () => {
  it("passes a current-version pack through untouched", () => {
    const p = emptyPack({ brand: "me", version: "2026.1", packSchemaVersion: 1, name: "t" });
    const { pack, migratedFrom } = migratePack(p);
    expect(migratedFrom).toBeNull();
    expect(pack).toEqual(p as DataPack);
  });

  it("rejects a value that is not a pack", () => {
    try {
      migratePack({ hello: "world" });
      fail("should have thrown");
    } catch (e) {
      expect((e as DataPackError).code).toBe("not-a-pack");
    }
  });
});
