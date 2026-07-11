/* Stage-2 bridge: the server fs-loader discovers, loads, validates + scores
   packs, and resolves a design's packPins into one merged DataPack. Runs
   against an isolated temp fixture (NOT the live data/packs/, which the
   extraction agent may be writing) so it's deterministic. */

import { promises as fs } from "fs";
import os from "os";
import path from "path";
import {
  installedPacks,
  loadInstalledPack,
  resolveDesignPacks,
} from "../server";

const prov = { kind: "extracted", source: "book" };

async function writePack(
  base: string,
  brand: string,
  version: string,
  sections: Record<string, unknown[]>
) {
  const dir = path.join(base, `${brand}@${version}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "meta.json"),
    JSON.stringify({ brand, version, packSchemaVersion: 1, name: `${brand} ${version}` })
  );
  for (const [section, rows] of Object.entries(sections)) {
    await fs.writeFile(path.join(dir, `${section}.json`), JSON.stringify(rows));
  }
}

const odu = (model: string, kw: number) => ({
  model,
  brand: "acme",
  series: "S",
  system_type: "vrf",
  capacity_cool_kw: kw,
  capacity_heat_kw: kw + 2,
  phase: "3",
  conn_liquid_mm: 9.52,
  conn_gas_mm: 22.2,
  refrigerant: "R410A",
  width_mm: 900,
  depth_mm: 700,
  height_mm: 1800,
  provenance: prov,
});

let base: string;
beforeAll(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "heytiff-packs-"));
  await writePack(base, "acme", "1.0", {
    brands: [{ id: "acme", name: "Acme" }],
    outdoor_units: [odu("A-200", 22.4)],
  });
  // an overlay-style second version of the same brand (later wins on merge)
  await writePack(base, "acme", "1.1", {
    brands: [{ id: "acme", name: "Acme" }],
    outdoor_units: [odu("A-200", 99)],
  });
});
afterAll(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

describe("installedPacks", () => {
  it("discovers every <brand>@<version> dir with a meta.json", async () => {
    const found = await installedPacks(base);
    expect(found.map((p) => `${p.brand}@${p.version}`).sort()).toEqual([
      "acme@1.0",
      "acme@1.1",
    ]);
  });

  it("returns [] when the packs dir doesn't exist", async () => {
    expect(await installedPacks(path.join(base, "nope"))).toEqual([]);
  });
});

describe("loadInstalledPack", () => {
  it("loads, validates, and scores a pack", async () => {
    const { pack, validation, completeness } = await loadInstalledPack("acme", "1.0", base);
    expect(pack.outdoor_units).toHaveLength(1);
    expect(validation.ok).toBe(true);
    // an ODU is at least placeable → a completeness row exists
    expect(completeness.some((c) => c.role === "placeable")).toBe(true);
  });
});

describe("resolveDesignPacks — packPins bridge", () => {
  it("returns null when a design pins nothing", async () => {
    expect(await resolveDesignPacks({}, base)).toBeNull();
  });

  it("loads a single pinned pack", async () => {
    const merged = await resolveDesignPacks({ acme: "1.0" }, base);
    expect(merged!.outdoor_units[0].capacity_cool_kw).toBe(22.4);
  });
});
