/* The extraction gate + report for the packs actually shipped in `data/packs/`.

   Two jobs in one place, because they answer the same question from opposite
   ends — "is this pack safe?" and "what's still missing?":

   1. GATE (runs in every `npm test`, so CI blocks a broken pack): every
      installed pack must migrate, load and validate with zero errors. This is
      the "validator + CI gate" the schema doc requires between a data book and
      the live table. Note it does NOT require completeness — partial packs are
      safe by design (an incomplete row simply isn't offered by the engine), so
      only structural breakage fails here: dangling refs, bad enums, missing
      provenance.

   2. REPORT (`npm run validate:packs`): prints per-series engine-readiness and
      the aggregated gaps — the extraction to-do list. Printing is opt-in via
      PACK_REPORT=1 so the normal suite stays quiet.

   Sibling of server.test.ts, which covers the same loader against FIXTURES.
   This one is deliberately pointed at the real, shipped data. */

import { installedPacks, loadInstalledPack } from "../server";
import type { RangeCompleteness } from "../ready";
import { formFactorLabel, hasFormFactorLabel } from "../../form-factors";

const REPORT = process.env.PACK_REPORT === "1";
const log = (s: string) => {
  if (REPORT) console.log(s);
};

/** "12/22" with the gaps that explain the shortfall */
function reportRange(r: RangeCompleteness): string {
  const head = `    ${r.series} · ${r.role}: ${r.ready}/${r.total}`;
  return r.gaps.length ? `${head} — missing: ${r.gaps.join(", ")}` : head;
}

describe("installed packs (data/packs)", () => {
  it("discovers at least one installed pack", async () => {
    const packs = await installedPacks();
    expect(packs.length).toBeGreaterThan(0);
  });

  it("every installed pack loads, migrates and validates without errors", async () => {
    const refs = await installedPacks();
    for (const ref of refs) {
      const { validation } = await loadInstalledPack(ref.brand, ref.version);
      // surface the actual messages on failure rather than a bare `false`
      expect({
        pack: `${ref.brand}@${ref.version}`,
        errors: validation.errors,
      }).toEqual({ pack: `${ref.brand}@${ref.version}`, errors: [] });
    }
  });

  it("reports engine-readiness per series (PACK_REPORT=1 to print)", async () => {
    const refs = await installedPacks();
    for (const ref of refs) {
      const { pack, validation, completeness } = await loadInstalledPack(
        ref.brand,
        ref.version
      );
      log(`\n${ref.brand}@${ref.version} — ${pack.meta.name ?? ""}`);
      log(
        `  rows: ${pack.indoor_units.length} indoor · ${pack.outdoor_units.length} outdoor · ` +
          `${pack.pair_tables.length} pair · ${pack.multi_rules.length} multi · ` +
          `${pack.vrf_pipe_tables.length} vrf-pipe · ${pack.parts.length} parts`
      );
      if (validation.warnings.length) {
        log(`  warnings (${validation.warnings.length}):`);
        for (const w of validation.warnings.slice(0, 20)) {
          log(`    ${w.section} ${w.row}: ${w.message}`);
        }
        if (validation.warnings.length > 20) {
          log(`    …and ${validation.warnings.length - 20} more`);
        }
      }
      // incomplete ranges first — that IS the extraction to-do list
      const ranked = [...completeness].sort(
        (a, b) => a.ready / a.total - b.ready / b.total
      );
      const incomplete = ranked.filter((r) => r.ready < r.total);
      log(`  incomplete ranges (${incomplete.length} of ${completeness.length}):`);
      for (const r of incomplete) log(reportRange(r));
      expect(completeness.length).toBeGreaterThan(0);
    }
  });
  /* Every form factor a shipped pack actually uses must have a NAME. This is
     the gate on a silent failure mode, not a hypothetical one: `bulkhead` was
     a valid FormFactor and was labelled by the canvas and the cockpit, but the
     Summary sheet kept its own map and had no key for it. An unmapped form
     factor doesn't throw and doesn't render blank — it degrades to its raw
     slug on ONE surface and reads correctly on the others, so the plan said
     "Bulkhead" and the sheet said "bulkhead", and nothing failed. The pack
     data was corrected the same day the label map was, because splitting them
     is exactly what ships that bug.

     Deliberately scoped to form factors PRESENT IN THE DATA, not to the whole
     FormFactor enum: an enum member no pack uses yet is a gap, not a defect,
     and `satisfies` in form-factors.ts already makes an unlabelled enum member
     a compile error. */
  it("names every form factor the installed packs actually use", async () => {
    const refs = await installedPacks();
    const unnamed: string[] = [];
    for (const ref of refs) {
      const { pack } = await loadInstalledPack(ref.brand, ref.version);
      const forms = new Set(pack.indoor_units.map((u) => u.form_factor));
      for (const f of [...forms].sort()) {
        if (!hasFormFactorLabel(f)) {
          const eg = pack.indoor_units.find((u) => u.form_factor === f)?.model;
          unnamed.push(`${ref.brand}@${ref.version} "${f}" (e.g. ${eg})`);
        }
      }
    }
    // the message names the pack, the slug and a model, so the fix is obvious
    expect(unnamed).toEqual([]);
  });

  /* The fallback still has to work — a pack from the future must SHOW an
     unknown form factor rather than swallow it. Keeping this next to the gate
     above stops someone "fixing" a failure there by deleting the fallback. */
  it("shows an unknown form factor rather than swallowing it", () => {
    expect(formFactorLabel("ceiling-suspended-mk7")).toBe("ceiling-suspended-mk7");
    expect(formFactorLabel(null)).toBeNull();
  });
});
