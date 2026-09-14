/* The library on the start screen: the lineup it prints, and what it calls
   new. The manifest is handed in the way the route hands it — already
   built — so these are about the card, not the packs (library.test.ts is). */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Studio } from "../studio";
import { LocalDesignStore } from "@/lib/studio/store";
import { librarySnapshot, type LibraryManifest, type LibrarySeries } from "@/lib/studio/packs/library";

const SNAPSHOT_KEY = "heytiff.studio.library";

const idu = (series: string, form: "wall" | "ducted" | "cassette-4way", models: string[]): LibrarySeries => ({
  series,
  side: "indoor",
  form: { wall: "Wall-mounted", ducted: "Ducted", "cassette-4way": "4-way cassette" }[form],
  formFactor: form,
  models,
});
const odu = (series: string, models: string[]): LibrarySeries => ({
  series,
  side: "outdoor",
  form: null,
  formFactor: null,
  models,
});

function manifest(version = "2026.1", ap: string[] = ["MSZ-AP25VGD", "MSZ-AP35VGD"]): LibraryManifest {
  const split = [idu("MSZ-AP", "wall", ap), idu("MSZ-EF", "wall", ["MSZ-EF25VGK"]), idu("PEAD-M-JAA", "ducted", ["PEAD-M50JAA"])];
  const vrf = [idu("PLFY-P-VEM-A", "cassette-4way", ["PLFY-P20VEM-A"])];
  return {
    brands: [
      {
        id: "mitsubishi-electric",
        name: "Mitsubishi Electric",
        version,
        systems: [
          { system: "split", label: "Split systems", series: [...split, odu("MUZ-AP", ["MUZ-AP25VG", "MUZ-AP35VG"])] },
          /* the multi's indoor units are the split and VRF ranges again */
          { system: "multi", label: "Multi-split", series: [split[0], split[1], vrf[0], odu("MXZ-F", ["MXZ-2F52VGD"])] },
          { system: "vrf", label: "VRF", series: [...vrf, odu("PUHY-P-YNW-A1", ["PUHY-P200YNW-A1"])] },
        ],
      },
    ],
  };
}

const studio = (library?: LibraryManifest) => (
  <Studio store={new LocalDesignStore(window.localStorage)} library={library} />
);

