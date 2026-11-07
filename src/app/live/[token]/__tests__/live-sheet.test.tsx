/* WHAT THE CUSTOMER OPENS.

   Two things are under test and they pull in opposite directions:

   1. The sheet is the SAME document the owner reads — every figure comes off
      buildSummaryModel, so this suite renders the real derivation over a real
      pack rather than hand-written props. A number that disagrees with the
      owner's copy is the failure this whole change exists to prevent.
   2. The owner's chrome must be ABSENT, not hidden. Verified by querying the
      rendered output for the things that must never leave the business —
      the same "by grep, not by eye" the issue asked for. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createDesign, type DesignDocument, type DesignObject } from "@/lib/studio/document";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "@/lib/studio/packs/schema";
import { assemblePack, type PackSource } from "@/lib/studio/packs/loader";
import { trimPackForLive } from "@/lib/studio/packs/live-trim";
import { buildSummaryModel } from "@/lib/studio/summary";
import { NO_BRAND, type OrgBrand } from "@/lib/org/brand";
import { LiveSheet } from "../live-sheet";

const SEED_DIR = join(__dirname, "../../../../../data/packs/mitsubishi-electric@2026.1");
function loadPack(): DataPack {
  const meta = JSON.parse(readFileSync(join(SEED_DIR, "meta.json"), "utf8")) as PackMeta;
  const sections: PackSource["sections"] = {};
  for (const s of PACK_SECTIONS) {
    const f = join(SEED_DIR, `${s}.json`);
    if (existsSync(f)) sections[s] = JSON.parse(readFileSync(f, "utf8"));
  }
  return assemblePack({ meta, sections });
}
const fullPack = loadPack();

const IDU = "MSZ-LN50VG3V";
const ODU = "MUZ-LN50VG3";

const rect = (x: number, y: number, w: number, h: number) => ({
  kind: "polygon" as const,
  points: [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ],
});

function designDoc(): DesignDocument {
  const d = createDesign({
    name: "18 Kembla Street",
    mode: "blank",
    now: "2026-08-17T00:00:00.000Z",
    jobNumber: "2214",
    client: "Halloran Bros Construction",
    site: "18 Kembla Street\nWollongong\nNSW 2500",
  });
  d.settings.climateZone = "5";
  d.floors = [
    { id: "flr", name: "Ground", level: 0, scaleMmPerUnit: 10, northDeg: null, northPos: null, plans: [] },
  ];
  d.systems = [
    { id: "sys1", type: "split", brand: "mitsubishi-electric", colour: "#2E68FF", name: "System 1", settings: {} },
  ];
  d.objects = [
    {
      id: "room1",
      type: "room",
      systemId: "sys1",
      floorId: "flr",
      geometry: rect(0, 0, 500, 400),
      plane: "room",
      props: { name: "Living", hasExternalWalls: true },
    },
    {
      id: "idu1",
      type: "unit",
      systemId: "sys1",
      floorId: "flr",
      geometry: { kind: "point", at: { x: 20, y: 200 } },
      plane: "room",
      props: { role: "idu", model: IDU, roomId: "room1" },
    },
    {
      id: "odu1",
      type: "unit",
      systemId: "sys1",
      floorId: "flr",
      geometry: { kind: "point", at: { x: 900, y: 100 } },
      plane: "external-ground",
      props: { role: "odu", model: ODU },
    },
  ] as DesignObject[];
  return d;
}

const BRAND: OrgBrand = {
  name: "Diamond Air",
  logoUrl: null,
  abn: "51824753556",
  phone: "02 4225 1188",
  email: null,
  website: null,
  color: null,
};

function renderSheet(
  over: {
    doc?: DesignDocument;
    brand?: OrgBrand;
    simOffered?: boolean;
    sections?: { figures: boolean; systems: boolean; lines: boolean };
    plans?: boolean;
  } = {}
) {
  const doc = over.doc ?? designDoc();
  /* the TRIMMED pack, exactly as the route serves it — a sheet built against
     the full catalogue would not prove what the customer actually sees */
  const pack = trimPackForLive(fullPack, doc);
  return render(
    <LiveSheet
      doc={doc}
      pack={pack}
      planUrls={{}}
      brand={over.brand ?? BRAND}
      model={buildSummaryModel(doc, pack)}
      preparedOn="17 August 2026"
      expiresOn="16 September"
      simOffered={over.simOffered ?? false}
      sections={over.sections}
      planFloors={over.plans ? doc.floors : []}
    />
  );
}

/* THE NEXT FLOW'S DOCUMENT (Isaac, 7 November 2026: "everyone"): the link
   draws what the Studio's Summary and its PDF draw, SheetDocNext. What that
   document says is sheet-doc-next.test.tsx's to hold; here, that it is the
   one the customer gets, with the customer's own facts on it. */
