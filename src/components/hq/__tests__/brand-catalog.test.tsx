import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HqBrandCatalog } from "../brand-catalog";
import { buildCatalogView } from "@/lib/hq/catalog";
import { groupBrandCatalog } from "@/lib/hq/grouping";
import {
  emptyPack,
  type DataPack,
  type IndoorUnit,
  type OutdoorUnit,
  type PackMeta,
} from "@/lib/studio/packs/schema";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

const META: PackMeta = { brand: "test", version: "1.0", packSchemaVersion: 1, name: "T" };

function ducted(model: string, patch: Partial<IndoorUnit> = {}): IndoorUnit {
  return {
    model,
    brand: "test",
    series: "PEAD-M-JAA",
    form_factor: "ducted",
    capacity_cool_kw: 5,
    capacity_heat_kw: 6,
    conn_liquid_mm: 6.35,
    conn_gas_mm: 12.7,
    default_plane: "ceiling-cavity",
    allowed_planes: ["ceiling-cavity"],
    system_roles: [],
    refrigerant: "R32",
    width_mm: 700,
    depth_mm: 600,
    height_mm: 250,
    provenance: { kind: "extracted", source: "Book" },
    ...patch,
  };
}

function multiOdu(model: string): OutdoorUnit {
  return {
    model,
    brand: "test",
    series: "MXZ-F",
    system_type: "multi",
    capacity_cool_kw: 5,
    capacity_heat_kw: 6,
    phase: "1",
    conn_liquid_mm: 6.35,
    conn_gas_mm: 12.7,
    refrigerant: "R32",
    ports: 2,
    provenance: { kind: "extracted", source: "Book" },
  };
}

function groupsOf(mutate?: (p: DataPack) => void) {
  const p = emptyPack(META);
  p.indoor_units = [ducted("D1")];
  mutate?.(p);
  return groupBrandCatalog(buildCatalogView(p, []));
}

/** Series groups now load CLOSED — these table-level assertions want them open,
    so every render here goes through the Expand all control first. */
function renderOpen(ui: React.ReactElement) {
  const res = render(ui);
  fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
  return res;
}

describe("HqBrandCatalog — ported editor behaviours", () => {
  it("renders a blocking + and a nice-to-know + for missing fields", () => {
    renderOpen(<HqBrandCatalog groups={groupsOf()} />);
    const airflow = screen.getByRole("button", { name: /Add Airflow/ });
    expect(airflow.className).toMatch(/block/); // Tier-1: ducted needs airflow
    const weight = screen.getByRole("button", { name: /Add Weight/ });
    expect(weight.className).not.toMatch(/block/); // Tier-3: never blocks
    expect(screen.getByText(/of 1 engine-ready/)).toBeInTheDocument();
  });

  it("calls the injected save action with a parsed numeric value", async () => {
    const onSave = jest.fn().mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderOpen(<HqBrandCatalog groups={groupsOf()} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: /Airflow/ }));
    await user.type(screen.getByLabelText("Airflow (Hi)"), "210");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith({
      section: "indoor_units",
      rowKey: "D1",
      field: "airflow_ls",
      value: 210,
    });
  });

  it("blocks save on invalid input and shows an error", async () => {
    const onSave = jest.fn().mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderOpen(<HqBrandCatalog groups={groupsOf()} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: /Airflow/ }));
    await user.type(screen.getByLabelText("Airflow (Hi)"), "abc");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/must be a number/i)).toBeInTheDocument();
  });

  it("highlights a manually overridden value and exposes its provenance", async () => {
    const p = emptyPack(META);
    p.indoor_units = [ducted("D1")];
    const view = buildCatalogView(p, [
      {
        section: "indoor_units",
        rowKey: "D1",
        field: "airflow_ls",
        value: 210,
        by: "isaac@heytiff.com",
        at: "2026-07-16T00:00:00Z",
      },
    ]);
    const onSave = jest.fn().mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderOpen(<HqBrandCatalog groups={groupBrandCatalog(view)} onSave={onSave} />);

    const cell = screen.getByRole("button", { name: /Airflow.*210/ });
    expect(cell.querySelector(".edited")).not.toBeNull(); // amber value + dot

    await user.click(cell);
    expect(screen.getByText(/Manual override/)).toBeInTheDocument();
    expect(screen.getByText(/Pack value/)).toBeInTheDocument();
  });
});

