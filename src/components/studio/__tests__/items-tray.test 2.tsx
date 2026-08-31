/* "Items to place" — the toolbar tray (units↔rooms workflow, slice 2).

   next-move.test.ts pins the LIST (itemsToPlace) and is mutation-proven; this
   file pins the half only a mounted editor can prove — that the tray is wired
   to the live document and to arming. A tray fed the wrong systemId, or
   handed a dead onArmPlace, would pass every pure test and still be useless,
   which is exactly the seam worth a heavier test.

   The editor is injected with a local store and a stub pack loader (the real
   ones are auth-gated Server Functions that don't exist under jsdom), and
   `openDesignId` opens a seeded design straight into the Design step. */

import { act, render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Studio } from "../studio";
import { LocalDesignStore } from "@/lib/studio/store";
import {
  createDesign,
  type DesignDocument,
  type DesignObject,
  type Floor,
} from "@/lib/studio/document";
import { emptyPack, type DataPack, type IndoorUnit, type OutdoorUnit } from "@/lib/studio/packs/schema";

const prov = { kind: "extracted" as const, source: "test" };

function pack(): DataPack {
  const p = emptyPack({ brand: "me", version: "1", packSchemaVersion: 1, name: "t" });
  p.indoor_units.push({
    model: "IDU-25", brand: "me", series: "T", form_factor: "wall",
    capacity_cool_kw: 2.5, capacity_heat_kw: 3,
    conn_liquid_mm: 6.35, conn_gas_mm: 9.52,
    default_plane: "room", allowed_planes: ["room"],
    system_roles: ["split-pair"], refrigerant: "R32",
    width_mm: 798, depth_mm: 219, height_mm: 299, provenance: prov,
  } as IndoorUnit);
  p.outdoor_units.push({
    model: "ODU-25", brand: "me", series: "T", system_type: "split",
    capacity_cool_kw: 2.5, capacity_heat_kw: 3, phase: "1",
    conn_liquid_mm: 6.35, conn_gas_mm: 9.52, refrigerant: "R32",
    width_mm: 800, depth_mm: 285, height_mm: 550, provenance: prov,
  } as OutdoorUnit);
  return p;
}

const floor: Floor = {
  id: "flr", name: "G", level: 0, scaleMmPerUnit: 10,
  northDeg: null, northPos: null, plans: [],
};

const room: DesignObject = {
  id: "r1", type: "room", systemId: "sys1", floorId: "flr",
  geometry: {
    kind: "polygon",
    points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }],
  },
  plane: "room", props: { name: "Lounge" },
};

const placedIdu: DesignObject = {
  id: "u1", type: "unit", systemId: "sys1", floorId: "flr",
  geometry: { kind: "point", at: { x: 50, y: 50 } },
  plane: "room", props: { role: "idu", model: "IDU-25", roomId: "r1" },
};

function seeded(objects: DesignObject[]): DesignDocument {
  const d = createDesign({ name: "Tray", mode: "blank", now: "2026-08-25T00:00:00.000Z" });
  d.floors = [floor];
  d.systems = [
    {
      id: "sys1", type: "split", brand: "me", colour: "#2E68FF", name: "System 1",
      settings: { pairIdu: "IDU-25", pairOdu: "ODU-25", roomId: "r1" },
    },
  ];
  d.objects = objects;
  return d;
}

async function open(objects: DesignObject[]) {
  window.localStorage.clear();
  const store = new LocalDesignStore(window.localStorage);
  const doc = seeded(objects);
  await store.save(doc);
  /* the store load and the pack load both settle after mount — render inside
     act so their state lands before any assertion, rather than leaking
     "not wrapped in act" warnings through every test in the file */
  await act(async () => {
    render(
      <Studio
        store={store}
        openDesignId={doc.id}
        packLoader={async () => ({ pack: pack(), version: "1" })}
      />
    );
  });
  return doc;
}

const trayButton = () => screen.queryByRole("button", { name: /Items to place/ });

