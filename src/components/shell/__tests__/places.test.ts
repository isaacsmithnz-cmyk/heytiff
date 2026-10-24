import fs from "fs";
import path from "path";
import { PLACES, STILL_TO_MOVE, YOURS, placeOn, placesFor } from "../places";
import { ICON_PATHS } from "../icon";
import type { Capability } from "@/lib/permissions";

const viewer = (caps: string[], role: "owner" | "admin" | "staff" | null = "staff") => ({
  caps: new Set(caps as Capability[]),
  role,
});

describe("the sidebar's places (rules 5 and 7)", () => {
  it("draws only places whose page exists, in the rule's order", () => {
    const order = ["home", "conversations", "jobs", "schedule", "documents", "library", "design", "team"];
    const keys = PLACES.map((p) => p.key);
    expect(keys.every((k) => order.includes(k))).toBe(true);
    expect([...keys].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(keys);
  });

  /* an address's page, looking through route groups like `(me)` */
  function pageExists(dir: string, segs: string[]): boolean {
    if (segs.length === 0) return fs.existsSync(path.join(dir, "page.tsx"));
    if (!fs.existsSync(dir)) return false;
    const [head, ...rest] = segs;
    if (pageExists(path.join(dir, head), rest)) return true;
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .some((e) => e.isDirectory() && /^\(.+\)$/.test(e.name) && pageExists(path.join(dir, e.name), segs));
  }

  it("points every row at a page that exists", () => {
    for (const p of [...PLACES, ...STILL_TO_MOVE, ...YOURS]) {
      const ok = pageExists(path.join(process.cwd(), "src/app"), p.href.split("/").filter(Boolean));
      expect(`${p.href} ${ok}`).toBe(`${p.href} true`);
    }
  });

  it("has a glyph for every row", () => {
    for (const p of [...PLACES, ...STILL_TO_MOVE, ...YOURS]) expect(ICON_PATHS[p.icon]).toBeTruthy();
  });

  it("offers a place only to someone who holds its capability, Home and Team to everyone", () => {
    // Home and Team are everyone's (everyone has Team, Isaac, 20 October 2026)
    expect(placesFor(PLACES, viewer([])).map((p) => p.key)).toEqual(["home", "team"]);
    expect(placesFor(PLACES, viewer(["workboard", "team"])).map((p) => p.key)).toEqual(["home", "jobs", "schedule", "documents", "team"]);
    expect(placesFor(PLACES, viewer(["tiff"])).map((p) => p.key)).toEqual(["home", "conversations", "library", "team"]);
  });

  it("keeps Settings to admins and Reports to whoever sees the money", () => {
    const keys = (caps: string[], role: "owner" | "admin" | "staff") => placesFor(YOURS, viewer(caps, role)).map((p) => p.key);
    expect(keys([], "staff")).toEqual(["card", "timesheet", "leave", "expenses"]);
    expect(keys(["workboard_money"], "admin")).toEqual(["card", "timesheet", "leave", "expenses", "reports", "settings"]);
  });

  it("lights Home only on its own address and the pages moving into it", () => {
    const home = PLACES.find((p) => p.key === "home")!;
    expect(placeOn(home, "/dashboard")).toBe(true);
    expect(placeOn(home, "/dashboard/notices")).toBe(true);
    // To do's whole list, and the old desk until its faces move
    expect(placeOn(home, "/dashboard/todo")).toBe(true);
    expect(placeOn(home, "/dashboard/desk")).toBe(true);
    expect(placeOn(home, "/dashboard/team")).toBe(false);
  });

  it("lights a place on every page under it, and not on a name that only starts the same", () => {
    const team = PLACES.find((p) => p.key === "team")!;
    expect(placeOn(team, "/dashboard/team/abc")).toBe(true);
    expect(placeOn(team, "/dashboard/teams")).toBe(false);
  });

  /* a job is a page now (step 5), and Jobs says you're in it */
  it("lights Jobs on the list, a job's own page, and the board's pages it took in", () => {
    const jobs = PLACES.find((p) => p.key === "jobs")!;
    expect(placeOn(jobs, "/dashboard/jobs")).toBe(true);
    expect(placeOn(jobs, "/dashboard/jobs/a3539c01")).toBe(true);
    expect(placeOn(jobs, "/dashboard/workboard")).toBe(true);
    expect(placeOn(jobs, "/dashboard/jobs/projects/p1")).toBe(true);
    expect(placeOn(jobs, "/dashboard/jobsite")).toBe(false);
    expect(STILL_TO_MOVE).toEqual([]);
  });

  /* Documents is a page now (v2, step 5), after Schedule, behind the Workboard's gate */
  it("puts Documents after Schedule, for whoever holds the Workboard", () => {
    const keys = PLACES.map((p) => p.key);
    expect(keys.indexOf("documents")).toBe(keys.indexOf("schedule") + 1);
    const docs = PLACES.find((p) => p.key === "documents")!;
    expect(docs).toMatchObject({ label: "Documents", icon: "file", href: "/dashboard/documents", capability: "workboard" });
    expect(placesFor(PLACES, viewer(["tiff"])).some((p) => p.key === "documents")).toBe(false);
  });

  it("lights Documents on its list, a SWMS's sign-on and a letter", () => {
    const docs = PLACES.find((p) => p.key === "documents")!;
    expect(placeOn(docs, "/dashboard/documents")).toBe(true);
    expect(placeOn(docs, "/dashboard/swms/v-1")).toBe(true);
    expect(placeOn(docs, "/dashboard/admin/letters/l-1")).toBe(true);
    expect(placeOn(docs, "/dashboard/admin/templates")).toBe(false);
    expect(placeOn(docs, "/dashboard/documentsx")).toBe(false);
  });

  /* a vehicle is a page now (v2), and Assets, where its register is, says you're in it */
  it("lights Team on the old Time & Pay and Assets addresses and on a vehicle's own page", () => {
    const team = PLACES.find((p) => p.key === "team")!;
    expect(placeOn(team, "/dashboard/timepay")).toBe(true);
    expect(placeOn(team, "/dashboard/assets")).toBe(true);
    expect(placeOn(team, "/dashboard/vehicles/v1")).toBe(true);
    expect(placeOn(team, "/dashboard/vehiclesx")).toBe(false);
    expect(STILL_TO_MOVE.some((p) => p.key === "assets" || p.key === "timepay")).toBe(false);
  });

  /* the Library lands on its documents (v2), and asking it is still the Library's */
  it("takes the Library to its documents, and lights it on the ask page too", () => {
    const library = PLACES.find((p) => p.key === "library")!;
    expect(library.href).toBe("/dashboard/tiff/library");
    expect(placeOn(library, "/dashboard/tiff/library")).toBe(true);
    expect(placeOn(library, "/dashboard/tiff")).toBe(true);
    expect(placeOn(library, "/dashboard/tiffany")).toBe(false);
    // the field tools are the Library's shelf now
    expect(placeOn(library, "/dashboard/toolbox")).toBe(true);
    expect(placeOn(library, "/dashboard/toolbox/heat-load")).toBe(true);
  });
});