describe("HqBrandCatalog — drill-down structure", () => {
  it("renders three system tabs and switches content on click", async () => {
    const user = userEvent.setup();
    renderOpen(
      <HqBrandCatalog
        groups={groupsOf((p) => {
          p.outdoor_units = [multiOdu("MXZ-1")];
        })}
      />
    );

    expect(screen.getByRole("button", { name: /Split systems/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Multi-split/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /VRF/ })).toBeInTheDocument();

    // split tab shows the ducted unit
    expect(screen.getByText("D1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Multi-split/ }));
    expect(screen.queryByText("D1")).not.toBeInTheDocument();
    expect(screen.getByText("MXZ-1")).toBeInTheDocument();
  });

  it("renders form-factor and series group headers with readiness summary", () => {
    renderOpen(<HqBrandCatalog groups={groupsOf()} />);
    expect(screen.getByText("Ducted")).toBeInTheDocument(); // form label
    expect(screen.getByText("PEAD-M-JAA")).toBeInTheDocument(); // series
    expect(screen.getByText("0/1 ready")).toBeInTheDocument();
    // fields missing across the whole series collapse into the To-add group
    expect(screen.getByText(/To add · \d+ fields/)).toBeInTheDocument();
    expect(screen.getByText("Airflow (Hi)")).toBeInTheDocument(); // To-add sub-header
    expect(screen.getByText(/of 22 specs mapped/)).toBeInTheDocument();
  });

  it("renders capacity chips and the per-row status cell", () => {
    renderOpen(<HqBrandCatalog groups={groupsOf()} />);
    const cool = screen.getByRole("button", { name: /Cooling capacity — D1: 5/ });
    expect(cool.querySelector(".hq-cmp-chip.cool")).not.toBeNull();
    const heat = screen.getByRole("button", { name: /Heating capacity — D1: 6/ });
    expect(heat.querySelector(".hq-cmp-chip.heat")).not.toBeNull();
    expect(screen.getByText("3 blocking")).toBeInTheDocument(); // airflow + both airways
    expect(screen.getByText("8/22")).toBeInTheDocument(); // specs filled / total
  });

  it("renders airway columns for ducted series only, with a blocking +", () => {
    renderOpen(
      <HqBrandCatalog
        groups={groupsOf((p) => {
          p.indoor_units = [ducted("D1"), ducted("W1", { form_factor: "wall" })];
        })}
      />
    );
    // ducted D1 gets red-tinted airway + cells; amps stays a neutral +
    const supply = screen.getByRole("button", { name: /Add Supply airway — D1/ });
    expect(supply.className).toMatch(/block/);
    const amps = screen.getByRole("button", { name: /Add Max running amps — D1/ });
    expect(amps.className).not.toMatch(/block/);
    // the wall series has no airway cells at all
    expect(
      screen.queryByRole("button", { name: /Add Supply airway — W1/ })
    ).not.toBeInTheDocument();
  });

  it("renders a saved airway box as W × H and a keyword answer as text", () => {
    renderOpen(
      <HqBrandCatalog
        groups={groupsOf((p) => {
          p.indoor_units = [
            ducted("D1", {
              supply_opening: { w_mm: 595, h_mm: 195 },
              return_opening: "built-in",
            }),
          ];
        })}
      />
    );
    expect(
      screen.getByRole("button", { name: /Supply airway — D1: 595 × 195/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Return airway — D1: built-in/ })
    ).toBeInTheDocument();
  });

  it("shows ✓ Ready for engine-ready rows", () => {
    renderOpen(
      <HqBrandCatalog
        groups={groupsOf((p) => {
          p.indoor_units = [ducted("W1", { form_factor: "wall" })];
        })}
      />
    );
    expect(screen.getByText("✓ Ready")).toBeInTheDocument();
  });

  it("shows a static system chip for outdoor units (not a tag button)", async () => {
    const user = userEvent.setup();
    renderOpen(
      <HqBrandCatalog
        groups={groupsOf((p) => {
          p.outdoor_units = [multiOdu("MXZ-1")];
        })}
      />
    );
    await user.click(screen.getByRole("button", { name: /Multi-split/ }));
    const chip = screen.getByText("multi");
    expect(chip.tagName).toBe("SPAN");
    expect(chip.className).toMatch(/static/);
  });

  it("loads with every series group closed, and expands one on click", async () => {
    const user = userEvent.setup();
    render(<HqBrandCatalog groups={groupsOf()} />);

    const header = screen.getByRole("button", { name: /PEAD-M-JAA/ });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("D1")).not.toBeInTheDocument();

    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("D1")).toBeInTheDocument();

    await user.click(header);
    expect(screen.queryByText("D1")).not.toBeInTheDocument();
  });

  it("expands and collapses every group from one control", async () => {
    const user = userEvent.setup();
    render(
      <HqBrandCatalog
        groups={groupsOf((p) => {
          p.indoor_units = [ducted("D1"), ducted("W1", { form_factor: "wall" })];
        })}
      />
    );

    await user.click(screen.getByRole("button", { name: "Expand all" }));
    expect(screen.getByText("D1")).toBeInTheDocument();
    expect(screen.getByText("W1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(screen.queryByText("D1")).not.toBeInTheDocument();
    expect(screen.queryByText("W1")).not.toBeInTheDocument();
  });

  it("shows the multi empty state when only ODUs serve multi", async () => {
    const user = userEvent.setup();
    renderOpen(
      <HqBrandCatalog
        groups={groupsOf((p) => {
          p.outdoor_units = [multiOdu("MXZ-1")];
        })}
      />
    );
    await user.click(screen.getByRole("button", { name: /Multi-split/ }));
    expect(
      screen.getByText(/multi-split outdoor units only — no indoor units are tagged/i)
    ).toBeInTheDocument();
  });

  it("shows a unit's system tags on its row", () => {
    renderOpen(
      <HqBrandCatalog
        groups={groupsOf((p) => {
          p.indoor_units = [ducted("DUAL", { system_roles: ["split-pair", "vrf"] })];
        })}
      />
    );
    // the tag chip lists every claimed system
    expect(screen.getByText(/Split \(1:1\) · VRF/)).toBeInTheDocument();
  });
});

describe("HqBrandCatalog — tag editor", () => {
  it("saves toggled tags through the injected action", async () => {
    const onSave = jest.fn().mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderOpen(
      <HqBrandCatalog
        groups={groupsOf((p) => {
          p.indoor_units = [ducted("D1", { system_roles: ["split-pair"] })];
        })}
        onSave={onSave}
      />
    );

    await user.click(screen.getByRole("button", { name: /Split \(1:1\)/ }));
    await user.click(screen.getByRole("checkbox", { name: "VRF" }));
    await user.click(screen.getByRole("button", { name: "Save tags" }));

    expect(onSave).toHaveBeenCalledWith({
      section: "indoor_units",
      rowKey: "D1",
      field: "system_roles",
      value: ["split-pair", "vrf"],
    });
  });

  it("refuses to save an empty tag set", async () => {
    const onSave = jest.fn().mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderOpen(
      <HqBrandCatalog
        groups={groupsOf((p) => {
          p.indoor_units = [ducted("D1", { system_roles: ["split-pair"] })];
        })}
        onSave={onSave}
      />
    );

    await user.click(screen.getByRole("button", { name: /Split \(1:1\)/ }));
    await user.click(screen.getByRole("checkbox", { name: "Split (1:1)" })); // untick the only tag
    await user.click(screen.getByRole("button", { name: "Save tags" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/at least one tag/i)).toBeInTheDocument();
  });

  it("applies tags to a whole series via the bulk button", async () => {
    const onSave = jest.fn().mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderOpen(
      <HqBrandCatalog
        groups={groupsOf((p) => {
          p.indoor_units = [
            ducted("D1", { system_roles: ["split-pair"] }),
            ducted("D2", { system_roles: ["split-pair"], capacity_cool_kw: 7 }),
          ];
        })}
        onSave={onSave}
      />
    );

    await user.click(screen.getByRole("button", { name: "Tags…" }));
    expect(screen.getByText(/Applies to/)).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "VRF" }));
    await user.click(screen.getByRole("button", { name: "Save tags" }));

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ rowKey: "D1", field: "system_roles" })
    );
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ rowKey: "D2", field: "system_roles" })
    );
  });
});

