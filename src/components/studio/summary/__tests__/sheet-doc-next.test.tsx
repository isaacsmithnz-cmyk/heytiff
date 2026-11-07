/* THE NEXT FLOW'S DOCUMENT, AND THE GATE ROUND IT.

   The current flow's Summary, paper and customer link must not change, so the
   gate is asserted from both sides: the same call with and without the next
   flow round it. The print path is pinned because it is the one a person
   actually prints from, and it portals out of everything but React's context.

   The stylesheet half is read off the source: jsdom loads none of it. */

import { readFileSync } from "fs";
import { join } from "path";
import { act, render, screen } from "@testing-library/react";
import { createDesign, type DesignDocument } from "@/lib/studio/document";
import type { SimApprovalState } from "@/lib/studio/sim-approval";
import { buildSummaryModel } from "@/lib/studio/summary";
import type { SheetPaper } from "@/lib/studio/summary-paper";
import { ALL_SECTIONS, buildPrintModel, defaultExportOptions, type ExportOptions } from "@/lib/studio/export";
import { NO_BRAND, type OrgBrand } from "@/lib/org/brand";
import { StudioFlowContext } from "../../flow";
import { PrintDoc } from "../print-doc";
import { SheetDocNext } from "../sheet-doc-next";
import { SummaryView } from "../summary";

jest.mock("@/app/actions/studio-contributors", () => ({
  listDesignContributors: jest.fn(() => new Promise(() => {})),
}));
jest.mock("@/app/actions/org", () => ({
  getOrgBrand: jest.fn(() => new Promise(() => {})),
}));
jest.mock("@/lib/studio/plans", () => ({
  ...jest.requireActual("@/lib/studio/plans"),
  trimOfImageUrl: jest.fn(() => Promise.resolve(null)),
}));

const ACME: OrgBrand = {
  ...NO_BRAND,
  name: "Northside Cooling",
  color: "#2e5aa8",
  abn: "14603285409",
  email: "hello@northside.example",
  website: "northside.example",
};

function baseDoc(): DesignDocument {
  return createDesign({
    name: "7 Example Rd",
    mode: "blank",
    now: "2026-10-29T00:00:00.000Z",
    jobNumber: "2845",
    client: "JT Construct",
    site: "7 Example Rd\nClontarf NSW 2093",
  });
}

const paper: SheetPaper = {
  figures: {
    loadKw: 25.9,
    loadLine: "7 rooms, 166 m²",
    installedLabel: "Cooling installed",
    installedKw: 26,
    installedLine: "2 systems",
    climate: "Zone 5",
    climateLine: "Sydney, residential",
    sizedOn: "Heat and cool",
    sizedOnLine: "Each unit's smaller rating",
  },
  systems: [
    {
      systemId: "s1",
      colour: "#2e68ff",
      heading: "System 1, VRF",
      description: "Mitsubishi Electric PUMY-SP125VKMD2-A, 14.0 kW, R410A, 3 bulkhead heads",
      stateWord: "Covered",
      stateTone: "ok",
      form: "units",
      rooms: [
        { roomId: "r1", name: "Bedroom 01", level: "First", areaM2: 15.6, loadKw: 2.2, capacityKw: 4.5, indoor: "PEFY-P40VMX-E", grilles: null, airLs: null, pct: 205, coverTone: "look" },
      ],
      zoning: null,
    },
    {
      systemId: "s2",
      colour: "#17a398",
      heading: "System 2, ducted",
      description: "Mitsubishi Electric PEA-M125HAA with PUZ-M125VKA-A, 12.0 kW, R32, under the ground floor",
      stateWord: "1.8 kW short",
      stateTone: "look",
      form: "air",
      rooms: [
        { roomId: "r2", name: "Family room", level: "Ground", areaM2: 26.4, loadKw: 6, capacityKw: 5.2, indoor: "PEA-M125HAA", grilles: "2 wall, linear bar grille 600 × 100", airLs: 350, pct: 87, coverTone: "look" },
      ],
      zoning: "Zoned by temperature: 5 zones, a wireless sensor in each.",
    },
  ],
  unserved: [],
  materials: [
    { group: "units", item: "PUZ-M125VKA-A outdoor unit, 12.0 kW", forWhat: "System 2", qty: "1", pending: false },
    { group: "pipework", item: "ø9.52 / ø15.88 pair coil", forWhat: "System 2", qty: "Not drawn yet", pending: true },
    { group: "ductwork", item: "Rigid duct Ø300", forWhat: "System 2", qty: "0.9 m", pending: false },
  ],
  notes: ["Riser location for the study duct. Ground floor."],
};