describe("the library card", () => {
  beforeEach(() => window.localStorage.clear());

  it("is not there without a library, and there with one", async () => {
    const { unmount } = render(studio());
    expect(await screen.findByText("New design")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Library" })).not.toBeInTheDocument();
    unmount();

    render(studio(manifest()));
    const card = await screen.findByRole("region", { name: "Library" });
    expect(within(card).getByRole("heading", { name: "Mitsubishi Electric 2026.1" })).toBeInTheDocument();
  });

  it("prints the lineup a brochure would: system, then series by form — no counts, no model codes", async () => {
    render(studio(manifest()));
    const card = await screen.findByRole("region", { name: "Library" });
    expect(within(card).getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual([
      "Split systems",
      "Multi-split",
      "VRF",
    ]);

    /* split: indoor by form, in the schema's form order; the outdoor comes
       with the pair and is not printed */
    const split = within(card).getByRole("heading", { name: "Split systems" }).parentElement!;
    const terms = (el: HTMLElement) => within(el).getAllByRole("term").map((t) => t.textContent);
    const defs = (el: HTMLElement) => within(el).getAllByRole("definition").map((d) => d.textContent);
    expect(terms(split)).toEqual(["Wall-mounted", "Ducted"]);
    expect(defs(split)).toEqual(["MSZ-AP, MSZ-EF", "PEAD-M-JAA"]);
    expect(within(split).queryByText(/MUZ-AP/)).not.toBeInTheDocument();

    /* multi and VRF are their outdoor unit first; the multi's indoor units
       are the ranges already printed, said as a phrase, not printed again */
    const multi = within(card).getByRole("heading", { name: "Multi-split" }).parentElement!;
    expect(terms(multi)).toEqual(["Outdoor", "Indoor"]);
    expect(defs(multi)).toEqual(["MXZ-F", "The split and VRF indoor ranges"]);
    const vrf = within(card).getByRole("heading", { name: "VRF" }).parentElement!;
    expect(terms(vrf)).toEqual(["Outdoor", "4-way cassette"]);
    expect(defs(vrf)).toEqual(["PUHY-P-YNW-A1", "PLFY-P-VEM-A"]);

    /* and none of the detail that belongs to the unit browser */
    expect(within(card).queryByText(/MSZ-AP25VGD/)).not.toBeInTheDocument();
    expect(within(card).queryByText(/series$/)).not.toBeInTheDocument();
    expect(within(card).queryByText(/models?$/)).not.toBeInTheDocument();
    expect(within(card).queryByRole("button")).not.toBeInTheDocument();
  });

  it("says nothing on a first visit, and records what it saw", async () => {
    render(studio(manifest()));
    await screen.findByRole("region", { name: "Library" });
    expect(screen.queryByText("Library updated")).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(SNAPSHOT_KEY)!)).toEqual(librarySnapshot(manifest()));
  });

  it("says what arrived since this browser last looked, in the lineup's words, and Dismiss catches the snapshot up", async () => {
    const user = userEvent.setup();
    /* last time: version 2026.1, two AP sizes, no MSZ-GS */
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(librarySnapshot(manifest())));
    /* now: a new version, a third AP size, and a whole new wall series */
    const now = manifest("2026.2", ["MSZ-AP25VGD", "MSZ-AP35VGD", "MSZ-AP50VGD"]);
    now.brands[0].systems[0].series.splice(2, 0, idu("MSZ-GS", "wall", ["MSZ-GS25VF", "MSZ-GS35VF"]));
    render(studio(now));
    const card = await screen.findByRole("region", { name: "Library" });

    const notice = within(card).getByRole("status");
    expect(notice).toHaveTextContent("Library updated");
    expect(notice).toHaveTextContent("Mitsubishi Electric is now on 2026.2.");
    expect(notice).toHaveTextContent("MSZ-AP wall-mounted, 1 new size");
    expect(notice).toHaveTextContent("MSZ-GS wall-mounted, new series");
    /* never model codes */
    expect(notice).not.toHaveTextContent("MSZ-AP50VGD");
    /* the snapshot is NOT overwritten by looking — only by dismissing */
    expect(JSON.parse(window.localStorage.getItem(SNAPSHOT_KEY)!).brands["mitsubishi-electric"].version).toBe("2026.1");

    /* the lineup marks the series that arrived whole, and only that one */
    const split = within(card).getByRole("heading", { name: "Split systems" }).parentElement!;
    const wall = within(split).getAllByRole("definition")[0];
    expect(wall).toHaveTextContent("MSZ-AP, MSZ-EF, MSZ-GS new");
    expect(wall.querySelectorAll(".ds-lib-new")).toHaveLength(1);
    expect(wall.querySelector(".ds-lib-new")).toHaveTextContent("MSZ-GS");

    await user.click(within(card).getByRole("button", { name: "Dismiss" }));
    expect(within(card).queryByRole("status")).not.toBeInTheDocument();
    expect(wall.querySelectorAll(".ds-lib-new")).toHaveLength(0);
    expect(JSON.parse(window.localStorage.getItem(SNAPSHOT_KEY)!)).toEqual(librarySnapshot(now));
  });

  it("says which models are no longer offered, and skips the version line when it did not change", async () => {
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(librarySnapshot(manifest())));
    render(studio(manifest("2026.1", ["MSZ-AP25VGD"])));
    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent("No longer offered: MSZ-AP35VGD.");
    expect(notice).not.toHaveTextContent("is now on");
  });

  it("says so when nothing is installed", async () => {
    render(studio({ brands: [] }));
    const card = await screen.findByRole("region", { name: "Library" });
    expect(within(card).getByText("No product data is installed yet.")).toBeInTheDocument();
  });
});