describe("HqBrandCatalog — airway editor", () => {
  it("saves a W×H box through the airway control", async () => {
    const onSave = jest.fn().mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderOpen(<HqBrandCatalog groups={groupsOf()} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: /Add Supply airway — D1/ }));
    await user.type(screen.getByLabelText("Width (mm)"), "595");
    await user.type(screen.getByLabelText("Height (mm)"), "195");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith({
      section: "indoor_units",
      rowKey: "D1",
      field: "supply_opening",
      value: { w_mm: 595, h_mm: 195 },
    });
  });

  it("saves the built-in keyword via its radio", async () => {
    const onSave = jest.fn().mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderOpen(<HqBrandCatalog groups={groupsOf()} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: /Add Return airway — D1/ }));
    await user.click(screen.getByRole("radio", { name: /Built-in/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith({
      section: "indoor_units",
      rowKey: "D1",
      field: "return_opening",
      value: "built-in",
    });
  });

  it("requires both dimensions before saving a box", async () => {
    const onSave = jest.fn().mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderOpen(<HqBrandCatalog groups={groupsOf()} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: /Add Supply airway — D1/ }));
    await user.type(screen.getByLabelText("Width (mm)"), "595");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/enter both width and height/i)).toBeInTheDocument();
  });

  it("seeds the control from an existing box and round-trips an edit", async () => {
    const onSave = jest.fn().mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderOpen(
      <HqBrandCatalog
        groups={groupsOf((p) => {
          p.indoor_units = [ducted("D1", { supply_opening: { w_mm: 595, h_mm: 195 } })];
        })}
        onSave={onSave}
      />
    );

    await user.click(screen.getByRole("button", { name: /Supply airway — D1: 595 × 195/ }));
    const width = screen.getByLabelText("Width (mm)");
    expect(width).toHaveValue("595");
    await user.clear(width);
    await user.type(width, "600");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ field: "supply_opening", value: { w_mm: 600, h_mm: 195 } })
    );
  });
});

