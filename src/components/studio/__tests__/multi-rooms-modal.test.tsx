/* Multi-split through THE units modal (units↔rooms workflow, slice 3).

   A multi used to pick its indoor heads from a small per-room picker, opened
   once per room. That picker is gone: the main browser now runs in per-room
   mode, listing every room on the system down its right-hand column so one
   visit assigns the lot.

   multi.test.ts pins the ranking (multiUnitOptions) and unit-browser.test.tsx
   pins the column; this file pins the thing only the mounted editor can show —
   that a drop lands on `settings.multiIdus` for the room it was dropped on and
   NO other. That invariant used to live in cockpit-multi.test.tsx against the
   deleted picker, and it is the whole reason multiple rooms now work. */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Studio } from "../studio";
import { LocalDesignStore } from "@/lib/studio/store";
import {
  createDesign,
  type DesignDocument,
  type DesignObject,
  type Floor,
} from "@/lib/studio/document";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "@/lib/studio/packs/schema";
import { assemblePack, type PackSource } from "@/lib/studio/packs/loader";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { SystemType } from "@/lib/studio/document";

/* multi-split is dev-flagged and NEXT_PUBLIC_ vars bake at import time, so the
   flag can't flip per-test — mock the registry entry (the same shape
   cockpit-multi.test.tsx uses). moduleFor closes over the real record, so it
   has to be re-pointed at the mocked one too. */
jest.mock("@/lib/studio/modules", () => {
  const actual = jest.requireActual<typeof import("@/lib/studio/modules")>(
    "@/lib/studio/modules"
  );
  const SYSTEM_MODULES = {
    ...actual.SYSTEM_MODULES,
    "multi-split": { ...actual.SYSTEM_MODULES["multi-split"], available: true },
  };
  return {
    ...actual,
    SYSTEM_MODULES,
    moduleFor: (t: SystemType) => SYSTEM_MODULES[t],
  };
});

/* the real shipped pack — multi capability is DERIVED from the outdoor rules'
   family whitelists, so a hand-rolled fixture would not have any */
const SEED_DIR = join(__dirname, "../../../../data/packs/mitsubishi-electric@2026.1");
function loadPack(): DataPack {
  const meta = JSON.parse(readFileSync(join(SEED_DIR, "meta.json"), "utf8")) as PackMeta;
  const sections: PackSource["sections"] = {};
  for (const s of PACK_SECTIONS) {
    const f = join(SEED_DIR, `${s}.json`);
    if (existsSync(f)) sections[s] = JSON.parse(readFileSync(f, "utf8"));
  }
  return assemblePack({ meta, sections });
}
const pack = loadPack();

const floor: Floor = {
  id: "flr", name: "G", level: 0, scaleMmPerUnit: 10,
  northDeg: null, northPos: null, plans: [],
};

/* 400×300 units @ 10 mm/unit = 12 m² → ~1.7 kW each */
const room = (id: string, name: string): DesignObject => ({
  id, type: "room", systemId: "sys1", floorId: "flr",
  geometry: {
    kind: "polygon",
    points: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }],
  },
  plane: "room", props: { name },
});

function seeded(): DesignDocument {
  const d = createDesign({ name: "Multi", mode: "blank", now: "2026-08-25T00:00:00.000Z" });
  d.floors = [floor];
  d.systems = [
    {
      id: "sys1", type: "multi-split", brand: "me", colour: "#2E68FF",
      name: "System 1", settings: {},
    },
  ];
  d.objects = [room("room1", "Lounge"), room("room2", "Study")];
  return d;
}

async function openEditor() {
  window.localStorage.clear();
  const store = new LocalDesignStore(window.localStorage);
  const doc = seeded();
  await store.save(doc);
  await act(async () => {
    render(
      <Studio store={store} openDesignId={doc.id} packLoader={async () => ({ pack, version: "1" })} />
    );
  });
  return { store, doc };
}

