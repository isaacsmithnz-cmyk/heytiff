/* Two panels share this file.

   SystemsPanel — the Design step's right panel in the zones flow
   (docs/studio-zones-and-systems.md, "The panel and the plan"): one card per
   system, at rest or open; the rack of units to place under the open card;
   zone chips that clear with a cross or drag between cards; and Zones without
   a system. Mounted over the real Mitsubishi pack and the builder-jobs house
   (src/lib/studio/__tests__/builder-jobs.test.ts), so a pack change that
   moves a figure fails here too. The panel only reports — every write goes
   out through a callback, and each one is a jest.fn here.

   SystemCockpit — the type-first flow's panel, kept as it was: changing a
   system's type + closing a system. Only `split` is an available module
   today, so the reachable type path is re-picking the current type; that
   (and cancelling) must NOT delete the system's placed units — deletion
   happens only when the type actually changes. */

import { render, screen, fireEvent, within } from "@testing-library/react";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { SystemsPanel, ZONE_DRAG } from "../systems-panel";
import { SystemCockpit } from "../cockpit-panel";
import {
  createDesign,
  type DesignDocument,
  type DesignObject,
  type DesignSystem,
  type Floor,
} from "@/lib/studio/document";
import { emptyPack, PACK_SECTIONS, type DataPack, type PackMeta } from "@/lib/studio/packs/schema";
import { assemblePack, type PackSource } from "@/lib/studio/packs/loader";
import { addHead, allocationsOf, placeAllocation } from "@/lib/studio/builder";
import { claimZone, newSystem } from "@/lib/studio/zones";
import { systemCover } from "@/lib/studio/coverage";
import { roomLoadKw, type RoomObj } from "@/lib/studio/loads-room";

/* ═══════════════════ SystemsPanel — the zones flow ═══════════════════ */

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
const mePack = loadPack();
const basis = "worst-of-both" as const;