describe("HqBrandCatalog — search", () => {
  const mixed = () =>
    groupsOf((p) => {
      p.indoor_units = [
        ducted("PEAD-M50", { series: "PEAD-M-JAA" }),
        ducted("PEAD-M60", { series: "PEAD-M-JAA", capacity_cool_kw: 6 }),
        ducted("MSZ-AP25", { series: "MSZ-AP", form_factor: "wall" }),
      ];
      p.outdoor_units = [multiOdu("MXZ-1")];
    });

  it("filters to matching models and opens the surviving group", async () => {
    const user = userEvent.setup();
    render(<HqBrandCatalog groups={mixed()} />);

    await user.type(screen.getByLabelText("Search models or series"), "ap25");

    // matches render open — no second click needed
    expect(screen.getByText("MSZ-AP25")).toBeInTheDocument();
    expect(screen.queryByText("PEAD-M50")).not.toBeInTheDocument();
    // the non-matching series group is gone entirely, not just closed
    expect(
      screen.queryByRole("button", { name: /PEAD-M-JAA/ })
    ).not.toBeInTheDocument();
    expect(screen.getByText(/1 match in this pack/)).toBeInTheDocument();
  });

  it("keeps a whole series when the series name matches", async () => {
    const user = userEvent.setup();
    render(<HqBrandCatalog groups={mixed()} />);

    await user.type(screen.getByLabelText("Search models or series"), "pead");

    expect(screen.getByText("PEAD-M50")).toBeInTheDocument();
    expect(screen.getByText("PEAD-M60")).toBeInTheDocument();
    expect(screen.queryByText("MSZ-AP25")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /PEAD-M-JAA/ })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
  });

  it("counts matches per system tab", async () => {
    const user = userEvent.setup();
    render(<HqBrandCatalog groups={mixed()} />);

    await user.type(screen.getByLabelText("Search models or series"), "mxz");

    // the hit lives on the multi tab; split shows a dimmed zero
    const split = screen.getByRole("button", { name: /Split systems/ });
    expect(split.className).toMatch(/none/);
    expect(split).toHaveTextContent("0");
    await user.click(screen.getByRole("button", { name: /Multi-split/ }));
    expect(screen.getByText("MXZ-1")).toBeInTheDocument();
  });

  it("says so when nothing matches, and clearing restores the closed page", async () => {
    const user = userEvent.setup();
    render(<HqBrandCatalog groups={mixed()} />);

    const box = screen.getByLabelText("Search models or series");
    await user.type(box, "zzz");
    expect(screen.getByText(/No model, series or model code/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(box).toHaveValue("");
    expect(screen.getByRole("button", { name: /PEAD-M-JAA/ })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });
});
