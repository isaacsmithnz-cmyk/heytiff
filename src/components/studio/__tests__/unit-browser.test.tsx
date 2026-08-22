/* Unit browser (Stage 5 overhaul): tabs with counts, phase filter, fit
   filters, sortable columns, the detail panel (indoor/outdoor/pairing
   attribution + ODU picker), and the choose payload. Small in-memory pack
   fixture — engine correctness against the real pack lives in select.test.ts.
   Model names render in the table AND the detail panel, so row queries are
   scoped to the table body. */

import { render, screen, fireEvent, within } from "@testing-library/react";
import { UnitBrowser } from "../unit-browser";
import { DUCT_AIRWAY_FORMS } from "@/lib/studio/form-factors";
import {
  emptyPack,
  type DataPack,
  type IndoorUnit,
  type OutdoorUnit,
  type PairTable,
  type Phase,
} from "@/lib/studio/packs/schema";

const prov = { kind: "extracted" as const, source: "test" };

function idu(
  model: string,
  ff: IndoorUnit["form_factor"],
  kw: number,
  dims: [number, number, number],
  airflow?: number,
  sound?: [number, number]
): IndoorUnit {
  return {
    model, brand: "me", series: "T", form_factor: ff,
    capacity_cool_kw: kw, capacity_heat_kw: kw + 0.5,
    ...(airflow ? { airflow_ls: airflow } : {}),
    ...(sound ? { sound_low_dba: sound[0], sound_high_dba: sound[1] } : {}),
    conn_liquid_mm: 6.35, conn_gas_mm: 12.7,
    default_plane: DUCT_AIRWAY_FORMS.includes(ff) ? "ceiling-cavity" : "room",
    allowed_planes: [DUCT_AIRWAY_FORMS.includes(ff) ? "ceiling-cavity" : "room"],
    system_roles: ["split-pair"], refrigerant: "R32",
    width_mm: dims[0], depth_mm: dims[1], height_mm: dims[2],
    provenance: prov,
  };
}

function odu(model: string, kw: number, phase: Phase = "1", soundHigh?: number): OutdoorUnit {
  return {
    model, brand: "me", series: "T", system_type: "split",
    capacity_cool_kw: kw, capacity_heat_kw: kw + 0.5, phase,
    ...(soundHigh != null ? { sound_high_dba: soundHigh } : {}),
    conn_liquid_mm: 6.35, conn_gas_mm: 12.7, refrigerant: "R32",
    width_mm: 800, depth_mm: 300, height_mm: 700, provenance: prov,
  };
}

function pair(iduM: string, oduM: string, kw: number, maxLen: number): PairTable {
  return {
    idu_model: iduM, odu_model: oduM, pipe_liquid_mm: 6.35, pipe_gas_mm: 12.7,
    max_length_m: maxLen, max_lift_m: 12,
    additional_charge: { method: "none_required" },
    rated_cool_kw: kw, rated_heat_kw: kw + 0.5, provenance: prov,
  };
}

/* WALL-35 pairs with a 1φ AND a 3φ outdoor — the Mitsubishi ducted scenario
   in miniature. DUCT-LOW carries a sound range; OD-35 a single sound figure. */
function fixturePack(): DataPack {
  const p = emptyPack({ brand: "me", version: "1", packSchemaVersion: 1, name: "t" });
  p.brands.push({ id: "me", name: "Test" });
  p.indoor_units.push(
    idu("WALL-25", "wall", 2.5, [800, 230, 300]),
    idu("WALL-35", "wall", 3.5, [900, 230, 305]),
    idu("DUCT-LOW", "ducted", 3.5, [900, 700, 200], 160, [30, 38]),
    idu("DUCT-TALL", "ducted", 3.6, [1100, 700, 380], 300),
    /* a bulkhead unit — air-capable like a ducted one, and the reason the
       airflow column/filter can't key off the "ducted" tab alone */
    idu("BULK-50", "bulkhead", 5.0, [990, 700, 200], 200)
  );
  p.outdoor_units.push(odu("OD-25", 2.5), odu("OD-35", 3.5, "1", 58), odu("OD-35B", 3.5, "3"));
  p.pair_tables.push(
    pair("WALL-25", "OD-25", 2.5, 20),
    pair("WALL-35", "OD-35", 3.5, 20),
    pair("WALL-35", "OD-35B", 3.5, 30), // multi-ODU row, three-phase partner
    pair("DUCT-LOW", "OD-35", 3.5, 25),
    pair("DUCT-TALL", "OD-35", 3.6, 25),
    pair("BULK-50", "OD-35", 3.5, 25)
  );
  return p;
}

