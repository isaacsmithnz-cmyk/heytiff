/* Unit browser (selector overhaul): tabs with counts, fit filters, sortable
   columns, ODU sub-choice, and the choose→arm payload. Small in-memory pack
   fixture — engine correctness against the real pack lives in select.test.ts. */

import { render, screen, fireEvent, within } from "@testing-library/react";
import { UnitBrowser } from "../unit-browser";
import { emptyPack, type DataPack, type IndoorUnit, type OutdoorUnit, type PairTable } from "@/lib/studio/packs/schema";

const prov = { kind: "extracted" as const, source: "test" };

function idu(model: string, ff: IndoorUnit["form_factor"], kw: number, dims: [number, number, number], airflow?: number): IndoorUnit {
  return {
    model, brand: "me", series: "T", form_factor: ff,
    capacity_cool_kw: kw, capacity_heat_kw: kw + 0.5,
    ...(airflow ? { airflow_ls: airflow } : {}),
    conn_liquid_mm: 6.35, conn_gas_mm: 12.7,
    default_plane: ff === "ducted" ? "ceiling-cavity" : "room",
    allowed_planes: [ff === "ducted" ? "ceiling-cavity" : "room"],
    system_roles: ["split-pair"], refrigerant: "R32",
    width_mm: dims[0], depth_mm: dims[1], height_mm: dims[2],
    provenance: prov,
  };
}

