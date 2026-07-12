/* Unit browser (Stage 5 overhaul): tabs with counts, phase filter, fit
   filters, sortable columns, the detail panel (indoor/outdoor/pairing
   attribution + ODU picker), and the choose payload. Small in-memory pack
   fixture — engine correctness against the real pack lives in select.test.ts.
   Model names render in the table AND the detail panel, so row queries are
   scoped to the table body. */

import { render, screen, fireEvent, within } from "@testing-library/react";
import { UnitBrowser } from "../unit-browser";
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
    default_plane: ff === "ducted" ? "ceiling-cavity" : "room",
    allowed_planes: [ff === "ducted" ? "ceiling-cavity" : "room"],
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
    idu("DUCT-TALL", "ducted", 3.6, [1100, 700, 380], 300)
  );
  p.outdoor_units.push(odu("OD-25", 2.5), odu("OD-35", 3.5, "1", 58), odu("OD-35B", 3.5, "3"));
  p.pair_tables.push(
    pair("WALL-25", "OD-25", 2.5, 20),
    pair("WALL-35", "OD-35", 3.5, 20),
    pair("WALL-35", "OD-35B", 3.5, 30), // multi-ODU row, three-phase partner
    pair("DUCT-LOW", "OD-35", 3.5, 25),
    pair("DUCT-TALL", "OD-35", 3.6, 25)
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
    expect(screen.getByRole("button", { name: /Wall\s*2/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ducted\s*2/ })).toBeInTheDocument();
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

  it("capacity gate + oversized toggle; the best fit row is pre-selected", () => {
    render(
      <UnitBrowser pack={fixturePack()} loadKw={2.4} basis="cooling" onChoose={noop} onClose={noop} />
    );
    // load 2.4, cap 3.6: WALL-25 (2.5) qualifies; WALL-35 (3.5) also ≤3.6 → both
    fireEvent.click(screen.getByRole("button", { name: /Wall/ }));
    const row = rowOf("WALL-25");
    // WALL-25 is the smallest → best fit tag, and it feeds the detail panel
    expect(within(row).getByText("best fit")).toBeInTheDocument();
    expect(row).toHaveAttribute("aria-selected", "true");
    expect(within(detailPanel()).getByText("WALL-25")).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: /Wall\s*1/ })).toBeInTheDocument();
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
});