describe("the document", () => {
  it("is the next flow's document, not the old sheet", () => {
    renderSheet();
    expect(document.querySelector("article.dsn")).not.toBeNull();
    expect(document.querySelector(".dsd-mast")).toBeNull();
    expect(screen.queryByText("Design summary")).not.toBeInTheDocument();
  });

  it("opens on the job, who it is for, where and when, and the business that sent it", () => {
    renderSheet();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("18 Kembla Street");
    expect(
      screen.getByText("Air conditioning design for Halloran Bros Construction, job 2214")
    ).toBeInTheDocument();
    expect(screen.getByText("18 Kembla Street, Wollongong, NSW 2500. 17 August 2026")).toBeInTheDocument();
    /* the business is named in the DOCUMENT, not only in the bar: anything
       that lives only in the chrome vanishes from the paper */
    const ident = document.querySelector(".dsn-ident");
    expect(ident).not.toBeNull();
    expect(within(ident as HTMLElement).getByText("Diamond Air")).toBeInTheDocument();
    expect(within(ident as HTMLElement).getByText("ABN 51 824 753 556")).toBeInTheDocument();
    expect(within(ident as HTMLElement).getByText("02 4225 1188")).toBeInTheDocument();
  });

  it("carries the business in the document and not in the bar", () => {
    renderSheet();
    expect(document.querySelector(".dsd-bar img")).toBeNull();
    expect(document.querySelector(".dsd-bar")?.textContent).not.toMatch(/Diamond Air/);
  });

  it("wears no letterhead for a business that has told us nothing, and none of ours", () => {
    renderSheet({ brand: NO_BRAND });
    expect(document.querySelector(".dsn-ident")).toBeNull();
    expect(screen.queryByText("HeyTiff Design Studio")).not.toBeInTheDocument();
  });

  it("states the figures", () => {
    renderSheet();
    for (const label of ["Heat load", "Cooling installed", "Climate", "Sized on"])
      expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("NAMES THE BRAND, not the slug — the trimmed pack has to carry it", () => {
    renderSheet();
    expect(screen.queryByText(/mitsubishi-electric/)).not.toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Mitsubishi Electric ${IDU} with ${ODU}`))).toBeInTheDocument();
  });

  it("gives every room its unit, its load and its cover", () => {
    renderSheet();
    const block = document.querySelector(".dsn-sys") as HTMLElement;
    const table = within(block).getByRole("table");
    for (const h of ["Room", "Floor", "Area", "Load", "Indoor unit", "Capacity", "Cover"])
      expect(within(table).getByRole("columnheader", { name: h })).toBeInTheDocument();
    expect(within(table).getByText("Living")).toBeInTheDocument();
    expect(within(table).getByText(new RegExp(IDU))).toBeInTheDocument();
  });

  it("says so plainly when there is nothing designed", () => {
    const d = createDesign({ name: "Empty", mode: "blank", now: "2026-08-17T00:00:00.000Z" });
    renderSheet({ doc: d });
    expect(screen.getByText("Nothing has been designed yet.")).toBeInTheDocument();
  });

  it("closes on who made it", () => {
    renderSheet();
    expect(screen.getAllByText(/Prepared with HeyTiff/).length).toBeGreaterThan(0);
  });
});

describe("the customer's chrome", () => {
  it("says the link is live and when it stops working", () => {
    renderSheet();
    expect(screen.getByText("Live design")).toBeInTheDocument();
    expect(screen.getByText("Link expires 16 September")).toBeInTheDocument();
  });

  it("offers ONE print control, because there is only one thing it can do", () => {
    /* "Print" and "Download PDF" would be the same call — there is no
       server-side PDF — and two controls doing one thing is a promise about
       the second one */
    renderSheet();
    expect(screen.getByRole("button", { name: "Print" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Download/ })).not.toBeInTheDocument();
  });

  it("NOTHING OWNER-ONLY REACHES IT — verified by query, not by eye", () => {
    const { container } = renderSheet();
    const text = container.textContent ?? "";
    /* the checks pill names what is WRONG with the design before anyone has
       decided how to present it */
    expect(text).not.toMatch(/to check before you send this/);
    expect(text).not.toMatch(/Nothing flagged/);
    // acting on a design this reader does not own
    for (const name of ["Share", "Export", "Add to job", "Unlink", "Simulate"])
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    // a warehouse list and staff names, both internal
    expect(text).not.toMatch(/Material picklist/);
    expect(text).not.toMatch(/Contributors/);
    // and provenance the customer has no use for
    expect(text).not.toMatch(/ServiceM8/);
    /* THE LETTERHEAD IS TEXT HERE, NOT FIELDS. The owner types into the same
       frame; the customer's copy passes no fields, so there is nothing to
       type into rather than something disabled. */
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(container.querySelectorAll("input, textarea")).toHaveLength(0);
  });
});

describe("the simulation is an option, not the destination", () => {
  it("is ABSENT until the design is ticked as ready to share", () => {
    renderSheet({ simOffered: false });
    expect(
      screen.queryByRole("button", { name: /Open the simulation/ })
    ).not.toBeInTheDocument();
  });

  it("opens from the sheet, and comes back to it", async () => {
    const user = userEvent.setup();
    renderSheet({ simOffered: true });
    await user.click(screen.getByRole("button", { name: /Open the simulation/ }));
    // the simulation replaces the sheet…
    expect(screen.getByRole("main", { name: "Live design" })).toBeInTheDocument();
    expect(document.querySelector("article.dsn")).toBeNull();
    // …and the way back is on it
    await user.click(screen.getByRole("button", { name: /Back to the design/ }));
    expect(document.querySelector("article.dsn")).not.toBeNull();
  });
});

/* WHAT THE OWNER TICKED when they made the link (lib/studio/send.ts) is what
   the customer gets — the page and the Send dialog's PDF agree because both
   are SheetDocNext. */
describe("the link shows what was ticked", () => {
  it("leaves out a part the owner unticked", () => {
    renderSheet({ sections: { figures: false, systems: true, lines: true } });
    expect(screen.queryByText("Heat load")).not.toBeInTheDocument();
    expect(within(document.querySelector(".dsn-sys") as HTMLElement).getByText("Living")).toBeInTheDocument();
  });

  it("carries the plans down the page when they are ticked, and not otherwise", () => {
    const without = renderSheet();
    expect(without.container.querySelector(".dsd-plan")).toBeNull();
    without.unmount();

    const { container } = renderSheet({ plans: true });
    expect(container.querySelectorAll(".dsd-plan")).toHaveLength(1);
  });
});
