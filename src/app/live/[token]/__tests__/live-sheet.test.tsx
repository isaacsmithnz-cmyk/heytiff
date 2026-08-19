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
import {
  buildDesignSnapshot,
  buildSummaryModel,
  designBasis,
} from "@/lib/studio/summary";
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
};

function renderSheet(
  over: { doc?: DesignDocument; brand?: OrgBrand; simOffered?: boolean } = {}
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
      snapshot={buildDesignSnapshot(doc)}
      basis={designBasis(doc)}
      preparedOn="17 August 2026"
      expiresOn="16 September"
      simOffered={over.simOffered ?? false}
    />
  );
}

describe("the document", () => {
  it("opens on the business that sent it, and who it is for", () => {
    renderSheet();
    expect(screen.getByText("Design summary")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("18 Kembla Street");
    expect(screen.getByText("Prepared by")).toBeInTheDocument();
    /* the business is named in the DOCUMENT, not only in the bar: anything
       that lives only in the chrome vanishes from the PDF */
    expect(screen.getByText("Diamond Air", { selector: ".dsd-org" })).toBeInTheDocument();
    expect(screen.getByText("ABN 51 824 753 556 · 02 4225 1188")).toBeInTheDocument();
    expect(screen.getByText("17 August 2026")).toBeInTheDocument();
    expect(screen.getByText("Halloran Bros Construction")).toBeInTheDocument();
    expect(screen.getByText("Wollongong")).toBeInTheDocument();
    expect(screen.getByText("2214")).toBeInTheDocument();
  });

  it("falls back to the platform when the business has told us nothing", () => {
    renderSheet({ brand: NO_BRAND });
    expect(
      screen.getByText("HeyTiff Design Studio", { selector: ".dsd-org" })
    ).toBeInTheDocument();
  });

  it("states the six figures — three measured, three assumed", () => {
    renderSheet();
    for (const label of [
      "Calculated heat load",
      "Design cooling capacity",
      "Number of systems",
      "Climate zone",
      "Building type",
      "Sized on",
    ])
      expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText("Zone 5")).toBeInTheDocument();
    expect(screen.getByText("Residential")).toBeInTheDocument();
    /* the basis label reads "Sized on worst of both"; the column already says
       "Sized on", so only the basis is printed — CAPITALISED, because a
       lower-case value in a row of capitalised ones reads as a typo */
    expect(screen.getByText("Worst of both")).toBeInTheDocument();
  });

  it("NAMES THE BRAND, not the slug — the trimmed pack has to carry it", () => {
    renderSheet();
    expect(screen.queryByText("mitsubishi-electric")).not.toBeInTheDocument();
  });

  it("gives every room its unit, its style and its outdoor", () => {
    renderSheet();
    const table = screen.getByRole("table");
    for (const h of [
      "Room",
      "Floor",
      "Area",
      "Load",
      "Capacity",
      "Unit model",
      "Style",
      "Outdoor",
      "Coverage",
    ])
      expect(within(table).getByRole("columnheader", { name: h })).toBeInTheDocument();
    expect(within(table).getByText("Living")).toBeInTheDocument();
    expect(within(table).getByText(IDU)).toBeInTheDocument();
    // form factor off the pack, per room
    expect(within(table).getByText("Wall-mounted")).toBeInTheDocument();
  });

  it("ON A SPLIT the outdoor is named in the row, and the band carries none", () => {
    renderSheet();
    // one outdoor for one head: the column names the model
    expect(within(screen.getByRole("table")).getByText(ODU)).toBeInTheDocument();
    expect(screen.queryByText("Shared outdoor unit")).not.toBeInTheDocument();
    expect(screen.queryByText("Shared")).not.toBeInTheDocument();
  });

  it("says so plainly when there is nothing designed", () => {
    const d = createDesign({ name: "Empty", mode: "blank", now: "2026-08-17T00:00:00.000Z" });
    renderSheet({ doc: d });
    expect(screen.getByText("Nothing has been designed yet.")).toBeInTheDocument();
  });

  it("closes on who made it", () => {
    renderSheet();
    expect(screen.getByText(/Prepared with/)).toBeInTheDocument();
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
    expect(screen.queryByText("Prepared by")).not.toBeInTheDocument();
    // …and the way back is on it
    await user.click(screen.getByRole("button", { name: /Back to the design/ }));
    expect(screen.getByText("Prepared by")).toBeInTheDocument();
  });
});
