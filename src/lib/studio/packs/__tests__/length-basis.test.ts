/* Which shipped pairs limit EQUIVALENT length. Set only where the cited page
   says equivalent: Actron's Advance B (9590-0030-01 pp.6-9, ICG 0525-137
   pp.42-43), AIRES (9590-0027-01 pp.6-9, ICG 0525-133 p.25) and Variable
   Capacity Commercial (ICG 0525-066 pp.16-18). Every other book in the
   shipped packs prints the pipe run itself (Daikin's equivalent figure is a
   second, longer number beside the actual one it stores). */

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import type { IndoorUnit, PairTable } from "../schema";

const PACKS = join(__dirname, "../../../../../data/packs");
const read = <T,>(dir: string, file: string): T[] => JSON.parse(readFileSync(join(PACKS, dir, file), "utf8")) as T[];

describe("max_length_basis in the shipped packs", () => {
  const dirs = readdirSync(PACKS).filter((d) => d.includes("@"));

  it("only Actron's Advance B, AIRES and VCC pairs are equivalent, each cited to an equivalent-length page", () => {
    const marked: string[] = [];
    for (const dir of dirs) {
      const idus = new Map(read<IndoorUnit>(dir, "indoor_units.json").map((u) => [u.model, u]));
      for (const p of read<PairTable>(dir, "pair_tables.json")) {
        if (p.max_length_basis == null) continue;
        expect(p.max_length_basis).toBe("equivalent");
        expect(p.provenance.page).toMatch(/EQUIVALENT/);
        marked.push(`${dir} ${idus.get(p.idu_model)!.series}`);
      }
    }
    const count = (s: string) => marked.filter((m) => m.endsWith(s)).length;
    expect(marked.every((m) => m.startsWith("actron-air@"))).toBe(true);
    expect(count("Advance B Series (R-32)")).toBe(9);
    expect(count("AIRES (R-32)")).toBe(9);
    expect(count("Variable Capacity Commercial (R-410A)")).toBe(2);
    expect(marked).toHaveLength(20);
  });
});
