/* THE NEXT FLOW'S POP-UP (Isaac, 7 November 2026: "Build" on the mock "Pop-up
   on the web, the iPad's way", then "Fix 8 breaks"). The left side and the
   schematic as they were; the list as the app's own rows, each ending on its
   fit word; the sheet, Compare and Swap in the right-hand column; one tray;
   Save system. Against the real shipped pack, like system-builder.test.tsx,
   whose tests keep the current flow's pop-up as it was. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { SystemBuilder } from "../system-builder";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "@/lib/studio/packs/schema";
import { assemblePack, type PackSource } from "@/lib/studio/packs/loader";
import { createDesign, type DesignDocument, type DesignObject } from "@/lib/studio/document";
import { addHead, allocationsOf } from "@/lib/studio/builder";
import { claimZone, newSystem } from "@/lib/studio/zones";

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

function house(livingName = "Living"): DesignDocument {
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
  room("living", livingName, 0, 0, 1000, 960);
  room("bed1", "Bed 1", 1100, 0, 400, 300);
  room("bed2", "Bed 2", 1600, 0, 450, 400);
  room("study", "Study", 1100, 500, 400, 320);
  return doc;
}
function claimed(doc: DesignDocument, zoneIds: string[]) {
  const made = newSystem(doc, pack.meta.version);
  let d = made.doc;
  for (const z of zoneIds) d = claimZone(d, made.systemId, z);
  return { doc: d, systemId: made.systemId };
}
/** a VRF of three heads: Bed 1 and Bed 2 on bulkheads, the living room on a ducted VMA */
function vrf(livingName?: string) {
  const made = claimed(house(livingName), ["bed1", "bed2", "living", "study"]);
  let d = addHead(made.doc, pack, { systemId: made.systemId, zoneId: "bed1", iduModel: "PEFY-P32VMS1-E" });
  d = addHead(d, pack, { systemId: made.systemId, zoneId: "bed2", iduModel: "PEFY-P25VMS1-E" });
  d = addHead(d, pack, { systemId: made.systemId, zoneId: "living", iduModel: "PEFY-P100VMA-E4" });
  return { doc: d, systemId: made.systemId };
}

const list = () => screen.getByRole("region", { name: "Choose a unit" });
const search = (words: string) =>
  fireEvent.change(within(list()).getByRole("textbox", { name: "Search units" }), { target: { value: words } });
/** a list row, by its model */
const row = (model: string) =>
  within(list())
    .getAllByRole("listitem")
    .find((li) => li.querySelector(".pt-row-name")?.textContent === model) as HTMLElement;
const pressRow = (model: string) => fireEvent.click(within(row(model)).getByRole("button", { name: model }));
const wordOf = (model: string) => row(model).querySelector(".pt-state__word")?.textContent ?? null;

beforeEach(() => window.localStorage.clear());