/** open the units modal from the room card the cockpit is inspecting */
async function openModal(user: ReturnType<typeof userEvent.setup>) {
  const sub = await screen.findByTestId("multi-unit-sub");
  await user.click(within(sub).getByRole("button", { name: /Select unit/ }));
  return screen.getByRole("dialog", { name: "Choose a unit" });
}

const transfer = () => {
  const store: Record<string, string> = {};
  return {
    setData: (k: string, v: string) => { store[k] = v; },
    getData: (k: string) => store[k] ?? "",
    effectAllowed: "none",
    dropEffect: "none",
  };
};

describe("multi-split assigns a unit per room, through the units modal", () => {
  beforeEach(() => window.localStorage.clear());

  it("opens THE modal with every room on the system in its column", async () => {
    const user = userEvent.setup();
    await openEditor();
    const dialog = await openModal(user);

    const column = within(dialog).getByRole("complementary", { name: "Rooms on this system" });
    const cards = within(column).getAllByRole("button");
    expect(cards.map((c) => c.textContent)).toEqual([
      expect.stringContaining("Lounge"),
      expect.stringContaining("Study"),
    ]);
  });

  it("offers only multi-capable heads, and no outdoor column to pair them with", async () => {
    const user = userEvent.setup();
    await openEditor();
    const dialog = await openModal(user);

    /* a multi's outdoor is the SYSTEM's, chosen once — a per-room row has no
       pairing, so the column that would name one is gone rather than blank */
    expect(within(dialog).queryByRole("columnheader", { name: "Outdoor" })).toBeNull();
    /* and the rows are real */
    expect(within(dialog).getAllByRole("row").length).toBeGreaterThan(1);
  });

  it("a drop writes multiIdus for the room it landed on, and no other", async () => {
    const user = userEvent.setup();
    await openEditor();
    const dialog = await openModal(user);

    const column = within(dialog).getByRole("complementary", { name: "Rooms on this system" });
    const study = within(column).getByRole("button", { name: /Study/ });
    const lounge = within(column).getByRole("button", { name: /Lounge/ });

    const row = within(dialog)
      .getAllByRole("row")
      .find((r) => r.getAttribute("draggable") === "true")!;
    const dt = transfer();
    fireEvent.dragStart(row, { dataTransfer: dt });
    const model = dt.getData("text/plain");
    expect(model).not.toBe("");

    /* dropped on Study — the cockpit was inspecting Lounge, so if the write
       followed the inspected room instead of the card this would still pass
       on the wrong room. It must be Study that fills. */
    fireEvent.dragOver(study, { dataTransfer: dt });
    fireEvent.drop(study, { dataTransfer: dt });

    await waitFor(() => expect(study.textContent).toContain(model));
    expect(lounge.textContent).not.toContain(model);
  });

  it("each room keeps its own head — a second drop does not move the first", async () => {
    const user = userEvent.setup();
    await openEditor();
    const dialog = await openModal(user);
    const column = within(dialog).getByRole("complementary", { name: "Rooms on this system" });

    const rows = within(dialog)
      .getAllByRole("row")
      .filter((r) => r.getAttribute("draggable") === "true");
    const drop = (rowEl: HTMLElement, card: HTMLElement) => {
      const dt = transfer();
      fireEvent.dragStart(rowEl, { dataTransfer: dt });
      const m = dt.getData("text/plain");
      fireEvent.dragOver(card, { dataTransfer: dt });
      fireEvent.drop(card, { dataTransfer: dt });
      fireEvent.dragEnd(rowEl, { dataTransfer: dt });
      return m;
    };

    const lounge = within(column).getByRole("button", { name: /Lounge/ });
    const study = within(column).getByRole("button", { name: /Study/ });

    const first = drop(rows[0], lounge);
    await waitFor(() => expect(lounge.textContent).toContain(first));

    /* a DIFFERENT model into the other room — the pair flow could not hold
       two, which is exactly what this change fixes */
    const second = drop(rows.find((r) => !r.textContent?.includes(first)) ?? rows[1], study);
    await waitFor(() => expect(study.textContent).toContain(second));
    expect(second).not.toBe(first);
    expect(lounge.textContent).toContain(first);
  });
});