const noop = () => {};
const tbl = () => document.querySelector(".ds-ub-table tbody") as HTMLElement;
const detailPanel = () => document.querySelector(".ds-ub-detail") as HTMLElement;
const rowOf = (model: string) =>
  within(tbl()).getByText(model).closest("tr") as HTMLElement;

beforeEach(() => window.localStorage.clear());

describe("UnitBrowser", () => {
  it("portals to body with form-factor tabs and counts", () => {
    render(
      <UnitBrowser pack={fixturePack()} loadKw={null} basis="worst-of-both" onChoose={noop} onClose={noop} />
    );
    const dialog = screen.getByRole("dialog", { name: "Choose a unit" });
    expect(document.body.contains(dialog)).toBe(true);
    expect(screen.getByRole("button", { name: /Wall-mounted\s*2/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ducted\s*2/ })).toBeInTheDocument();
  });

  it("opens on the first prevalent tab with a fit, not the cross-form best fit", () => {
    /* the real case: a bedroom split at 4.2 kW. A floor console lands the
       exact capacity, so the cross-form-factor best fit is the console — but
       a wall unit fits too, and wall-mounted is where an installer looks
       first. The default follows the tab order, not the ranking tiebreak. */
    const p = fixturePack();
    p.indoor_units.push(
      idu("WALL-45", "wall", 4.5, [900, 230, 305]),
      idu("CONS-42", "floor-console", 4.2, [750, 215, 600])
    );
    p.outdoor_units.push(odu("OD-45", 4.5), odu("OD-42C", 4.2));
    p.pair_tables.push(pair("WALL-45", "OD-45", 4.5, 20), pair("CONS-42", "OD-42C", 4.2, 20));
    render(
      <UnitBrowser pack={p} loadKw={4.2} basis="worst-of-both" onChoose={noop} onClose={noop} />
    );
    expect(screen.getByRole("button", { name: /Wall-mounted/ }).className).toContain("on");
    expect(within(tbl()).getByText("WALL-45")).toBeInTheDocument();
  });

  it("opens on the requested form-factor tab (ducted AHU flow)", () => {
    render(
      <UnitBrowser
        pack={fixturePack()}
        loadKw={null}
        basis="worst-of-both"
        initialFormFactor="ducted"
        onChoose={noop}
        onClose={noop}
      />
    );
    // no tab click — the ducted rows are already in the table
    expect(screen.getByRole("button", { name: /Ducted/ }).className).toContain("on");
    expect(within(tbl()).getByText("DUCT-LOW")).toBeInTheDocument();
  });

  it("requiredKw highlights pairs inside the required band, never filtering", () => {
    render(
      <UnitBrowser
        pack={fixturePack()}
        loadKw={null}
        basis="worst-of-both"
        initialFormFactor="ducted"
        requiredKw={2.6}
        onChoose={noop}
        onClose={noop}
      />
    );
    // band 2.6 … ×1.35 = 3.51: DUCT-LOW (3.5) is in; DUCT-TALL (3.6) is out but listed
    expect(rowOf("DUCT-LOW").className).toContain("band");
    expect(within(rowOf("DUCT-LOW")).getByText("in range")).toBeInTheDocument();
    expect(rowOf("DUCT-TALL").className).not.toContain("band");
    expect(within(tbl()).getByText("DUCT-TALL")).toBeInTheDocument();
  });

  it("ducted tab shows the airflow column; rows land in the table", () => {
    render(
      <UnitBrowser pack={fixturePack()} loadKw={null} basis="worst-of-both" onChoose={noop} onClose={noop} />
    );
    fireEvent.click(screen.getByRole("button", { name: /Ducted/ }));
    expect(within(tbl()).getByText("DUCT-LOW")).toBeInTheDocument();
    expect(within(tbl()).getByText("DUCT-TALL")).toBeInTheDocument();
    expect(within(tbl()).getByText(/160 L\/s/)).toBeInTheDocument();
  });

  it("height filter (H ≤) keeps only low-profile ducted units", () => {
    render(
      <UnitBrowser pack={fixturePack()} loadKw={null} basis="worst-of-both" onChoose={noop} onClose={noop} />
    );
    fireEvent.click(screen.getByRole("button", { name: /Ducted/ }));
    const inputs = screen.getAllByPlaceholderText("mm");
    fireEvent.change(inputs[2], { target: { value: "250" } }); // H ≤ 250
    expect(within(tbl()).getByText("DUCT-LOW")).toBeInTheDocument();
    expect(within(tbl()).queryByText("DUCT-TALL")).not.toBeInTheDocument();
  });

  it("the best fit row is pre-selected under a load", () => {
    render(
      <UnitBrowser pack={fixturePack()} loadKw={2.4} basis="cooling" onChoose={noop} onClose={noop} />
    );
    // load 2.4, cap 3.6: WALL-25 (2.5) and WALL-35 (3.5) both fit
    fireEvent.click(screen.getByRole("button", { name: /Wall/ }));
    const row = rowOf("WALL-25");
    // WALL-25 is the smallest → best fit tag, and it feeds the detail panel
    expect(within(row).getByText("best fit")).toBeInTheDocument();
    expect(row).toHaveAttribute("aria-selected", "true");
    expect(within(detailPanel()).getByText("WALL-25")).toBeInTheDocument();
  });

  it("a load sections the tab: what fits leads, the rest follows flagged", () => {
    // load 2.2, cap 3.3: WALL-25 (2.5) fits, WALL-35 (3.5) is past the cap
    render(
      <UnitBrowser pack={fixturePack()} loadKw={2.2} basis="cooling" onChoose={noop} onClose={noop} />
    );
    fireEvent.click(screen.getByRole("button", { name: /Wall/ }));
    expect(within(tbl()).getByText("Recommended")).toBeInTheDocument();
    expect(within(tbl()).getByText("Oversized")).toBeInTheDocument();
    // both units are on offer — the oversized one is flagged, not hidden
    expect(within(rowOf("WALL-25")).getByText("best fit")).toBeInTheDocument();
    expect(within(rowOf("WALL-35")).getByText("oversized")).toBeInTheDocument();
    // and it sits below the Recommended heading it isn't part of
    const rows = within(tbl()).getAllByRole("row");
    const at = (t: string) => rows.findIndex((r) => r.textContent?.includes(t));
    expect(at("Recommended")).toBeLessThan(at("WALL-25"));
    expect(at("WALL-25")).toBeLessThan(at("Oversized"));
    expect(at("Oversized")).toBeLessThan(at("WALL-35"));
    // no undersized unit here, so that heading stays away entirely
    expect(within(tbl()).queryByText("Undersized")).not.toBeInTheDocument();
  });

  it("oversized and undersized are separate sections, not one 'other' pile", () => {
    // load 3.4: WALL-35 (3.5) fits; add nothing oversized, so pair it with a
    // load that splits the ducted tab — DUCT-LOW 3.5 fits, DUCT-TALL 3.6 fits.
    // The wall tab at 2.2 gives fits+oversized, at 3.4 gives fits+undersized.
    render(
      <UnitBrowser pack={fixturePack()} loadKw={3.4} basis="cooling" onChoose={noop} onClose={noop} />
    );
    fireEvent.click(screen.getByRole("button", { name: /Wall/ }));
    expect(within(tbl()).getByText("Undersized")).toBeInTheDocument();
    expect(within(tbl()).queryByText("Oversized")).not.toBeInTheDocument();
    // the heading carries the verdict's own colour class, not a shared one
    const head = within(tbl()).getByText("Undersized").closest("tr")!;
    expect(head.className).toContain("ds-ub-sec-under");
  });

  it("units too small for the load are still listed, flagged undersized, at the bottom", () => {
    // load 3.4: WALL-35 (3.5) fits, WALL-25 (2.5) can't cover it
    render(
      <UnitBrowser pack={fixturePack()} loadKw={3.4} basis="cooling" onChoose={noop} onClose={noop} />
    );
    fireEvent.click(screen.getByRole("button", { name: /Wall/ }));
    expect(within(rowOf("WALL-25")).getByText("undersized")).toBeInTheDocument();
    expect(rowOf("WALL-25").className).toContain("undersized");
    const rows = within(tbl()).getAllByRole("row");
    const at = (t: string) => rows.findIndex((r) => r.textContent?.includes(t));
    expect(at("WALL-35")).toBeLessThan(at("WALL-25"));
  });

  it("a tab where nothing fits says so and still lists the units", () => {
    render(
      <UnitBrowser pack={fixturePack()} loadKw={99} basis="cooling" onChoose={noop} onClose={noop} />
    );
    fireEvent.click(screen.getByRole("button", { name: /Wall/ }));
    expect(within(tbl()).getByText(/Nothing in this style suits the load/)).toBeInTheDocument();
    expect(within(tbl()).getByText("WALL-25")).toBeInTheDocument();
    expect(within(tbl()).getByText("WALL-35")).toBeInTheDocument();
    expect(within(tbl()).getAllByText("undersized")).toHaveLength(2);
  });

  it("no Include-oversized toggle — capacity never hides a unit now", () => {
    render(
      <UnitBrowser pack={fixturePack()} loadKw={2.2} basis="cooling" onChoose={noop} onClose={noop} />
    );
    expect(screen.queryByText(/Include oversized/i)).not.toBeInTheDocument();
  });

  it("tab counts read fits-of-total under a load, and never drop to zero total", () => {
    render(
      <UnitBrowser pack={fixturePack()} loadKw={99} basis="cooling" onChoose={noop} onClose={noop} />
    );
    // nothing fits anywhere, but every style is still reachable
    const wall = screen.getByRole("button", { name: /Wall/ });
    expect(wall).not.toBeDisabled();
    expect(wall.textContent).toContain("0/2");
  });

  it("sorting by height reorders the table", () => {
    render(
      <UnitBrowser pack={fixturePack()} loadKw={null} basis="worst-of-both" onChoose={noop} onClose={noop} />
    );
    fireEvent.click(screen.getByRole("button", { name: /Ducted/ }));
    fireEvent.click(screen.getByText("H mm"));
    const rows = within(tbl()).getAllByRole("row");
    expect(rows[0]).toHaveTextContent("DUCT-LOW"); // 200mm sorts first
  });

  it("detail panel: indoor / outdoor / pairing sections, ODU picked there, Add feeds onChoose", () => {
    const onChoose = jest.fn();
    render(
      <UnitBrowser pack={fixturePack()} loadKw={null} basis="worst-of-both" onChoose={onChoose} onClose={noop} />
    );
    fireEvent.click(screen.getByRole("button", { name: /Wall/ }));
    fireEvent.click(within(tbl()).getByText("WALL-35")); // select the row

    const panel = detailPanel();
    // the three attribution sections
    expect(within(panel).getByText("Indoor unit")).toBeInTheDocument();
    expect(within(panel).getByText("Outdoor unit")).toBeInTheDocument();
    expect(within(panel).getByText("Pairing")).toBeInTheDocument();

    // outdoor picker: both pairings as radios, phase-badged, default first
    const picker = within(panel).getByRole("radiogroup", { name: "Outdoor unit for WALL-35" });
    const radios = within(picker).getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
    expect(radios[0]).toHaveTextContent("OD-35");
    expect(radios[0]).toHaveTextContent("1φ");
    expect(radios[1]).toHaveTextContent("OD-35B");
    expect(radios[1]).toHaveTextContent("3φ");

    // pick the 3φ partner — the table row's Outdoor cell follows
    fireEvent.click(radios[1]);
    expect(within(rowOf("WALL-35")).getByText("OD-35B")).toBeInTheDocument();

    // Add commits the picked pairing (single argument — the pair)
    fireEvent.click(within(panel).getByRole("button", { name: /Add to plan/ }));
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose.mock.calls[0]).toHaveLength(1);
    expect(onChoose.mock.calls[0][0].odu.model).toBe("OD-35B");
    expect(onChoose.mock.calls[0][0].idu.model).toBe("WALL-35");
  });

  it("sound ranges are attributed: indoor range and outdoor figure live under their sections", () => {
    render(
      <UnitBrowser pack={fixturePack()} loadKw={null} basis="worst-of-both" onChoose={noop} onClose={noop} />
    );
    fireEvent.click(screen.getByRole("button", { name: /Ducted/ }));
    fireEvent.click(within(tbl()).getByText("DUCT-LOW"));

    const panel = detailPanel();
    const iduSec = within(panel).getByText("Indoor unit").closest("section")!;
    const oduSec = within(panel).getByText("Outdoor unit").closest("section")!;
    expect(within(iduSec as HTMLElement).getByText("30–38 dBA")).toBeInTheDocument(); // range
    expect(within(oduSec as HTMLElement).getByText("58 dBA")).toBeInTheDocument(); // single figure

    // DUCT-TALL has no sound data → its indoor sound shows "—"
    fireEvent.click(within(tbl()).getByText("DUCT-TALL"));
    const iduSec2 = within(detailPanel()).getByText("Indoor unit").closest("section")!;
    const soundRow = within(iduSec2 as HTMLElement).getByText("Sound").closest(".ds-ub-drow")!;
    expect(soundRow).toHaveTextContent("—");
  });

  it("phase filter narrows pairings, drops IDUs with none left, and keeps tab counts consistent", () => {
    render(
      <UnitBrowser pack={fixturePack()} loadKw={null} basis="worst-of-both" onChoose={noop} onClose={noop} />
    );
    fireEvent.click(screen.getByRole("button", { name: /Wall/ }));
    expect(within(tbl()).getByText("WALL-25")).toBeInTheDocument();

    // three-phase only: WALL-25 (1φ-only pairing) drops out entirely
    fireEvent.click(screen.getByRole("button", { name: "3φ" }));
    expect(within(tbl()).queryByText("WALL-25")).not.toBeInTheDocument();
    // the surviving row shows its 3φ partner, not the filtered 1φ default
    const row = rowOf("WALL-35");
    expect(within(row).getByText("OD-35B")).toBeInTheDocument();
    expect(within(row).getByText("3φ")).toBeInTheDocument();
    // tab counts follow: Wall 1; Ducted (1φ-only pairings) drops off the tab
    // row entirely — same behaviour as the capacity gate
    expect(screen.getByRole("button", { name: /Wall-mounted\s*1/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ducted/ })).toBeNull();

    // back to Any restores everything
    fireEvent.click(screen.getByRole("button", { name: "Any" }));
    expect(within(tbl()).getByText("WALL-25")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ducted\s*2/ })).toBeEnabled();
  });

  it("the empty state names the phase filter when one is active", () => {
    render(
      <UnitBrowser pack={fixturePack()} loadKw={null} basis="worst-of-both" onChoose={noop} onClose={noop} />
    );
    fireEvent.click(screen.getByRole("button", { name: /Wall/ }));
    fireEvent.click(screen.getByRole("button", { name: "3φ" }));
    const inputs = screen.getAllByPlaceholderText("mm");
    fireEvent.change(inputs[0], { target: { value: "100" } }); // W ≤ 100 → nothing
    expect(screen.getByText(/No three-phase pairings match/)).toBeInTheDocument();
  });

  it("keyboard: arrows move the selection, Enter adds it", () => {
    const onChoose = jest.fn();
    render(
      <UnitBrowser pack={fixturePack()} loadKw={null} basis="worst-of-both" onChoose={onChoose} onClose={noop} />
    );
    fireEvent.click(screen.getByRole("button", { name: /Wall/ }));
    fireEvent.keyDown(window, { key: "ArrowDown" }); // WALL-25 → WALL-35
    expect(rowOf("WALL-35")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose.mock.calls[0][0].idu.model).toBe("WALL-35");
  });

  it("groups rows by series when there are 2+ series; the toggle flattens", () => {
    const p = fixturePack(); // all series "T"
    p.indoor_units.push({ ...idu("AP-25", "wall", 2.5, [820, 240, 290]), series: "AP" });
    p.outdoor_units.push(odu("OD-AP", 2.5));
    p.pair_tables.push(pair("AP-25", "OD-AP", 2.5, 20));

    render(
      <UnitBrowser pack={p} loadKw={null} basis="worst-of-both" onChoose={noop} onClose={noop} />
    );
    fireEvent.click(screen.getByRole("button", { name: /Wall/ })); // T (2) + AP (1)

    // a subheader row per series
    const headers = [...document.querySelectorAll("tr.ds-ub-group td")].map((td) => td.textContent);
    expect(headers).toHaveLength(2);
    expect(headers.some((t) => t?.startsWith("AP"))).toBe(true);
    expect(headers.some((t) => t?.startsWith("T"))).toBe(true);

    // toggling off flattens the list — no subheaders
    fireEvent.click(screen.getByRole("checkbox", { name: /Group by series/ }));
    expect(document.querySelectorAll("tr.ds-ub-group")).toHaveLength(0);
    // the units are still all listed
    expect(within(tbl()).getByText("WALL-25")).toBeInTheDocument();
    expect(within(tbl()).getByText("AP-25")).toBeInTheDocument();
  });

  it("the Columns menu is grouped by attribution and persists the choice", () => {
    render(
      <UnitBrowser pack={fixturePack()} loadKw={null} basis="worst-of-both" onChoose={noop} onClose={noop} />
    );
    // default wall columns: physical size shown, Sound not
    expect(screen.getByRole("columnheader", { name: /W mm/ })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /Sound/ })).toBeNull();

    // open the menu — specs sit under Indoor unit / Outdoor unit / Pairing
    fireEvent.click(screen.getByRole("button", { name: /Columns/ }));
    const iduGroup = screen.getByRole("group", { name: "Indoor unit" });
    const oduGroup = screen.getByRole("group", { name: "Outdoor unit" });
    expect(screen.getByRole("group", { name: "Pairing" })).toBeInTheDocument();

    // "Sound" exists in BOTH unit groups — attribution is explicit
    fireEvent.click(within(iduGroup).getByRole("checkbox", { name: /Sound/ }));
    fireEvent.click(within(oduGroup).getByRole("checkbox", { name: /Sound/ }));
    fireEvent.click(within(iduGroup).getByRole("checkbox", { name: /Width/ }));

    expect(screen.getByRole("columnheader", { name: "Sound (in)" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Sound (out)" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /W mm/ })).toBeNull();

    // the choice is saved per-device
    const saved = JSON.parse(window.localStorage.getItem("heytiff.studio.unit-columns")!);
    expect(saved).toContain("sound");
    expect(saved).toContain("oduSound");
    expect(saved).not.toContain("width");
  });

  it("compares selected units side by side in attributed sections and adds from a column", () => {
    const chosen: string[] = [];
    render(
      <UnitBrowser
        pack={fixturePack()}
        loadKw={null}
        basis="worst-of-both"
        onChoose={(p) => chosen.push(p.idu.model)}
        onClose={noop}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Wall/ }));

    fireEvent.click(screen.getByRole("checkbox", { name: "Compare WALL-25" }));
    // one selected → the Compare button is present but disabled
    expect(screen.getByRole("button", { name: /Compare 1/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Compare WALL-35" }));
    const go = screen.getByRole("button", { name: /Compare 2/ });
    expect(go).toBeEnabled();
    fireEvent.click(go);

    const dialog = screen.getByRole("dialog", { name: "Compare units" });
    expect(within(dialog).getByText("WALL-25")).toBeInTheDocument();
    expect(within(dialog).getByText("WALL-35")).toBeInTheDocument();
    // the three attribution bands + the outdoor Model row with phase badges
    expect(within(dialog).getByText("Indoor unit")).toBeInTheDocument();
    expect(within(dialog).getByText("Outdoor unit")).toBeInTheDocument();
    expect(within(dialog).getByText("Pairing")).toBeInTheDocument();
    expect(within(dialog).getByText("OD-25")).toBeInTheDocument();
    expect(within(dialog).getAllByText("1φ").length).toBeGreaterThanOrEqual(2);
    // a spec row from the registry
    expect(within(dialog).getByText(/Width/)).toBeInTheDocument();

    // Add the second unit straight from its comparison column
    const addButtons = within(dialog).getAllByRole("button", { name: "Add" });
    fireEvent.click(addButtons[1]);
    expect(chosen).toContain("WALL-35");
  });

  it("caps the comparison at 3 units", () => {
    const p = fixturePack();
    p.indoor_units.push(
      idu("WALL-45", "wall", 4.5, [1000, 240, 320]),
      idu("WALL-50", "wall", 5.0, [1050, 250, 330])
    );
    p.outdoor_units.push(odu("OD-45", 4.5), odu("OD-50", 5.0));
    p.pair_tables.push(pair("WALL-45", "OD-45", 4.5, 25), pair("WALL-50", "OD-50", 5.0, 25));
    render(
      <UnitBrowser pack={p} loadKw={null} basis="worst-of-both" onChoose={noop} onClose={noop} />
    );
    fireEvent.click(screen.getByRole("button", { name: /Wall/ }));

    ["WALL-25", "WALL-35", "WALL-45"].forEach((m) =>
      fireEvent.click(screen.getByRole("checkbox", { name: `Compare ${m}` }))
    );
    // three staged → the fourth can't be added
    expect(screen.getByRole("checkbox", { name: "Compare WALL-50" })).toBeDisabled();
  });

  it("Escape closes the browser — but the compare overlay first when it's open", () => {
    const onClose = jest.fn();
    render(
      <UnitBrowser pack={fixturePack()} loadKw={null} basis="worst-of-both" onChoose={noop} onClose={onClose} />
    );
    fireEvent.click(screen.getByRole("button", { name: /Wall/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Compare WALL-25" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Compare WALL-35" }));
    fireEvent.click(screen.getByRole("button", { name: /Compare 2/ }));

    // Escape with the overlay open closes only the overlay
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Compare units" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    // Escape again closes the browser
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
  /* Airflow belongs to every form with a duct airway, not to the tab literally
     named "Ducted". `only` was a single FormFactor and `isDucted` was an
     equality check, so reclassifying SEZ/PEFY-VMX/VMS1 ducted → bulkhead took
     the Airflow column, its Columns-menu entry and the "Airflow ≥" filter away
     from 19 air-capable units — silently, since a missing column looks like a
     column you turned off. */
  it("keeps the airflow column and filter on the bulkhead tab", () => {
    render(
      <UnitBrowser pack={fixturePack()} loadKw={null} basis="worst-of-both" onChoose={noop} onClose={noop} />
    );
    fireEvent.click(screen.getByRole("button", { name: /Bulkhead\s*1/ }));
    expect(screen.getByRole("columnheader", { name: /Airflow/ })).toBeInTheDocument();
    expect(within(tbl()).getByText("200 L/s")).toBeInTheDocument();
    expect(screen.getByText(/Airflow ≥/)).toBeInTheDocument();
  });

  /* the flip side: a form with no duct airway must NOT show it */
  it("still hides the airflow column on a wall tab", () => {
    render(
      <UnitBrowser pack={fixturePack()} loadKw={null} basis="worst-of-both" onChoose={noop} onClose={noop} />
    );
    fireEvent.click(screen.getByRole("button", { name: /Wall-mounted/ }));
    expect(screen.queryByRole("columnheader", { name: /Airflow/ })).toBeNull();
    expect(screen.queryByText(/Airflow ≥/)).toBeNull();
  });

  /* Room chips (drop-to-attribute slice): the lens the ranking reads through,
     the fallback attribution, and — via the served tick — placement progress. */
  describe("room chips", () => {
    const chips = [
      { id: "r1", name: "Lounge", loadKw: 4.2, served: true },
      { id: "r2", name: "Study", loadKw: 2.1, served: false },
    ];

    it("wears the rooms across the top, lens pressed, load on each chip", () => {
      render(
        <UnitBrowser
          pack={fixturePack()}
          loadKw={2.1}
          basis="worst-of-both"
          rooms={chips}
          lensId="r2"
          onLens={noop}
          onChoose={noop}
          onClose={noop}
        />
      );
      const row = screen.getByRole("navigation", { name: "Rank against a room" });
      const study = within(row).getByRole("button", { name: /Study/ });
      expect(study).toHaveAttribute("aria-pressed", "true");
      expect(within(row).getByRole("button", { name: /Lounge/ })).toHaveAttribute(
        "aria-pressed",
        "false"
      );
      expect(study.textContent).toContain("2.1 kW");
      // the placed room wears the tick class — progress at a glance
      expect(within(row).getByRole("button", { name: /Lounge/ }).className).toContain("served");
    });

    it("clicking a chip re-aims the lens", () => {
      const aims: string[] = [];
      render(
        <UnitBrowser
          pack={fixturePack()}
          loadKw={2.1}
          basis="worst-of-both"
          rooms={chips}
          lensId="r2"
          onLens={(id) => aims.push(id)}
          onChoose={noop}
          onClose={noop}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /Lounge/ }));
      expect(aims).toEqual(["r1"]);
    });

    it("shows no chip row when the host has no rooms to offer", () => {
      render(
        <UnitBrowser pack={fixturePack()} loadKw={null} basis="worst-of-both" onChoose={noop} onClose={noop} />
      );
      expect(
        screen.queryByRole("navigation", { name: "Rank against a room" })
      ).toBeNull();
    });
  });
});