describe("the next flow's pop-up", () => {
  it("heads the system with its facts and one tray; no cross; Save system, and Discard changes only once there is one", () => {
    const t = vrf();
    render(<SystemBuilder next doc={t.doc} pack={pack} systemId={t.systemId} onCommit={() => {}} onClose={() => {}} />);
    expect(document.querySelector(".ds-sb.next")).not.toBeNull();
    expect(document.querySelector(".ds-sb-facts")!.textContent).toMatch(/^VRF, 4 zones, /);
    const tray = screen.getByRole("radiogroup", { name: "Units or schematic" });
    expect(within(tray).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Units", "Schematic"]);
    // the outdoor is reached from its own card, so the old Indoor | Outdoor switch is gone
    expect(screen.queryByRole("group", { name: "Indoor or outdoor" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close builder" })).toBeNull();
    expect(screen.getByRole("button", { name: "Save system" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Discard changes" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Put the next unit in Study" }));
    fireEvent.click(screen.getByRole("button", { name: /^Add to Study$/ }));
    expect(screen.getByRole("button", { name: "Discard changes" })).toBeInTheDocument();
  });

  it("leads the outdoor card with its model, what it is under it (law 10)", () => {
    const t = vrf();
    render(<SystemBuilder next doc={t.doc} pack={pack} systemId={t.systemId} onCommit={() => {}} onClose={() => {}} />);
    const card = document.querySelector(".ds-sb-out") as HTMLElement;
    const top = card.querySelector(".ds-sb-out-top") as HTMLElement;
    expect(top.querySelector(".ds-sb-out-model")).not.toBeNull();
    expect(card.querySelector(".ds-sb-out-label")).toBeNull();
    expect(card.querySelector(".ds-sb-out-kind")!.textContent).toBe("Outdoor");
  });

  it("titles the list with the aimed zone, every row says how it fits it, and Add lands there", () => {
    const made = claimed(house(), ["bed1", "study"]);
    const onCommit = jest.fn();
    render(<SystemBuilder next doc={made.doc} pack={pack} systemId={made.systemId} onCommit={onCommit} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Put the next unit in Study" }));
    expect(document.querySelector(".ds-sb-coltitle")!.textContent).toBe("Study");
    expect(document.querySelector(".ds-sb-colsub")!.textContent).toMatch(/^\d+\.\d kW load$/);

    search("MSZ-AP");
    const words = within(list())
      .getAllByRole("listitem")
      .map((li) => li.querySelector(".pt-state__word")?.textContent);
    expect(words.length).toBeGreaterThan(3);
    for (const w of words) expect(w).toMatch(/^(Best fit|Fits|Short|Oversized(, \d+%)?)$/);
    // no table, no Columns, no group counts
    expect(list().querySelector("table")).toBeNull();
    expect(screen.queryByRole("button", { name: /Columns/ })).toBeNull();

    pressRow("MSZ-AP20VGD");
    expect(row("MSZ-AP20VGD")).toHaveClass("pt-row--on");
    const sheet = screen.getByRole("complementary", { name: "Unit detail" });
    expect(within(sheet).getByRole("heading", { name: "MSZ-AP20VGD" })).toBeInTheDocument();
    // the sheet leaves out what the row says
    expect(within(sheet).queryByText("Width")).toBeNull();
    fireEvent.click(within(sheet).getByRole("button", { name: "Add to Study" }));
    fireEvent.click(screen.getByRole("button", { name: "Save system" }));
    const built = onCommit.mock.calls[0][0] as DesignDocument;
    const heads = built.systems.flatMap((s) => allocationsOf(s)).filter((a) => a.role === "idu");
    expect(heads.map((a) => a.roomId)).toEqual(["study"]);
  });

  it("sets Head type and Fits within as labelled fields, the sizes in a panel", () => {
    const made = claimed(house(), ["bed1"]);
    render(<SystemBuilder next doc={made.doc} pack={pack} systemId={made.systemId} onCommit={() => {}} onClose={() => {}} />);
    expect(screen.getByRole("combobox", { name: "Head type" })).toBeInTheDocument();
    const fits = screen.getByRole("button", { name: "Fits within" });
    expect(fits).toHaveTextContent("Any size");
    fireEvent.click(fits);
    const panel = screen.getByRole("dialog", { name: "Fits within" });
    fireEvent.change(within(panel).getByRole("textbox", { name: "W ≤" }), { target: { value: "800" } });
    expect(fits).toHaveTextContent("W ≤ 800");
  });

  it("stands two ticked models side by side in the right-hand column, no box over the dialog", () => {
    const made = claimed(house(), ["bed1", "study"]);
    render(<SystemBuilder next doc={made.doc} pack={pack} systemId={made.systemId} onCommit={() => {}} onClose={() => {}} />);
    search("MSZ-AP");
    fireEvent.click(screen.getByRole("checkbox", { name: "Compare models" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Compare MSZ-AP20VGD" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Compare MSZ-AP25VGD2" }));
    expect(screen.queryByRole("dialog", { name: "Compare units" })).toBeNull();
    const side = screen.getByRole("complementary", { name: "Unit detail" });
    expect(within(side).getByRole("heading", { name: "Compare" })).toBeInTheDocument();
    expect(within(side).getAllByRole("button", { name: "Add to Bed 1" })).toHaveLength(2);
    expect(within(side).getByText("Cooling")).toBeInTheDocument();
  });

  it("lists a placed unit's sizes as rows, Current on its own, and a picked size swaps it in place", () => {
    const made = claimed(house(), ["bed1"]);
    const doc = addHead(made.doc, pack, { systemId: made.systemId, zoneId: "bed1", iduModel: "MSZ-AP25VGD2" });
    const before = allocationsOf(doc.systems.find((s) => s.id === made.systemId)!).find((a) => a.role === "idu")!;
    const onCommit = jest.fn();
    render(<SystemBuilder next doc={doc} pack={pack} systemId={made.systemId} onCommit={onCommit} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "MSZ-AP25VGD2 in Bed 1" }));
    const open = screen.getByRole("complementary", { name: "Selected unit" });
    expect(within(open).getByRole("heading", { name: "MSZ-AP25VGD2" })).toBeInTheDocument();
    expect(within(open).queryByRole("button", { name: "Close unit detail" })).toBeNull();
    // only the open unit's line is filled on the left, no zone card as well
    expect(document.querySelector(".ds-sb-zone.aimed")).toBeNull();
    expect(wordOf("MSZ-AP25VGD2")).toBe("Current");
    expect(row("MSZ-AP25VGD2")).toHaveClass("pt-row--on");

    pressRow("MSZ-AP35VGD2");
    const sheet = screen.getByRole("complementary", { name: "Unit detail" });
    expect(within(sheet).getByText("In place of MSZ-AP25VGD2")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Swap to MSZ-AP35VGD2" }));
    fireEvent.click(screen.getByRole("button", { name: "Save system" }));
    const built = onCommit.mock.calls[0][0] as DesignDocument;
    const after = allocationsOf(built.systems.find((s) => s.id === made.systemId)!).filter((a) => a.role === "idu");
    expect(after.map((a) => [a.id, a.model])).toEqual([[before.id, "MSZ-AP35VGD2"]]);
  });

  it("opens every outdoor as rows from the outdoor card: the ones that work first, those that fail folded", () => {
    const t = vrf();
    render(<SystemBuilder next doc={t.doc} pack={pack} systemId={t.systemId} onCommit={() => {}} onClose={() => {}} />);
    fireEvent.click(document.querySelector(".ds-sb-out") as HTMLElement);
    expect(document.querySelector(".ds-sb-coltitle")!.textContent).toBe("Outdoor");
    const works = screen.getByRole("list", { name: "Outdoors" });
    const shown = within(works)
      .getAllByRole("listitem")
      .map((li) => li.querySelector(".pt-state__word")?.textContent);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown).not.toContain("Fails");
    const fold = screen.getByRole("button", { name: "Combination fails" });
    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("list", { name: "Outdoors that fail" })).toBeNull();
    fireEvent.click(fold);
    expect(screen.getByRole("list", { name: "Outdoors that fail" })).toBeInTheDocument();
  });

  it("fits the schematic's boxes to their words, and says where it comes from in a word", () => {
    const t = vrf("Kitchen / Dining / Living");
    render(<SystemBuilder next doc={t.doc} pack={pack} systemId={t.systemId} onCommit={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: "Schematic" }));
    const widths = [...document.querySelectorAll(".ds-schem-head rect")].map((r) => Number(r.getAttribute("width")));
    expect(widths.length).toBe(3);
    // "Kitchen / Dining / Living" at 7 a character, 8 a side
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(25 * 7 + 16);
    expect(document.querySelector(".ds-schem-src")!.textContent).toBe("Not drawn yet");
    // no card aimed while the schematic is up
    expect(document.querySelector(".ds-sb-zone.aimed")).toBeNull();
  });
});
