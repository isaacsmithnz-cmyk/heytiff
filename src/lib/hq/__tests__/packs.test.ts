/* HQ's pack resolution: the newest edition per brand, in version order that
   reads "2026.10" as newer than "2026.9", and each brand's own name from its
   brands.json — the change log's brand column, read without the catalog. */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { brandNames, latestPackRef, latestPackRefs } from "../packs";

let base: string;

function pack(dir: string, brand: string, brands?: unknown) {
  mkdirSync(join(base, dir));
  writeFileSync(
    join(base, dir, "meta.json"),
    JSON.stringify({ brand, version: dir.split("@")[1], packSchemaVersion: 1, name: `${brand} pack` })
  );
  if (brands !== undefined) writeFileSync(join(base, dir, "brands.json"), JSON.stringify(brands));
}

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "hq-packs-"));
  pack("daikin@2026.9", "daikin", [{ id: "daikin", name: "Daikin (old)" }]);
  pack("daikin@2026.10", "daikin", [{ id: "daikin", name: "Daikin", system_names: { vrf: "VRV" } }]);
  pack("acme@2026.1", "acme", [
    { id: "other", name: "Not this one" },
    { id: "acme", name: "Acme Air" },
  ]);
  pack("bare@2026.1", "bare");
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("latestPackRefs", () => {
  it("keeps one pack per brand, the newest by number, not by letters", async () => {
    const refs = await latestPackRefs(base);
    expect(refs.map((r) => `${r.brand}@${r.version}`).sort()).toEqual([
      "acme@2026.1",
      "bare@2026.1",
      "daikin@2026.10",
    ]);
    expect((await latestPackRef("daikin", base))?.version).toBe("2026.10");
    expect(await latestPackRef("nobody", base)).toBeNull();
  });
});

describe("brandNames", () => {
  it("names each brand from its own row in its newest pack, and leaves out a pack with none", async () => {
    const names = await brandNames(base);
    expect(Object.fromEntries(names)).toEqual({ daikin: "Daikin", acme: "Acme Air" });
  });
});