describe("the Items to place tray", () => {
  beforeEach(() => window.localStorage.clear());

  it("counts what the live document still owes the plan", async () => {
    await open([room]);
    /* a chosen pair with neither unit down: both are owed */
    await waitFor(() => expect(trayButton()).toBeInTheDocument());
    expect(trayButton()).toHaveAccessibleName("Items to place (2)");
  });

  it("drops to what is left once a unit is on the plan", async () => {
    await open([room, placedIdu]);
    await waitFor(() => expect(trayButton()).toBeInTheDocument());
    expect(trayButton()).toHaveAccessibleName("Items to place (1)");
  });

  it("is absent entirely when nothing is owed", async () => {
    /* both units placed. The tray is not a permanent control wearing a zero —
       its presence IS the signal that something is outstanding */
    const odu: DesignObject = {
      id: "u2", type: "unit", systemId: "sys1", floorId: "flr",
      geometry: { kind: "point", at: { x: 400, y: 400 } },
      plane: "external-ground", props: { role: "odu", model: "ODU-25" },
    };
    await open([room, placedIdu, odu]);
    /* wait for the editor itself, so "absent" can't just mean "not mounted" */
    await screen.findByRole("toolbar", { name: "Canvas tools" });
    expect(trayButton()).toBeNull();
  });

  it("closes the system group on the bench, after Component", async () => {
    /* Isaac's order (2026-08-25): the two pointer verbs lead together, then
       Room, then the system verbs — and the tray ends that run because it
       holds what choosing units left to do. Pinned by POSITION rather than
       presence: a control that drifts back next to Units still passes every
       other test in this file. */
    await open([room]);
    await waitFor(() => expect(trayButton()).toBeInTheDocument());
    const bench = screen.getByRole("toolbar", { name: "Canvas tools" });
    const labels = [...bench.querySelectorAll("button")]
      .map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim())
      .filter(Boolean);
    const at = (re: RegExp) => labels.findIndex((l) => re.test(l));

    expect(at(/^Erase/)).toBe(at(/^Select$/) + 1);
    expect(at(/Items to place/)).toBeGreaterThan(at(/^Component$/));
    /* and it is genuinely the last of the system verbs, not merely after one */
    expect(at(/Items to place/)).toBeGreaterThan(at(/^Units$/));
    expect(at(/Items to place/)).toBeGreaterThan(at(/^Duct$/));
  });

  it("opens to name each owed unit, the indoor one against its room", async () => {
    const user = userEvent.setup();
    await open([room]);
    await waitFor(() => expect(trayButton()).toBeInTheDocument());
    await user.click(trayButton()!);
    const tray = screen.getByRole("menu", { name: "Items to place" });
    const items = within(tray).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual([
      "IndoorIDU-25Lounge",
      /* the outdoor serves the system, so it names no room */
      "OutdoorODU-25",
    ]);
  });

  it("arms the unit it is dragged by, so the canvas drop commits that one", async () => {
    const user = userEvent.setup();
    await open([room]);
    await waitFor(() => expect(trayButton()).toBeInTheDocument());
    await user.click(trayButton()!);
    const items = within(screen.getByRole("menu", { name: "Items to place" })).getAllByRole("menuitem");

    const store: Record<string, string> = {};
    const dataTransfer = {
      setData: (k: string, v: string) => { store[k] = v; },
      getData: (k: string) => store[k] ?? "",
      effectAllowed: "none",
      dropEffect: "none",
    };
    /* drag the OUTDOOR one — the second item, not the first the flow would
       otherwise offer, so "arms what you grabbed" can't pass by accident */
    fireEvent.dragStart(items[1], { dataTransfer });
    expect(dataTransfer.getData("text/plain")).toBe("ODU-25");
    /* The canvas hint names the armed ROLE, and that is the only thing here
       that distinguishes which unit got armed — both roles arm the same place
       tool and the same cursor, so asserting the tool would pass even if the
       tray always armed its first item. */
    expect(
      await screen.findByText(/Click where the outdoor unit sits/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/Drop it in the room it serves/)).toBeNull();
  });

  it("arms on a plain click too, and closes behind itself", async () => {
    const user = userEvent.setup();
    await open([room]);
    await waitFor(() => expect(trayButton()).toBeInTheDocument());
    await user.click(trayButton()!);
    const items = within(screen.getByRole("menu", { name: "Items to place" })).getAllByRole("menuitem");
    await user.click(items[0]);
    expect(screen.queryByRole("menu", { name: "Items to place" })).toBeNull();
    /* the INDOOR one this time — the other half of the pair from the drag
       test, so between them neither role can be hard-coded */
    expect(await screen.findByText(/Drop it in the room it serves/)).toBeInTheDocument();
  });
});