interface Zone {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** the builder-jobs house: five rooms that belong to the plan (systemId
    null), 10 mm per unit, their loads from the Studio's own model */
const HOUSE: Zone[] = [
  { id: "living", name: "Living", x: 0, y: 0, w: 1000, h: 960 }, // ~96 m²
  { id: "bed1", name: "Bed 1", x: 1100, y: 0, w: 400, h: 300 }, // 12 m²
  { id: "bed2", name: "Bed 2", x: 1600, y: 0, w: 450, h: 400 }, // 18 m²
  { id: "master", name: "Master", x: 2150, y: 0, w: 550, h: 500 }, // 27.5 m²
  { id: "study", name: "Study", x: 1100, y: 500, w: 400, h: 320 }, // ~12.8 m²
];

/** the same five zones drawn small enough for the multi's heads to cover
    them (at 145 W/m²: a 3.5 on 20 m², a 2.0 on 12, a 4.2 on 24, a 2.5 on
    14). On the house as drawn a short zone takes the resting line, so this is
    the house where the line gets to count units instead. */
const FITTED: Zone[] = [
  { id: "living", name: "Living", x: 0, y: 0, w: 400, h: 350 }, // 14 m²
  { id: "bed1", name: "Bed 1", x: 500, y: 0, w: 400, h: 300 }, // 12 m²
  { id: "bed2", name: "Bed 2", x: 1000, y: 0, w: 400, h: 300 }, // 12 m²
  { id: "master", name: "Master", x: 1500, y: 0, w: 500, h: 400 }, // 20 m²
  { id: "study", name: "Study", x: 500, y: 400, w: 600, h: 400 }, // 24 m²
];

function plan(zones: Zone[]): { doc: DesignDocument; room: Record<string, RoomObj> } {
  const doc = createDesign({ name: "house", mode: "blank" }); // 10 mm per unit
  const floorId = doc.floors[0].id;
  const room: Record<string, RoomObj> = {};
  for (const z of zones) {
    const r = {
      id: z.id,
      type: "room",
      systemId: null,
      floorId,
      plane: "room",
      geometry: {
        kind: "polygon",
        points: [
          { x: z.x, y: z.y },
          { x: z.x + z.w, y: z.y },
          { x: z.x + z.w, y: z.y + z.h },
          { x: z.x, y: z.y + z.h },
        ],
      },
      props: { name: z.name },
    } as RoomObj;
    doc.objects.push(r as DesignObject);
    room[z.id] = r;
  }
  return { doc, room };
}
const house = () => plan(HOUSE);
const fittedHouse = () => plan(FITTED);

/** a system with these zones claimed and nothing in it yet */
function claimed(doc: DesignDocument, zoneIds: string[]): { doc: DesignDocument; systemId: string } {
  const made = newSystem(doc, mePack.meta.version);
  let d = made.doc;
  for (const z of zoneIds) d = claimZone(d, made.systemId, z);
  return { doc: d, systemId: made.systemId };
}

/** the mock's System 2, as builder-jobs builds it: five heads on five zones,
    which proposes MXZ-5F100VGD — six units, none on the plan */
const HEADS: [zoneId: string, iduModel: string][] = [
  ["master", "MSZ-AP35VGD2"],
  ["bed1", "MSZ-AP20VGD"],
  ["bed2", "MSZ-AP20VGD"],
  ["study", "MSZ-AP42VGD2"],
  ["living", "MSZ-AP25VGD2"],
];
function fiveHeadMulti(doc: DesignDocument): { doc: DesignDocument; systemId: string } {
  const made = claimed(doc, ["bed1", "bed2", "master", "study", "living"]);
  let d = made.doc;
  for (const [zoneId, iduModel] of HEADS) {
    d = addHead(d, mePack, { systemId: made.systemId, zoneId, iduModel });
  }
  return { doc: d, systemId: made.systemId };
}

/** System 1 over Master and Bed 1, System 2 over Study; Living and Bed 2
    without a system */
function twoSystems(): { doc: DesignDocument; one: string; two: string } {
  const { doc } = house();
  const one = claimed(doc, ["master", "bed1"]);
  const two = claimed(one.doc, ["study"]);
  return { doc: two.doc, one: one.systemId, two: two.systemId };
}

const sysOf = (doc: DesignDocument, id: string): DesignSystem => doc.systems.find((s) => s.id === id)!;

/** every unit of a system put on the plan, anywhere: placing gives a unit a
    position, never a zone */
function placeAll(doc: DesignDocument, systemId: string): DesignDocument {
  let d = doc;
  allocationsOf(sysOf(doc, systemId)).forEach((a, i) => {
    d = placeAllocation(d, mePack, systemId, a.id, d.floors[0].id, { x: 100 + i * 150, y: 1400 });
  });
  return d;
}

function mount(doc: DesignDocument, activeSystemId: string | null = null, pack: DataPack | null = mePack) {
  const on = {
    onActivate: jest.fn(),
    onAddSystem: jest.fn(),
    onAddZones: jest.fn(),
    onBuild: jest.fn(),
    onInstall: jest.fn(),
    onDeleteSystem: jest.fn(),
    onArmPlace: jest.fn(),
    onMoveZone: jest.fn(),
    onClaimZone: jest.fn(),
    onRemoveZone: jest.fn(),
  };
  const utils = render(
    <SystemsPanel doc={doc} pack={pack} basis={basis} activeSystemId={activeSystemId} {...on} />
  );
  return { ...utils, ...on };
}

/** a system's card: a labelled section */
const card = (name: string): HTMLElement => screen.getByRole("region", { name });

/** the card's one status line */
function statusOf(el: HTMLElement): HTMLElement {
  const lines = el.querySelectorAll<HTMLElement>(".ds-zp-status");
  expect(lines).toHaveLength(1);
  return lines[0];
}

const chipOf = (el: HTMLElement, name: string): HTMLElement =>
  [...el.querySelectorAll<HTMLElement>(".ds-zn")].find((c) => c.textContent === name)!;

const rackRows = (el: HTMLElement): HTMLElement[] => [...el.querySelectorAll<HTMLElement>(".ds-zp-unit")];
const modelOf = (row: HTMLElement): string => row.querySelector("b")!.textContent ?? "";

/** jsdom has no DataTransfer. The handlers read `types` and `getData`, and
    write `setData`, `effectAllowed` and `dropEffect`: a stub carrying a zone
    payload is a zone drag; one without is some other drag. */
function transfer(payload?: { zoneId: string; from: string | null }) {
  const json = payload ? JSON.stringify(payload) : "";
  return {
    types: payload ? [ZONE_DRAG] : ["text/plain"],
    getData: jest.fn(() => json),
    setData: jest.fn(),
    effectAllowed: "",
    dropEffect: "",
  };
}

describe("SystemsPanel — Add a system", () => {
  it("with no systems the body offers one Add a system, and it starts one", () => {
    const { onAddSystem } = mount(house().doc);
    const buttons = screen.getAllByRole("button", { name: "Add a system" });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveClass("ds-zp-addsys");
    fireEvent.click(buttons[0]);
    expect(onAddSystem).toHaveBeenCalledTimes(1);
  });

  it("with a system the header carries Add a system and the body's is gone", () => {
    const { doc } = claimed(house().doc, ["master"]);
    const { onAddSystem, container } = mount(doc);
    const buttons = screen.getAllByRole("button", { name: "Add a system" });
    expect(buttons).toHaveLength(1);
    expect(buttons[0].closest(".ds-zp-h")).not.toBeNull();
    expect(container.querySelector(".ds-zp-addsys")).toBeNull();
    fireEvent.click(buttons[0]);
    expect(onAddSystem).toHaveBeenCalledTimes(1);
  });
});

describe("SystemsPanel — a card at rest", () => {
  it("a new system with no zones is its name and brand, and says No zones", () => {
    const made = newSystem(house().doc, mePack.meta.version);
    mount(made.doc);
    const el = card("System 1");
    expect(within(el).getByRole("button", { name: "System 1" })).toHaveAttribute("aria-expanded", "false");
    expect(within(el).getByText("Mitsubishi Electric")).toHaveClass("ds-zp-brand");
    expect(el.querySelector(".ds-zp-kind")).toBeNull(); // nothing in it says what it is yet
    expect(statusOf(el).textContent).toBe("No zones");
    expect(el.querySelector(".ds-zn")).toBeNull(); // its zones show only when it is open
  });

  it("a system that has claimed a zone but has no unit says No units yet", () => {
    const { doc } = claimed(house().doc, ["master"]);
    mount(doc);
    const line = statusOf(card("System 1"));
    expect(line.textContent).toBe("No units yet");
    expect(line).toHaveClass("quiet");
  });

  it("the five-head multi says Multi and counts its units: 6 units, 6 to place", () => {
    const { doc } = fiveHeadMulti(fittedHouse().doc);
    mount(doc);
    const el = card("System 1");
    expect(within(el).getByText("Multi")).toHaveClass("ds-zp-kind");
    expect(within(el).getByText("Mitsubishi Electric")).toHaveClass("ds-zp-brand");
    const line = statusOf(el);
    expect(line.textContent).toBe("6 units, 6 to place");
    expect(line).toHaveClass("quiet");
  });

  it("once every unit is on the plan the line reads Install questions next", () => {
    const made = fiveHeadMulti(fittedHouse().doc);
    mount(placeAll(made.doc, made.systemId));
    expect(statusOf(card("System 1")).textContent).toBe("Install questions next");
  });

  it("a short zone takes the line, in red", () => {
    // the house as builder-jobs draws it: a 2.0 kW head on Bed 2's 18 m² is short
    const { doc } = fiveHeadMulti(house().doc);
    mount(doc);
    const line = statusOf(card("System 1"));
    expect(line.textContent).toMatch(/^Bed 2 short, \d+%$/);
    expect(line).toHaveClass("bad");
  });
});

describe("SystemsPanel — the open card", () => {
  it("shows its zones as chips in the order they were claimed, and no status line while it is fine", () => {
    const made = fiveHeadMulti(fittedHouse().doc);
    mount(made.doc, made.systemId);
    const el = card("System 1");
    expect(el).toHaveClass("open");
    expect(within(el).getByRole("button", { name: "System 1" })).toHaveAttribute("aria-expanded", "true");
    expect([...el.querySelectorAll(".ds-zn")].map((c) => c.textContent)).toEqual([
      "Bed 1",
      "Bed 2",
      "Master",
      "Study",
      "Living",
    ]);
    expect(el.querySelector(".ds-zp-status")).toBeNull();
  });

  it("Add zones ends the chips and puts the plan in claim mode for this system", () => {
    const made = fiveHeadMulti(fittedHouse().doc);
    const { onAddZones } = mount(made.doc, made.systemId);
    const add = within(card("System 1")).getByRole("button", { name: "Add zones" });
    expect(add.closest(".ds-zp-zones")).not.toBeNull();
    fireEvent.click(add);
    expect(onAddZones).toHaveBeenCalledWith(made.systemId);
  });

  it("Edit system sits under the figures once a unit is in, and opens the builder", () => {
    const made = fiveHeadMulti(fittedHouse().doc);
    const { onBuild } = mount(made.doc, made.systemId);
    const edit = within(card("System 1")).getByRole("button", { name: "Edit system" });
    /* not on the name line: that line is the name and its type word, so a
       long system name has the width (Isaac, 2026-09-20) */
    expect(edit.closest(".ds-zp-top")).toBeNull();
    expect(edit.closest(".ds-zp-acts")).not.toBeNull();
    fireEvent.click(edit);
    expect(onBuild).toHaveBeenCalledWith(made.systemId);
  });

  it("reads the outdoor, the cover, the connection ratio and the combination off the engine", () => {
    const made = fiveHeadMulti(fittedHouse().doc);
    mount(made.doc, made.systemId);
    const el = card("System 1");
    const facts = new Map(
      [...el.querySelectorAll("dt")].map((dt) => [dt.textContent, dt.nextElementSibling as HTMLElement])
    );
    expect(facts.get("Outdoor")!.textContent).toBe("MXZ-5F100VGD");
    // the one figure: the same calculation the design sheet reads
    const cover = systemCover(made.doc, mePack, sysOf(made.doc, made.systemId), basis);
    expect(facts.get("Cover")!.textContent).toBe(
      `${cover.coverKw.toFixed(1)} of ${cover.loadKw!.toFixed(1)} kW`
    );
    expect(facts.get("Cover")!.textContent).toMatch(/^14\.2 of \d+\.\d kW$/);
    expect(facts.get("Connection ratio")!.textContent).toBe("142%");
    expect(facts.get("Combination")!.textContent).toBe("Valid");
    expect(facts.get("Combination")).toHaveClass("ok");
  });

  it("a new empty system offers Build system as its next step, and no Edit system", () => {
    const made = newSystem(house().doc, mePack.meta.version);
    const { onBuild } = mount(made.doc, made.systemId);
    const el = card("System 1");
    expect(within(el).queryByRole("button", { name: "Edit system" })).toBeNull();
    expect(el.querySelector(".ds-zp-facts")).toBeNull();
    const build = within(el).getByRole("button", { name: "Build system" });
    expect(build.closest(".ds-zp-next")).not.toBeNull();
    fireEvent.click(build);
    expect(onBuild).toHaveBeenCalledWith(made.systemId);
  });
});

describe("SystemsPanel — opening and resting", () => {
  it("clicking a resting card's name activates its system", () => {
    const { doc, one, two } = twoSystems();
    const { onActivate } = mount(doc, one);
    expect(card("System 2")).not.toHaveClass("open");
    fireEvent.click(within(card("System 2")).getByRole("button", { name: "System 2" }));
    expect(onActivate).toHaveBeenCalledWith(two);
  });

  it("clicking the open card's name rests it: the chips go and the status line comes back", () => {
    const { doc, one } = twoSystems();
    const { onActivate } = mount(doc, one);
    const el = card("System 1");
    expect(el.querySelectorAll(".ds-zn")).toHaveLength(2);
    const name = within(el).getByRole("button", { name: "System 1" });
    fireEvent.click(name);
    expect(el).not.toHaveClass("open");
    expect(el.querySelectorAll(".ds-zn")).toHaveLength(0);
    expect(statusOf(el).textContent).toBe("No units yet");
    expect(name).toHaveAttribute("aria-expanded", "false");
    // resting is the panel's own: the system stays the active one
    expect(onActivate).not.toHaveBeenCalled();
  });
});

describe("SystemsPanel — the rack", () => {
  it("lists every unit not yet on the plan, the outdoor as Outdoor, each one draggable", () => {
    const made = fiveHeadMulti(house().doc);
    mount(made.doc, made.systemId);
    const el = card("System 1");
    expect(within(el).getByText("Units to place")).toBeInTheDocument();
    const rows = rackRows(el);
    expect(rows).toHaveLength(6);
    for (const row of rows) expect(row).toHaveAttribute("draggable", "true");
    const heads = rows.filter((r) => r.classList.contains("idu")).map(modelOf).sort();
    expect(heads).toEqual(["MSZ-AP20VGD", "MSZ-AP20VGD", "MSZ-AP25VGD2", "MSZ-AP35VGD2", "MSZ-AP42VGD2"]);
    const odu = rows.find((r) => r.classList.contains("odu"))!;
    expect(modelOf(odu)).toBe("MXZ-5F100VGD");
    expect(odu.textContent).toContain("Outdoor");
    // a head's row names the zone it serves
    expect(rows.find((r) => modelOf(r) === "MSZ-AP35VGD2")!.textContent).toContain("Master");
  });

  it("dragging a unit off the rack arms it for the plan, and letting go disarms", () => {
    const made = fiveHeadMulti(house().doc);
    const { onArmPlace } = mount(made.doc, made.systemId);
    const el = card("System 1");
    const row = rackRows(el).find((r) => modelOf(r) === "MSZ-AP35VGD2")!;
    const head = allocationsOf(sysOf(made.doc, made.systemId)).find((a) => a.model === "MSZ-AP35VGD2")!;
    fireEvent.dragStart(row, { dataTransfer: transfer() });
    expect(onArmPlace).toHaveBeenCalledTimes(1);
    expect(onArmPlace.mock.calls[0][0]).toMatchObject({
      role: "idu",
      model: "MSZ-AP35VGD2",
      allocationId: head.id,
      systemId: made.systemId,
      roomId: "master",
    });
    fireEvent.dragEnd(row);
    expect(onArmPlace).toHaveBeenLastCalledWith(null);
    // the rack itself is unchanged: only a placing takes a unit off it
    expect(rackRows(el)).toHaveLength(6);
  });

  it("a unit placed on the plan leaves the rack and the rest close up", () => {
    const made = fiveHeadMulti(house().doc);
    const head = allocationsOf(sysOf(made.doc, made.systemId)).find((a) => a.model === "MSZ-AP35VGD2")!;
    const d = placeAllocation(made.doc, mePack, made.systemId, head.id, made.doc.floors[0].id, { x: 2400, y: 200 });
    mount(d, made.systemId);
    const rows = rackRows(card("System 1"));
    expect(rows).toHaveLength(5);
    expect(rows.map(modelOf)).not.toContain("MSZ-AP35VGD2");
  });

  it("when the last unit is down the rack is gone and the install questions are the next step", () => {
    const made = fiveHeadMulti(fittedHouse().doc);
    const { onInstall } = mount(placeAll(made.doc, made.systemId), made.systemId);
    const el = card("System 1");
    expect(el.querySelector(".ds-zp-rack")).toBeNull();
    expect(within(el).queryByText("Units to place")).toBeNull();
    const next = within(el).getByRole("button", { name: "Next: Install questions" });
    expect(next.closest(".ds-zp-next")).not.toBeNull();
    fireEvent.click(next);
    expect(onInstall).toHaveBeenCalledWith(made.systemId);
  });
});

describe("SystemsPanel — zone chips", () => {
  it("the cross clears the zone from its system", () => {
    const { doc, one } = twoSystems();
    const { onRemoveZone } = mount(doc, one);
    const cross = within(card("System 1")).getByRole("button", { name: /^Clear Master from System 1$/ });
    expect(cross.closest(".ds-zn")).toBe(chipOf(card("System 1"), "Master"));
    fireEvent.click(cross);
    expect(onRemoveZone).toHaveBeenCalledWith("master", one);
  });

  it("a chip's drag carries the zone and the system it is leaving", () => {
    const { doc, one } = twoSystems();
    mount(doc, one);
    const chip = chipOf(card("System 1"), "Master");
    expect(chip).toHaveAttribute("draggable", "true");
    const dt = transfer();
    fireEvent.dragStart(chip, { dataTransfer: dt });
    expect(dt.setData).toHaveBeenCalledTimes(1);
    const [type, json] = dt.setData.mock.calls[0] as [string, string];
    expect(type).toBe(ZONE_DRAG);
    expect(JSON.parse(json)).toEqual({ zoneId: "master", from: one });
    expect(dt.effectAllowed).toBe("move");
  });

  it("dropped on another card the zone moves with its units", () => {
    const { doc, one, two } = twoSystems();
    const { onMoveZone, onClaimZone, onRemoveZone } = mount(doc, one);
    fireEvent.drop(card("System 2"), { dataTransfer: transfer({ zoneId: "master", from: one }) });
    expect(onMoveZone).toHaveBeenCalledWith("master", one, two);
    expect(onClaimZone).not.toHaveBeenCalled();
    expect(onRemoveZone).not.toHaveBeenCalled();
  });

  it("dropped on its own card nothing happens", () => {
    const { doc, one } = twoSystems();
    const on = mount(doc, one);
    fireEvent.drop(card("System 1"), { dataTransfer: transfer({ zoneId: "master", from: one }) });
    expect(on.onMoveZone).not.toHaveBeenCalled();
    expect(on.onClaimZone).not.toHaveBeenCalled();
    expect(on.onRemoveZone).not.toHaveBeenCalled();
  });

  it("a zone without a system dragged onto a card joins it, the same as clicking it in Add zones", () => {
    const { doc, one, two } = twoSystems();
    const { onClaimZone, onMoveZone, container } = mount(doc, one);
    const row = [...container.querySelectorAll<HTMLElement>(".ds-zp-row")].find((r) =>
      r.textContent?.includes("Bed 2")
    )!;
    expect(row).toHaveAttribute("draggable", "true");
    const dt = transfer();
    fireEvent.dragStart(row, { dataTransfer: dt });
    const [type, json] = dt.setData.mock.calls[0] as [string, string];
    expect(type).toBe(ZONE_DRAG);
    expect(JSON.parse(json)).toEqual({ zoneId: "bed2", from: null });
    fireEvent.drop(card("System 2"), { dataTransfer: transfer({ zoneId: "bed2", from: null }) });
    expect(onClaimZone).toHaveBeenCalledWith("bed2", two);
    expect(onMoveZone).not.toHaveBeenCalled();
  });

  it("a chip dropped on Zones without a system is cleared, the same as its cross", () => {
    const { doc, one } = twoSystems();
    const { onRemoveZone, onMoveZone, onClaimZone, container } = mount(doc, one);
    fireEvent.drop(container.querySelector(".ds-zp-free")!, {
      dataTransfer: transfer({ zoneId: "master", from: one }),
    });
    expect(onRemoveZone).toHaveBeenCalledWith("master", one);
    expect(onMoveZone).not.toHaveBeenCalled();
    expect(onClaimZone).not.toHaveBeenCalled();
  });

  it("the target lights on dragenter and goes out on dragleave", () => {
    const { doc, one } = twoSystems();
    mount(doc, one);
    const target = card("System 2");
    const dt = transfer({ zoneId: "master", from: one });
    fireEvent.dragEnter(target, { dataTransfer: dt });
    expect(target).toHaveClass("drop");
    // and the drop is accepted while it is over: dragover is prevented, as a move
    expect(fireEvent.dragOver(target, { dataTransfer: dt })).toBe(false);
    expect(dt.dropEffect).toBe("move");
    fireEvent.dragLeave(target, { dataTransfer: dt });
    expect(target).not.toHaveClass("drop");
  });

  it("a drag that is not a zone lights nothing", () => {
    const { doc, one } = twoSystems();
    mount(doc, one);
    const target = card("System 2");
    fireEvent.dragEnter(target, { dataTransfer: transfer() });
    expect(target).not.toHaveClass("drop");
  });
});

describe("SystemsPanel — Zones without a system", () => {
  it("lists the unclaimed zones in plan order, each with its load", () => {
    const { doc, one } = twoSystems();
    const { container } = mount(doc, one);
    const rows = [...container.querySelectorAll(".ds-zp-row")];
    expect(rows.map((r) => r.querySelector(".ds-zp-row-name")!.textContent)).toEqual(["Living", "Bed 2"]);
    const kw = (id: string) =>
      `${roomLoadKw(doc, doc.objects.find((o) => o.id === id) as RoomObj)!.toFixed(1)} kW`;
    const shown = rows.map((r) => r.querySelector(".ds-zp-row-kw")!.textContent);
    expect(shown).toEqual([kw("living"), kw("bed2")]);
    expect(shown[0]).toMatch(/^\d+\.\d kW$/);
    expect(container.querySelector(".ds-zp-none")).toBeNull();
  });

  it("says None when every zone has a system", () => {
    const { doc } = claimed(house().doc, ["living", "bed1", "bed2", "master", "study"]);
    const { container } = mount(doc);
    expect(container.querySelector(".ds-zp-free")!.textContent).toBe("None");
    expect(container.querySelector(".ds-zp-row")).toBeNull();
  });
});

/* ═══════════════ SystemCockpit — the type-first flow, as it was ═══════════════ */

const pack = emptyPack({ brand: "me", version: "1", packSchemaVersion: 1, name: "t" });
const floor: Floor = { id: "flr", name: "G", level: 0, scaleMmPerUnit: 10, northDeg: null, northPos: null, plans: [] };

const system: DesignSystem = {
  id: "sys1",
  type: "split",
  brand: "me",
  colour: "#2E68FF",
  name: "System 1",
  settings: { pairIdu: "WALL-25", pairOdu: "OD-25" },
};

const placedIdu: DesignObject = {
  id: "u_idu",
  type: "unit",
  systemId: "sys1",
  floorId: "flr",
  geometry: { kind: "point", at: { x: 0, y: 0 } },
  plane: "room",
  props: { role: "idu", model: "WALL-25" },
};

function docWith(): DesignDocument {
  const d = createDesign({ name: "T", mode: "blank", now: "2026-07-11T00:00:00.000Z" });
  d.floors = [floor];
  d.systems = [system];
  d.objects = [placedIdu];
  return d;
}

function renderPanel(onMutate: (fn: (d: DesignDocument) => DesignDocument) => void = () => {}, onActivate = () => {}) {
  render(
    <SystemCockpit
      doc={docWith()}
      pack={pack}
      packVersion="1"
      activeSystemId="sys1"
      onActivate={onActivate}
      onMutate={onMutate}
      selectedId={null}
      onSelect={() => {}}
      onEditRoom={() => {}}
      rest={{ rested: false, onExpand: () => {}, onRest: () => {} }}
      floor={floor}
      onAddVariant={() => {}}
      onSwitchVariant={() => {}}
      onRenameVariant={() => {}}
    />
  );
}

describe("SystemCockpit — change type", () => {
  it("offers a Change button that opens the type chooser", () => {
    renderPanel();
    fireEvent.click(screen.getByTitle(/Change system type/));
    expect(screen.getByText("Change system type")).toBeInTheDocument();
  });

  it("re-picking the current type does NOT delete the placed units", () => {
    const onMutate = jest.fn();
    renderPanel(onMutate);
    fireEvent.click(screen.getByTitle(/Change system type/));
    // split is the current type (and the only available one) — a no-op change
    fireEvent.click(screen.getByRole("button", { name: /Split/ }));
    expect(onMutate).not.toHaveBeenCalled(); // nothing removed
  });

  it("cancelling the chooser does NOT delete anything", () => {
    const onMutate = jest.fn();
    renderPanel(onMutate);
    fireEvent.click(screen.getByTitle(/Change system type/));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onMutate).not.toHaveBeenCalled();
    // back on the system view
    expect(screen.getByTitle(/Change system type/)).toBeInTheDocument();
  });
});

