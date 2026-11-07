/* Edit system in one column: a screen beside the plan, on a draft. Done applies
   the draft as one change, Discard changes drops it, a new system can be built
   from nothing, and its words are fit.ts's. Against the real shipped pack, like
   system-builder.test.tsx. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { SystemPanel } from "../system-panel";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "@/lib/studio/packs/schema";
import { assemblePack, type PackSource } from "@/lib/studio/packs/loader";
import { createDesign, type DesignDocument, type DesignObject } from "@/lib/studio/document";
import { addHead, allocationsOf, roomVerdict } from "@/lib/studio/builder";
import { claimZone, newSystem } from "@/lib/studio/zones";
import { sizingCapacityKw } from "@/lib/studio/loads";
import { roomLoadKw, type RoomObj } from "@/lib/studio/loads-room";
import { coverPct, coversLoad, shortKw } from "@/lib/studio/fit";
import { multiCapableIdus } from "@/lib/studio/multi";

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

function house(extraRooms = 0): DesignDocument {
  const doc = createDesign({ name: "house", mode: "blank" });
  const floorId = doc.floors[0].id;
  const room = (id: string, name: string, x: number, y: number, w: number, h: number) =>
    doc.objects.push({
      id,
      type: "room",
      systemId: null,
      floorId,
      plane: "room",
      geometry: {
        kind: "polygon",
        points: [
          { x, y },
          { x: x + w, y },
          { x: x + w, y: y + h },
          { x, y: y + h },
        ],
      },
      props: { name },
    } as DesignObject);
  room("living", "Living", 0, 0, 1000, 960);
  room("bed1", "Bed 1", 1100, 0, 400, 300);
  room("bed2", "Bed 2", 1600, 0, 450, 400);
  for (let i = 0; i < extraRooms; i++) room(`extra${i}`, `Room ${i + 1}`, 2200 + i * 500, 0, 400, 300);
  return doc;
}

const basis = (d: DesignDocument) => d.settings.sizingBasis;
const roomOf = (d: DesignDocument, id: string) => d.objects.find((o) => o.id === id) as RoomObj;

/** a system holding these rooms and nothing else */
function claimed(doc: DesignDocument, rooms: string[]): { doc: DesignDocument; systemId: string } {
  const made = newSystem(doc, pack.meta.version);
  let d = made.doc;
  for (const z of rooms) d = claimZone(d, made.systemId, z);
  return { doc: d, systemId: made.systemId };
}

/** the same series' sizes of a multi-capable head, smallest first */
function seriesWithRange(): { small: string; big: string } {
  const kwOf = (m: string) => sizingCapacityKw(pack.indoor_units.find((u) => u.model === m)!, "worst-of-both");
  const bySeries = new Map<string, string[]>();
  for (const u of multiCapableIdus(pack)) {
    if (u.form_factor !== "wall") continue;
    bySeries.set(u.series, [...(bySeries.get(u.series) ?? []), u.model]);
  }
  for (const models of bySeries.values()) {
    const sorted = [...models].sort((a, b) => kwOf(a) - kwOf(b));
    if (sorted.length >= 3) return { small: sorted[0], big: sorted[sorted.length - 1] };
  }
  throw new Error("no wall series with a range in the pack");
}

const panel = (props: Partial<Parameters<typeof SystemPanel>[0]> & { doc: DesignDocument }) => {
  const onCommit = jest.fn();
  const onClose = jest.fn();
  const view = render(<SystemPanel pack={pack} onCommit={onCommit} onClose={onClose} {...props} />);
  return { onCommit, onClose, ...view };
};

const committed = (fn: jest.Mock): DesignDocument => fn.mock.calls[0][0] as DesignDocument;

beforeEach(() => window.localStorage.clear());

