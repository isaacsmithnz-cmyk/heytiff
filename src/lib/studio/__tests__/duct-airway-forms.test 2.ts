/* One definition of "this form factor takes a duct", not five.

   `["ducted", "bulkhead"]` used to be written out in five places —
   DUCT_AIRWAY_FORMS (form-factors.ts), AIR_CAPABLE_FORMS (modules.ts) and a
   DUCTED_FORMS/DUCTED_ONLY apiece in packs/ready.ts, hq/catalog.ts and
   hq/table-groups.ts. Nothing was broken because they agreed; the cost was
   that a sixth ducted-airway form had to be added five times, and forgetting
   one fails SILENTLY — a unit keeps its airflow requirement on one surface and
   loses it on another, exactly the way `bulkhead` printed as its own slug on
   the Summary sheet while the canvas said "Bulkhead".

   So this doesn't test the constant against itself. It drives each of the four
   consuming surfaces once per form factor in the enum and asserts the answer
   tracks `hasDuctAirway`. Re-introducing a hard-coded list that has drifted —
   in any one of them — turns this red and names the form factor.

   Mutation-validated: adding "wall" to any one consumer's list, or dropping
   "bulkhead" from it, fails that consumer's case and no other. */

import { FORM_FACTORS, emptyPack, type DataPack, type IndoorUnit, type FormFactor } from "@/lib/studio/packs/schema";
import { DUCT_AIRWAY_FORMS, hasDuctAirway } from "@/lib/studio/form-factors";
import { isAirCapable } from "@/lib/studio/modules";
import { indoorReadiness } from "@/lib/studio/packs/ready";
import { buildCatalogView } from "@/lib/hq/catalog";
import { seriesColumns } from "@/lib/hq/table-groups";

const prov = { kind: "extracted" as const, source: "book" };

/** a COMPLETE indoor unit: every ducted requirement answered, so the only
    reason a role can come out false is the form factor. */
function idu(form_factor: FormFactor): IndoorUnit {
  return {
    model: `M-${form_factor}`,
    brand: "me",
    series: `S-${form_factor}`,
    form_factor,
    capacity_cool_kw: 3.5,
    capacity_heat_kw: 4,
    conn_liquid_mm: 6.35,
    conn_gas_mm: 12.7,
    default_plane: "room",
    allowed_planes: ["room"],
    system_roles: ["split-pair"],
    refrigerant: "R32",
    width_mm: 800,
    depth_mm: 300,
    height_mm: 200,
    airflow_ls: 150,
    static_pressure_pa: 50,
    supply_opening: "open",
    return_opening: "open",
    provenance: prov,
  };
}

function packOf(idus: IndoorUnit[]): DataPack {
  const p = emptyPack({ brand: "me", version: "1", packSchemaVersion: 1, name: "t" });
  p.brands.push({ id: "me", name: "Mitsubishi Electric" });
  p.indoor_units.push(...idus);
  return p;
}

describe("duct-airway forms are defined once", () => {
  it("the shipped pair is exactly ducted + bulkhead", () => {
    expect([...DUCT_AIRWAY_FORMS].sort()).toEqual(["bulkhead", "ducted"]);
  });

  it.each(FORM_FACTORS)("modules.isAirCapable agrees for %s", (ff) => {
    // airflow present, so air-capability turns purely on the form factor
    expect(isAirCapable({ form_factor: ff, airflow_ls: 150 })).toBe(hasDuctAirway(ff));
  });

  it.each(FORM_FACTORS)("ready.indoorReadiness claims the ducted role for %s", (ff) => {
    const unit = idu(ff);
    const r = indoorReadiness(packOf([unit]), unit);
    // the unit is complete, so `ducted` is true iff the form factor takes a duct
    expect(r.roles.ducted).toBe(hasDuctAirway(ff));
  });

  it.each(FORM_FACTORS)("catalog wants a static pressure for %s", (ff) => {
    // static_pressure_pa is a nice-to-have on duct-airway forms only, so the
    // gap only appears when the field is ABSENT and the form takes a duct
    const unit = { ...idu(ff), static_pressure_pa: undefined };
    const row = buildCatalogView(packOf([unit]), []).indoor[0];
    const gap = row.gaps.find((g) => g.field === "static_pressure_pa");
    expect(gap != null).toBe(hasDuctAirway(ff));
  });

  it.each(FORM_FACTORS)("the HQ airways columns apply to %s", (ff) => {
    const rows = buildCatalogView(packOf([idu(ff)]), []).indoor;
    const fields = seriesColumns("indoor_units", rows).groups.flatMap((g) =>
      g.columns.map((c) => c.field)
    );
    for (const airway of ["supply_opening", "return_opening"]) {
      expect(fields.includes(airway)).toBe(hasDuctAirway(ff));
    }
  });
});
