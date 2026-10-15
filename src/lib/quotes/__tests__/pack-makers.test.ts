/**
 * @jest-environment node
 */
/* The makers a kit's unit can be read off: every installed data pack, by
   the key a lookup reads it by and in words. The kit form offered
   Mitsubishi Electric or nothing (2026-10-15), Diamond Air's brand for
   every business. */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

jest.mock("server-only", () => ({}));
jest.mock("../book-view-server", () => ({ bookProducts: jest.fn(async () => []) }));

import { packMakers } from "../lookups-server";

it("lists every installed pack's maker, once, in words", async () => {
  const installed = [...new Set(readdirSync(path.join(process.cwd(), "data", "packs")).filter((n) => n.lastIndexOf("@") > 0).map((n) => n.slice(0, n.lastIndexOf("@"))))];
  const makers = await packMakers();
  expect(makers.map((m) => m.key).sort()).toEqual(installed.sort());
  expect(makers.length).toBeGreaterThan(1);
  expect(makers).toEqual(expect.arrayContaining([{ key: "mitsubishi-electric", name: "Mitsubishi Electric" }, { key: "daikin", name: "Daikin" }]));
});

it("names a maker as its own pack does, and only a pack without a name by its key", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pack-makers-"));
  try {
    const pack = (name: string, brands: unknown[] | null) => {
      mkdirSync(path.join(dir, name));
      writeFileSync(path.join(dir, name, "meta.json"), JSON.stringify({ brand: name.split("@")[0], version: name.split("@")[1], packSchemaVersion: 1 }));
      if (brands) writeFileSync(path.join(dir, name, "brands.json"), JSON.stringify(brands));
    };
    pack("lg@2026.1", [{ id: "lg", name: "LG" }]);
    pack("lg@2026.2", [{ id: "lg", name: "LG" }]);
    pack("tecnair-ac@2026.1", null);
    expect(await packMakers(dir)).toEqual([
      { key: "lg", name: "LG" },
      { key: "tecnair-ac", name: "Tecnair Ac" },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