describe("SystemPanel", () => {
  it("renders in place, never in a portal over the plan", () => {
    const made = claimed(house(), ["bed1"]);
    const { container } = panel({ doc: made.doc, systemId: made.systemId });
    expect(container.querySelector(".ds-syp")).not.toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Done commits a changed draft as one change, and leaves the design it was given alone", () => {
    const made = claimed(house(), ["bed1"]);
    const doc = addHead(made.doc, pack, { systemId: made.systemId, zoneId: "bed1", iduModel: seriesWithRange().big });
    const before = allocationsOf(doc.systems.find((s) => s.id === made.systemId)!);
    const { onCommit, onClose } = panel({ doc, systemId: made.systemId });

    const head = before.find((a) => a.role === "idu")!;
    fireEvent.click(screen.getByRole("button", { name: `Remove ${head.model}` }));
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    const after = allocationsOf(committed(onCommit).systems.find((s) => s.id === made.systemId)!);
    expect(after.some((a) => a.id === head.id)).toBe(false);
    expect(allocationsOf(doc.systems.find((s) => s.id === made.systemId)!)).toEqual(before);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Done on an unchanged draft closes without a change", () => {
    const made = claimed(house(), ["bed1"]);
    const { onCommit, onClose } = panel({ doc: made.doc, systemId: made.systemId });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Discard changes drops the draft", () => {
    const made = claimed(house(), ["bed1"]);
    const doc = addHead(made.doc, pack, { systemId: made.systemId, zoneId: "bed1", iduModel: seriesWithRange().big });
    const head = allocationsOf(doc.systems.find((s) => s.id === made.systemId)!).find((a) => a.role === "idu")!;
    const { onCommit, onClose } = panel({ doc, systemId: made.systemId });
    fireEvent.click(screen.getByRole("button", { name: `Remove ${head.model}` }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("back leaves only with nothing to lose", () => {
    const made = claimed(house(), ["bed1"]);
    const { onClose } = panel({ doc: made.doc, systemId: made.systemId });
    fireEvent.click(screen.getByRole("radio", { name: "Multi" }));
    expect(screen.queryByRole("button", { name: "Systems" })).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("builds a new system from nothing: type, a room, a head on a pushed screen, the outdoor proposed", () => {
    const doc = house();
    const { onCommit } = panel({ doc });
    expect(screen.getByRole("heading", { name: /System 1/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "Multi" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a room" }));
    fireEvent.click(screen.getByRole("button", { name: /^Bed 1/ }));

    fireEvent.click(screen.getByRole("button", { name: "Add a head in Bed 1" }));
    /* the system's screen is still behind, and back names it */
    const pushed = screen.getByRole("region", { name: "Choose a head" });
    expect(within(pushed).getByRole("button", { name: "System 1" })).toBeTruthy();
    const { small } = seriesWithRange();
    fireEvent.change(within(pushed).getByRole("textbox", { name: "Search models" }), { target: { value: small } });
    fireEvent.click(within(pushed).getByRole("button", { name: new RegExp(`^${small}`) }));

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    const built = committed(onCommit);
    expect(built.systems).toHaveLength(1);
    const allocs = allocationsOf(built.systems[0]);
    expect(allocs.find((a) => a.role === "idu")).toMatchObject({ model: small, roomId: "bed1" });
    expect(allocs.some((a) => a.role === "odu" && a.model)).toBe(true);
  });

  it("a new system left empty is not committed, and offers no Delete", () => {
    const { onCommit, onClose } = panel({ doc: house() });
    expect(screen.queryByRole("button", { name: "Delete system" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Delete system takes the system off the design it was given", () => {
    const made = claimed(house(), ["bed1"]);
    const { onCommit, onClose } = panel({ doc: made.doc, systemId: made.systemId });
    fireEvent.click(screen.getByRole("button", { name: "Delete system" }));
    expect(committed(onCommit).systems.some((s) => s.id === made.systemId)).toBe(false);
    expect(onClose).toHaveBeenCalled();
  });

  it("says oversized as fit.ts does, offers the size that fits, and Use applies it", () => {
    const { big } = seriesWithRange();
    const made = claimed(house(), ["bed1"]);
    const doc = addHead(made.doc, pack, { systemId: made.systemId, zoneId: "bed1", iduModel: big });
    const verdict = roomVerdict(doc, pack, basis(doc), roomOf(doc, "bed1"));
    expect(verdict.word).toBe("Oversized");
    const { onCommit } = panel({ doc, systemId: made.systemId });

    const pct = coverPct(verdict.coverKw, verdict.loadKw!);
    expect(screen.getByText(`Oversized, ${pct}%`)).toBeTruthy();

    const use = screen.getByRole("button", { name: /^Use / });
    const offer = screen.getByText(/covers it at \d+%$/).textContent!;
    fireEvent.click(use);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    const built = committed(onCommit);
    const after = roomVerdict(built, pack, basis(built), roomOf(built, "bed1"));
    expect(after.word).toBe("Fits");
    expect(coversLoad(after.coverKw, after.loadKw!)).toBe(true);
    /* the percent it offered is the percent it gave */
    expect(offer).toContain(`at ${coverPct(after.coverKw, after.loadKw!)}%`);
  });

  it("says covered and short by the one test, with the figures fit.ts measures", () => {
    const { small, big } = seriesWithRange();
    const made = claimed(house(), ["living", "bed2"]);
    let doc = addHead(made.doc, pack, { systemId: made.systemId, zoneId: "living", iduModel: small });
    doc = addHead(doc, pack, { systemId: made.systemId, zoneId: "bed2", iduModel: big });
    const load = roomLoadKw(doc, roomOf(doc, "living"))!;
    const short = roomVerdict(doc, pack, basis(doc), roomOf(doc, "living"));
    expect(coversLoad(short.coverKw, load)).toBe(false);
    panel({ doc, systemId: made.systemId });
    expect(screen.getByText(`${shortKw(load, short.coverKw).toFixed(1)} kW short`)).toBeTruthy();
  });

  it("says covered with the figure that covers it", () => {
    /* the smallest size in the series that lands inside the cap on Bed 1 */
    const { small } = seriesWithRange();
    const series = pack.indoor_units.find((u) => u.model === small)!.series;
    const made = claimed(house(), ["bed1"]);
    const sizes = multiCapableIdus(pack).filter((u) => u.series === series);
    let doc: DesignDocument | null = null;
    for (const u of sizes) {
      const d = addHead(made.doc, pack, { systemId: made.systemId, zoneId: "bed1", iduModel: u.model });
      if (roomVerdict(d, pack, basis(d), roomOf(d, "bed1")).word === "Fits") {
        doc = d;
        break;
      }
    }
    expect(doc).not.toBeNull();
    const verdict = roomVerdict(doc!, pack, basis(doc!), roomOf(doc!, "bed1"));
    panel({ doc: doc!, systemId: made.systemId });
    expect(screen.getByText(`Covered, ${verdict.coverKw.toFixed(1)} kW`)).toBeTruthy();
  });

  it("folds a covered room to one line past four rooms, and opens it again", () => {
    const { small } = seriesWithRange();
    const series = pack.indoor_units.find((u) => u.model === small)!.series;
    const made = claimed(house(4), ["bed1", "extra0", "extra1", "extra2", "extra3"]);
    let doc = made.doc;
    const fitting = multiCapableIdus(pack)
      .filter((u) => u.series === series)
      .sort((a, b) => a.capacity_cool_kw - b.capacity_cool_kw);
    for (const id of ["bed1", "extra0", "extra1", "extra2", "extra3"]) {
      const pick = fitting.find((u) => {
        const d = addHead(doc, pack, { systemId: made.systemId, zoneId: id, iduModel: u.model });
        return roomVerdict(d, pack, basis(d), roomOf(d, id)).word === "Fits";
      })!;
      doc = addHead(doc, pack, { systemId: made.systemId, zoneId: id, iduModel: pick.model });
    }
    panel({ doc, systemId: made.systemId });
    const line = screen.getByRole("button", { name: /^Bed 1, Covered/ });
    expect(screen.queryByRole("button", { name: "Add a head in Bed 1" })).toBeNull();
    fireEvent.click(line);
    expect(screen.getByRole("button", { name: "Add a head in Bed 1" })).toBeTruthy();
  });

  it("opens on the outdoors for a Swap from an outdoor on the plan", () => {
    const { big } = seriesWithRange();
    const made = claimed(house(), ["living", "bed1"]);
    let doc = addHead(made.doc, pack, { systemId: made.systemId, zoneId: "living", iduModel: big });
    doc = addHead(doc, pack, { systemId: made.systemId, zoneId: "bed1", iduModel: big });
    const odu = allocationsOf(doc.systems.find((s) => s.id === made.systemId)!).find((a) => a.role === "odu")!;
    panel({ doc, systemId: made.systemId, focus: { systemId: made.systemId, allocationId: odu.id } });
    const pushed = screen.getByRole("region", { name: "Outdoor" });
    expect(within(pushed).getByText(odu.model)).toBeTruthy();
    expect(within(pushed).queryByRole("button", { name: "Use the proposal" })).toBeNull();
  });

  it("an outdoor picked by hand stays picked until it is handed back to the proposal", () => {
    const { big } = seriesWithRange();
    const made = claimed(house(), ["living", "bed1"]);
    let doc = addHead(made.doc, pack, { systemId: made.systemId, zoneId: "living", iduModel: big });
    doc = addHead(doc, pack, { systemId: made.systemId, zoneId: "bed1", iduModel: big });
    const odu = allocationsOf(doc.systems.find((s) => s.id === made.systemId)!).find((a) => a.role === "odu")!;
    const { onCommit } = panel({ doc, systemId: made.systemId, focus: { systemId: made.systemId, allocationId: odu.id } });

    const list = screen.getByRole("region", { name: "Outdoor" });
    const other = within(list)
      .getAllByRole("button")
      .find((b) => /Valid/.test(b.textContent ?? ""))!;
    const model = other.querySelector(".ds-stack-row-t")!.textContent!;
    fireEvent.click(other);
    expect(screen.getByText("Picked")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${model}`) }));
    fireEvent.click(screen.getByRole("button", { name: "Use the proposal" }));
    expect(screen.getByText("Proposed")).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp(`^${odu.model}`) })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("builds a VRF from nothing: its own heads, its outdoor, and the book's top on the connection", () => {
    const { onCommit } = panel({ doc: house() });
    fireEvent.click(screen.getByRole("radio", { name: "VRF" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a room" }));
    fireEvent.click(screen.getByRole("button", { name: /^Bed 2/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add a room" }));
    fireEvent.click(screen.getByRole("button", { name: /^Bed 1/ }));

    for (const room of ["Bed 2", "Bed 1"]) {
      fireEvent.click(screen.getByRole("button", { name: `Add a head in ${room}` }));
      const pushed = screen.getByRole("region", { name: "Choose a head" });
      const first = within(pushed)
        .getAllByRole("button")
        .find((b) => b.querySelector(".ds-stack-row-v") && !/short/.test(b.textContent ?? ""))!;
      fireEvent.click(first);
    }

    expect(screen.getByText(/of the outdoor, up to \d+% allowed$/)).toBeTruthy();
    expect(screen.getByText(/^One shared line/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    const built = committed(onCommit);
    expect(built.systems[0].type).toBe("vrf");
    expect(allocationsOf(built.systems[0]).filter((a) => a.role === "idu")).toHaveLength(2);
    expect(allocationsOf(built.systems[0]).some((a) => a.role === "odu" && a.model)).toBe(true);
  });

  it("builds a ducted system from nothing: one unit on the whole system, its rooms fed by air", () => {
    const { onCommit } = panel({ doc: house() });
    fireEvent.click(screen.getByRole("radio", { name: "Ducted" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a room" }));
    fireEvent.click(screen.getByRole("button", { name: /^Living/ }));
    expect(screen.queryByRole("button", { name: "Add a head in Living" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Choose a unit" }));
    const pushed = screen.getByRole("region", { name: "Choose a unit" });
    const fits = within(pushed)
      .getAllByRole("button")
      .find((b) => /^\d+%$/.test(b.querySelector(".ds-stack-row-v")?.textContent ?? ""))!;
    fireEvent.click(fits);

    expect(screen.queryByRole("button", { name: "Choose a unit" })).toBeNull();
    expect(screen.getByRole("radiogroup", { name: "Zoning" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    const built = committed(onCommit);
    expect(built.systems[0].type).toBe("ducted");
    expect(allocationsOf(built.systems[0]).find((a) => a.role === "idu")?.serves).toBe("system");
  });

  it("zoning writes through the engine: On/off gives a zone a room and a controller", () => {
    const made = claimed(house(), ["living", "bed1"]);
    const unit = pack.indoor_units.find((u) => u.form_factor === "ducted" && pack.pair_tables.some((p) => p.idu_model === u.model))!;
    const doc = addHead(
      { ...made.doc, systems: made.doc.systems.map((s) => ({ ...s, settings: { ...s.settings, family: "ducted" } })) },
      pack,
      { systemId: made.systemId, zoneId: "living", iduModel: unit.model }
    );
    const { onCommit } = panel({ doc, systemId: made.systemId });
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Zoning" })).getByRole("radio", { name: "On/off" }));
    expect(screen.getByRole("button", { name: /^Open Z1 / })).toBeTruthy();
    expect(screen.getByText("Controller")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    const sys = committed(onCommit).systems.find((s) => s.id === made.systemId)!;
    const head = allocationsOf(sys).find((a) => a.role === "idu")!;
    expect((sys.settings.zoning as Record<string, { control: string }>)[head.id].control).toBe("on_off");
  });

  it("heads of one room each share one zoning tray, and it sets them all", () => {
    const made = claimed(house(), ["bed1", "bed2"]);
    const bulkhead = pack.indoor_units.find(
      (u) => u.form_factor === "bulkhead" && u.airflow_ls != null && multiCapableIdus(pack).some((m) => m.model === u.model)
    )!;
    let doc = addHead(made.doc, pack, { systemId: made.systemId, zoneId: "bed1", iduModel: bulkhead.model });
    doc = addHead(doc, pack, { systemId: made.systemId, zoneId: "bed2", iduModel: bulkhead.model });
    const { onCommit } = panel({ doc, systemId: made.systemId });
    const trays = screen.getAllByRole("radiogroup", { name: /^Zoning/ });
    expect(trays).toHaveLength(1);
    fireEvent.click(within(trays[0]).getByRole("radio", { name: "Temperature" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    const sys = committed(onCommit).systems.find((s) => s.id === made.systemId)!;
    const zoning = sys.settings.zoning as Record<string, { control: string }>;
    for (const a of allocationsOf(sys).filter((x) => x.role === "idu")) expect(zoning[a.id].control).toBe("temperature");
  });

  it("renames on the title", () => {
    const made = claimed(house(), ["bed1"]);
    const { onCommit } = panel({ doc: made.doc, systemId: made.systemId });
    fireEvent.click(screen.getByRole("button", { name: /^Rename / }));
    const input = screen.getByRole("textbox", { name: "System name" });
    fireEvent.change(input, { target: { value: "Upstairs" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(committed(onCommit).systems.find((s) => s.id === made.systemId)?.name).toBe("Upstairs");
  });
});