function odu(model: string, kw: number): OutdoorUnit {
  return {
    model, brand: "me", series: "T", system_type: "split",
    capacity_cool_kw: kw, capacity_heat_kw: kw + 0.5, phase: "1",
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

function fixturePack(): DataPack {
  const p = emptyPack({ brand: "me", version: "1", packSchemaVersion: 1, name: "t" });
  p.brands.push({ id: "me", name: "Test" });
  p.indoor_units.push(
    idu("WALL-25", "wall", 2.5, [800, 230, 300]),
    idu("WALL-35", "wall", 3.5, [900, 230, 305]),
    idu("DUCT-LOW", "ducted", 3.5, [900, 700, 200], 160),
    idu("DUCT-TALL", "ducted", 3.6, [1100, 700, 380], 300)
  );
  p.outdoor_units.push(odu("OD-25", 2.5), odu("OD-35", 3.5), odu("OD-35B", 3.5));
  p.pair_tables.push(
    pair("WALL-25", "OD-25", 2.5, 20),
    pair("WALL-35", "OD-35", 3.5, 20),
    pair("WALL-35", "OD-35B", 3.5, 30), // multi-ODU row
    pair("DUCT-LOW", "OD-35", 3.5, 25),
    pair("DUCT-TALL", "OD-35", 3.6, 25)
  );
  return p;
}

const noop = () => {};

describe("UnitBrowser", () => {
  it("portals to body with form-factor tabs and counts", () => {
    render(
      <UnitBrowser pack={fixturePack()} loadKw={null} basis="worst-of-both" nextRole="idu" onChoose={noop} onClose={noop} />
    );
    const dialog = screen.getByRole("dialog", { name: "Choose a unit" });
    expect(document.body.contains(dialog)).toBe(true);
    expect(screen.getByRole("button", { name: /Wall\s*2/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ducted\s*2/ })).toBeInTheDocument();
  });

  it("ducted tab shows the airflow column; height filter narrows rows", () => {
    render(
      <UnitBrowser pack={fixturePack()} loadKw={null} basis="worst-of-both" nextRole="idu" onChoose={noop} onClose={noop} />
    );
    fireEvent.click(screen.getByRole("button", { name: /Ducted/ }));
    expect(screen.getByText("DUCT-LOW")).toBeInTheDocument();
    expect(screen.getByText("DUCT-TALL")).toBeInTheDocument();
    expect(screen.getByText(/160 L\/s/)).toBeInTheDocument();
  });

  it("height filter (H ≤) keeps only low-profile ducted units", () => {
    render(
      <UnitBrowser pack={fixturePack()} loadKw={null} basis="worst-of-both" nextRole="idu" onChoose={noop} onClose={noop} />
    );
    fireEvent.click(screen.getByRole("button", { name: /Ducted/ }));
    const inputs = screen.getAllByPlaceholderText("mm");
    fireEvent.change(inputs[2], { target: { value: "250" } }); // H ≤ 250
    expect(screen.getByText("DUCT-LOW")).toBeInTheDocument();
    expect(screen.queryByText("DUCT-TALL")).not.toBeInTheDocument();
  });

  it("capacity gate + oversized toggle", () => {
    render(
      <UnitBrowser pack={fixturePack()} loadKw={2.4} basis="cooling" nextRole="idu" onChoose={noop} onClose={noop} />
    );
    // load 2.4, cap 3.6: WALL-25 (2.5) qualifies; WALL-35 (3.5) also ≤3.6 → both
    fireEvent.click(screen.getByRole("button", { name: /Wall/ }));
    expect(screen.getByText("WALL-25")).toBeInTheDocument();
    // WALL-25 is the smallest → best fit tag on its row
    expect(screen.getByText("best fit")).toBeInTheDocument();
  });

  it("sorting by height reorders; ODU sub-choice feeds the payload", () => {
    const chosen: unknown[] = [];
    render(
      <UnitBrowser
        pack={fixturePack()}
        loadKw={null}
        basis="worst-of-both"
        nextRole="idu"
        onChoose={(pairP, placing) => chosen.push({ odu: pairP.odu.model, placing })}
        onClose={noop}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Ducted/ }));
    fireEvent.click(screen.getByText("H mm"));
    const rows = screen.getAllByRole("row").slice(1); // skip header
    expect(rows[0]).toHaveTextContent("DUCT-LOW"); // 200mm sorts first

    // WALL-35 has two ODU options — pick the second, then Place
    fireEvent.click(screen.getByRole("button", { name: /Wall/ }));
    const select = screen.getByRole("combobox", { name: "Outdoor unit for WALL-35" });
    fireEvent.change(select, { target: { value: "1" } });
    const wallRow = screen.getByText("WALL-35").closest("tr")!;
    fireEvent.click(wallRow.querySelector("button.ds-ub-place")!);
    expect(chosen).toEqual([
      {
        odu: "OD-35B",
        placing: { role: "idu", model: "WALL-35", widthMm: 900, depthMm: 230 },
      },
    ]);
  });

  it("groups rows by series when there are 2+ series; the toggle flattens", () => {
    const p = fixturePack(); // all series "T"
    p.indoor_units.push({ ...idu("AP-25", "wall", 2.5, [820, 240, 290]), series: "AP" });
    p.outdoor_units.push(odu("OD-AP", 2.5));
    p.pair_tables.push(pair("AP-25", "OD-AP", 2.5, 20));

    render(
      <UnitBrowser pack={p} loadKw={null} basis="worst-of-both" nextRole="idu" onChoose={noop} onClose={noop} />
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
    expect(screen.getByText("WALL-25")).toBeInTheDocument();
    expect(screen.getByText("AP-25")).toBeInTheDocument();
  });

  it("the Columns menu toggles which spec columns show, and persists the choice", () => {
    window.localStorage.clear();
    render(
      <UnitBrowser pack={fixturePack()} loadKw={null} basis="worst-of-both" nextRole="idu" onChoose={noop} onClose={noop} />
    );
    // default wall columns: physical size shown, Sound not
    expect(screen.getByRole("columnheader", { name: /W mm/ })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /Sound/ })).toBeNull();

    // open the menu, turn Sound on and Width off
    fireEvent.click(screen.getByRole("button", { name: /Columns/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Sound/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Width/ }));

    expect(screen.getByRole("columnheader", { name: /Sound dBA/ })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /W mm/ })).toBeNull();

    // the choice is saved per-device
    const saved = JSON.parse(window.localStorage.getItem("heytiff.studio.unit-columns")!);
    expect(saved).toContain("sound");
    expect(saved).not.toContain("width");
  });

  it("compares selected units side by side and adds from a column", () => {
    const chosen: string[] = [];
    render(
      <UnitBrowser
        pack={fixturePack()}
        loadKw={null}
        basis="worst-of-both"
        nextRole="idu"
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
      <UnitBrowser pack={p} loadKw={null} basis="worst-of-both" nextRole="idu" onChoose={noop} onClose={noop} />
    );
    fireEvent.click(screen.getByRole("button", { name: /Wall/ }));

    ["WALL-25", "WALL-35", "WALL-45"].forEach((m) =>
      fireEvent.click(screen.getByRole("checkbox", { name: `Compare ${m}` }))
    );
    // three staged → the fourth can't be added
    expect(screen.getByRole("checkbox", { name: "Compare WALL-50" })).toBeDisabled();
  });

  it("Escape closes", () => {
    const onClose = jest.fn();
    render(
      <UnitBrowser pack={fixturePack()} loadKw={null} basis="worst-of-both" nextRole="idu" onChoose={noop} onClose={onClose} />
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