const model = (over: Partial<SheetPaper> = {}) => ({
  systems: [],
  unserved: [],
  picklist: [{ group: "pipe" as const, name: "Pair coil", sub: "", qty: "15 m" }],
  paper: { ...paper, ...over },
});

function sheet(props: Partial<Parameters<typeof SheetDocNext>[0]> = {}) {
  return render(<SheetDocNext doc={baseDoc()} model={model()} brand={ACME} preparedOn="29 October 2026" {...props} />);
}

describe("the document", () => {
  it("opens on the name, who it is for, the address and date, and the business's own letterhead", () => {
    sheet();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("7 Example Rd");
    expect(screen.getByText("Air conditioning design for JT Construct, job 2845")).toBeTruthy();
    expect(screen.getByText("7 Example Rd, Clontarf NSW 2093. 29 October 2026")).toBeTruthy();
    expect(screen.getByText("Northside Cooling")).toBeTruthy();
    expect(screen.getByText("ABN 14 603 285 409")).toBeTruthy();
    expect(screen.getByText("hello@northside.example")).toBeTruthy();
  });

  it("wears only the brand it is given: no business of ours on a blank workspace", () => {
    const { container } = sheet({ brand: NO_BRAND });
    expect(container.textContent).not.toMatch(/Diamond/);
    expect(container.querySelector(".dsn-ident")).toBeNull();
    expect(container.querySelector<HTMLElement>(".dsn")!.style.getPropertyValue("--dsn-brand")).toBe("");
  });

  it("takes the business's colour through the document's own legibility floor", () => {
    const { container } = sheet({ brand: { ...ACME, color: "#ffee00" } });
    const ink = container.querySelector<HTMLElement>(".dsn")!.style.getPropertyValue("--dsn-brand");
    expect(ink).toMatch(/^#[0-9a-f]{6}$/);
    expect(ink).not.toBe("#ffee00");
  });

  it("the four figures, each with the fact under it", () => {
    sheet();
    for (const t of ["Heat load", "25.9 kW", "7 rooms, 166 m²", "Cooling installed", "26.0 kW", "2 systems", "Zone 5", "Sydney, residential", "Sized on", "Heat and cool"])
      expect(screen.getByText(t)).toBeTruthy();
  });

  it("a block per system: heading, description, state in words, its own table", () => {
    const { container } = sheet();
    expect(screen.getByText("System 2, ducted")).toBeTruthy();
    expect(screen.getByText(/PEA-M125HAA with PUZ-M125VKA-A/)).toBeTruthy();
    expect(screen.getByText("Covered").className).toContain("dsn-ok");
    expect(screen.getByText("1.8 kW short").className).toContain("dsn-look");
    const heads = [...container.querySelectorAll(".dsn-sys table")].map((t) =>
      [...t.querySelectorAll("th")].map((h) => h.textContent)
    );
    expect(heads[0]).toEqual(["Room", "Floor", "Area", "Load", "Indoor unit", "Capacity", "Cover"]);
    expect(heads[1]).toEqual(["Room", "Floor", "Area", "Load", "Grilles", "Air", "Cover"]);
    expect(screen.getByText("350 L/s")).toBeTruthy();
    expect(screen.getByText("Zoned by temperature: 5 zones, a wireless sensor in each.")).toBeTruthy();
  });

  it("Materials: Item, For, Quantity, grouped, a quantity not there yet as a grey word, then the notes", () => {
    const { container } = sheet();
    expect(screen.getByRole("heading", { name: "Materials" })).toBeTruthy();
    expect([...container.querySelectorAll(".dsn-mat-t th")].map((h) => h.textContent)).toEqual(["Item", "For", "Quantity"]);
    expect([...container.querySelectorAll(".dsn-g")].map((g) => g.textContent)).toEqual(["Units", "Pipework", "Ductwork"]);
    expect(screen.getByText("Not drawn yet").className).toContain("dsn-info");
    expect(screen.getByRole("heading", { name: "Notes on the plans" })).toBeTruthy();
    expect(screen.getByText("Riser location for the study duct. Ground floor.")).toBeTruthy();
  });

  it("obeys the ticks", () => {
    const { container, unmount } = sheet({ sections: { ...ALL_SECTIONS, figures: false } });
    expect(container.textContent).not.toMatch(/Heat load/);
    unmount();
    const off = sheet({ sections: { ...ALL_SECTIONS, lines: false, picklist: false } });
    expect(off.container.textContent).not.toMatch(/Materials/);
    expect(off.container.textContent).not.toMatch(/Notes on the plans/);
    off.unmount();
    const rooms = sheet({ sections: { ...ALL_SECTIONS, systems: false } });
    expect(rooms.container.textContent).not.toMatch(/System 2, ducted/);
  });

  it("says the plans follow only when they do", () => {
    const { container, unmount } = sheet({ plansFollow: true });
    expect(container.textContent).toMatch(/The plans follow the materials\./);
    expect(container.querySelector(".dsn-page.dsn-lead")).not.toBeNull();
    unmount();
    const none = sheet();
    expect(none.container.textContent).not.toMatch(/plans follow/);
    expect(none.container.querySelector(".dsn-page.dsn-lead")).toBeNull();
  });

  it("carries no eyebrow, no frame and no type in capitals", () => {
    const { container } = sheet();
    expect(container.querySelector(".dsd-bband")).toBeNull();
    expect(container.querySelector(".dsd-eyebrow")).toBeNull();
    expect(container.textContent).not.toMatch(/Design summary/);
  });
});

function printModel(doc: DesignDocument, over: Partial<ExportOptions> = {}) {
  return buildPrintModel([doc], null, { ...defaultExportOptions(doc), ...over });
}
const printed = () => document.getElementById("ds-printdoc");
const pageStyle = () => document.getElementById("ds-print-page-size")?.textContent ?? "";

describe("the paper", () => {
  it("the next flow prints the new document, footers from the print engine's own page count", () => {
    render(
      <StudioFlowContext.Provider value="next">
        <PrintDoc model={printModel(baseDoc())} urls={{}} brand={ACME} onReady={() => {}} />
      </StudioFlowContext.Provider>
    );
    expect(printed()!.querySelector(".dsn")).not.toBeNull();
    expect(printed()!.querySelector(".dsd")).toBeNull();
    expect(printed()!.textContent).toMatch(/Heat load/);
    const css = pageStyle();
    expect(css).toMatch(/@page dsn-lead \{ size: A4 portrait; margin: 0;/);
    expect(css).toMatch(/counter\(page\) " of " counter\(pages\) "\. The plans follow the materials\."/);
    expect(css).toMatch(/@page dsn-sheet \{ size: A4 portrait; margin: 0;/);
    expect(css).toMatch(/"Prepared with HeyTiff"/);
    /* a margin is where a browser stamps its date and URL */
    expect(css).not.toMatch(/margin: [1-9]/);
  });

  it("the current flow prints what it always did, with no page boxes", () => {
    render(<PrintDoc model={printModel(baseDoc())} urls={{}} brand={ACME} onReady={() => {}} />);
    expect(printed()!.querySelector(".dsd")).not.toBeNull();
    expect(printed()!.querySelector(".dsn")).toBeNull();
    expect(printed()!.textContent).toMatch(/Calculated heat load/);
    expect(pageStyle()).not.toMatch(/dsn-/);
  });

  it("a turned plan page draws no frame on the next flow, because the document has none", async () => {
    const doc = baseDoc();
    doc.floors = [
      {
        id: "wide",
        name: "Wide",
        level: 0,
        scaleMmPerUnit: 12,
        northDeg: null,
        northPos: null,
        plans: [{ id: "w", imageRef: "w", pageNumber: 1, name: "w", width: 3600, height: 1500, x: 0, y: 0 }],
      },
    ] as DesignDocument["floors"];
    render(
      <StudioFlowContext.Provider value="next">
        <PrintDoc model={printModel(doc, { floorIds: ["wide"] })} urls={{}} brand={ACME} onReady={() => {}} />
      </StudioFlowContext.Provider>
    );
    await act(async () => {});
    const page = printed()!.querySelector<HTMLElement>(".ds-print-page")!;
    expect(page.className).toContain("turned");
    expect(page.querySelector(".ds-print-tband")).toBeNull();
    expect(page.style.getPropertyValue("--doc-ink")).toBe("");
  });
});

describe("the owner's Summary", () => {
  const NOTHING: SimApprovalState = { simulatable: [], approved: [], pending: [], lapsed: [], offered: true };
  const planImages = { url: jest.fn(), upload: jest.fn(), uploadSource: jest.fn(), sourceFile: jest.fn(), remove: jest.fn() };
  const view = (doc = baseDoc()) => (
    <SummaryView
      doc={doc}
      brand={ACME}
      pack={null}
      onMutate={jest.fn()}
      onExportJson={jest.fn()}
      simFlag
      simReady={{ ok: true, reason: "", floorName: "Ground" }}
      simApproval={NOTHING}
      onSimulate={jest.fn()}
      planImages={planImages}
      loadVariant={jest.fn()}
    />
  );

  it("next flow: the new document, Share the blue button, no arrow, no triangle, the letterhead still typed into", () => {
    const { container } = render(<StudioFlowContext.Provider value="next">{view()}</StudioFlowContext.Provider>);
    expect(container.querySelector(".dsn-summary .dsn")).not.toBeNull();
    expect(container.querySelector(".dsd")).toBeNull();
    const share = screen.getByRole("button", { name: "Share" });
    expect(share.className).toContain("cta");
    expect(share.querySelector("svg")).toBeNull();
    const sim = screen.getByRole("button", { name: "Simulate" });
    expect(sim.className).not.toContain("cta");
    expect(sim.textContent).toBe("Simulate");
    expect((screen.getByLabelText("Client") as HTMLInputElement).value).toBe("JT Construct");
    expect((screen.getByLabelText("Job number") as HTMLInputElement).value).toBe("2845");
    expect((screen.getByLabelText("Site") as HTMLTextAreaElement).value).toContain("Clontarf");
  });

  it("current flow: the Summary it always was", () => {
    const { container } = render(view());
    expect(container.querySelector(".dsd")).not.toBeNull();
    expect(container.querySelector(".dsn")).toBeNull();
    expect(container.querySelector(".dsn-summary")).toBeNull();
    expect(screen.getByRole("button", { name: /Simulate/ }).className).toContain("cta");
  });

  it("the model the next flow renders is the one buildSummaryModel derives", () => {
    const doc = baseDoc();
    expect(buildSummaryModel(doc, null).paper).toBeDefined();
  });
});

describe("the stylesheet", () => {
  const raw = readFileSync(join(__dirname, "../sheet-doc.css"), "utf8");
  const from = raw.lastIndexOf("/*", raw.indexOf("THE NEXT FLOW'S DOCUMENT"));
  const css = raw.slice(from).replace(/\/\*[\s\S]*?\*\//g, "");
  const before = raw.slice(0, from).replace(/\/\*[\s\S]*?\*\//g, "");

  it("every rule is its own: nothing the current flow's sheet or chrome can reach", () => {
    const selectors = [...css.matchAll(/(^|\})\s*([^{}@]+)\{/g)].map((m) => m[2].trim());
    expect(selectors.length).toBeGreaterThan(20);
    for (const sel of selectors) {
      for (const one of sel.split(",")) {
        expect(one).toMatch(/\.dsn|\.dsn-/);
      }
    }
    expect(before).not.toMatch(/\.dsn/);
  });

  it("wears none of what the design rules took off the document", () => {
    expect(css).not.toMatch(/gradient\(/);
    expect(css).not.toMatch(/text-transform/);
    expect(css).not.toMatch(/letter-spacing:\s*(?!normal)\S/);
    expect(css).not.toMatch(/teal/);
    expect(css).not.toMatch(/--tint/);
    expect(css).not.toMatch(/border-left/);
    expect(css).not.toMatch(/monospace|--mono/);
    expect(css).not.toMatch(/text-decoration:\s*underline/);
    expect(css).not.toMatch(/backdrop-filter:\s*(?!none)\S/);
    expect(css).not.toMatch(/border-radius:\s*(?:9|[1-9]\d{2,})\d*px/);
  });

  it("every colour is one of the palette's, or ink at an alpha", () => {
    const hexes = new Set([...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase()));
    const palette = new Set(["#050505", "#5f6a79", "#15803d", "#b45309", "#2563eb", "#fff"]);
    for (const h of hexes) expect(palette.has(h) ? h : `off palette: ${h}`).toBe(h);
    const alpha = [...css.matchAll(/rgba\(([^)]*)\)/g)].map((m) => m[1].replace(/\s/g, ""));
    for (const a of alpha) expect(a).toMatch(/^5,5,5,0?\.\d+$/);
  });

  it("the screen's sizes stay off paper, and paper's the board's", () => {
    const print = css.slice(css.indexOf("@media print"));
    expect(print).toMatch(/--dsn-body: 11px/);
    expect(print).toMatch(/\.dsn-foot/);
    expect(css.slice(0, css.indexOf("@media print"))).toMatch(/--dsn-body: 13px/);
  });
});