describe("SystemCockpit — close a system", () => {
  it("the active tab's close asks to confirm, then deletes the system + its objects", () => {
    let next: DesignDocument | undefined;
    const cleared: (string | null)[] = [];
    render(
      <SystemCockpit
        doc={docWith()}
        pack={pack}
        packVersion="1"
        activeSystemId="sys1"
        onActivate={(id) => cleared.push(id)}
        onMutate={(fn) => (next = fn(docWith()))}
        selectedId={null}
        onSelect={() => {}}
        onEditRoom={() => {}}
      rest={{ rested: false, onExpand: () => {}, onRest: () => {} }}
        floor={floor}
        onAddVariant={() => {}}
        onSwitchVariant={() => {}}
        onRenameVariant={() => {}}
      />
    );
    // open the system dropdown, arm the delete x — nothing removed yet
    fireEvent.click(screen.getByRole("button", { name: "System 1" }));
    fireEvent.click(screen.getByRole("button", { name: /Delete System 1/ }));
    expect(next).toBeUndefined();
    // confirm the two-step "Delete?"
    fireEvent.click(screen.getByRole("button", { name: "Delete?" }));

    expect(next!.systems.map((s) => s.id)).not.toContain("sys1");
    expect(next!.objects.map((o) => o.id)).not.toContain("u_idu");
    expect(cleared).toContain(null); // active system cleared
  });

  it("deletes a system from its own card, without opening the builder", () => {
    const made = fiveHeadMulti(fittedHouse().doc);
    const { onDeleteSystem, onBuild } = mount(made.doc, made.systemId);
    const el = card("System 1");
    const del = within(el).getByRole("button", { name: "Delete System 1" });
    expect(del.textContent).toBe("Delete system");
    fireEvent.click(del);
    expect(onDeleteSystem).toHaveBeenCalledWith(made.systemId);
    expect(onBuild).not.toHaveBeenCalled();
  });

  it("offers it on the open card only — a card at rest is a name and a line", () => {
    const made = fiveHeadMulti(fittedHouse().doc);
    /* no system is active, so every card is at rest */
    mount(made.doc, null);
    expect(screen.queryByRole("button", { name: "Delete System 1" })).toBeNull();
  });
});