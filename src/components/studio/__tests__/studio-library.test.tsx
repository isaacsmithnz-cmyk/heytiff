/* The library's door on the start screen and the dialog behind it: what the
   door says, what the dialog prints, and what it calls new. The manifest is
   handed in the way the route hands it — already built — so these are about
   the screen, not the packs (library.test.ts is). */

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

function manifest(version = "2026.1", ap: string[] = ["MSZ-AP25VGD", "MSZ-AP35VGD"], updated: string | null = "2026-08-18"): LibraryManifest {
  const split = [idu("MSZ-AP", "wall", ap), idu("MSZ-EF", "wall", ["MSZ-EF25VGK"]), idu("PEAD-M-JAA", "ducted", ["PEAD-M50JAA"])];
  const vrf = [idu("PLFY-P-VEM-A", "cassette-4way", ["PLFY-P20VEM-A"])];
  return {
    brands: [
      {
        id: "mitsubishi-electric",
        name: "Mitsubishi Electric",
        version,
        updated,
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

const terms = (el: HTMLElement) => within(el).getAllByRole("term").map((t) => t.textContent);
const defs = (el: HTMLElement) => within(el).getAllByRole("definition").map((d) => d.textContent);

describe("the library's door", () => {
  beforeEach(() => window.localStorage.clear());

  it("is not there without a library; with one it says when the library was last updated", async () => {
    const { unmount } = render(studio());
    expect(await screen.findByText("New design")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Library/ })).not.toBeInTheDocument();
    unmount();

    render(studio(manifest()));
    const door = await screen.findByRole("button", { name: /^Library/ });
    expect(door).toHaveTextContent("Library");
    expect(door).toHaveTextContent("Updated 18 Aug 2026");
    expect(door).not.toHaveTextContent("New");
    /* and nothing of the lineup is on the page itself */
    expect(screen.queryByText("Split systems")).not.toBeInTheDocument();
    expect(screen.queryByText(/MSZ-AP/)).not.toBeInTheDocument();
  });

  it("says nothing of a date the pack does not give", async () => {
    render(studio(manifest("2026.1", undefined, null)));
    const door = await screen.findByRole("button", { name: /^Library/ });
    expect(door).toHaveTextContent(/^Library$/);
  });

  it("opens the lineup a brochure would print: brand, system, series by form — no counts, no codes", async () => {
    const user = userEvent.setup();
    render(studio(manifest()));
    await user.click(await screen.findByRole("button", { name: /^Library/ }));

    const dialog = screen.getByRole("dialog", { name: "Library" });
    expect(within(dialog).getByText("Mitsubishi Electric 2026.1")).toBeInTheDocument();
    expect(within(dialog).getByText("Updated 18 Aug 2026")).toBeInTheDocument();
    /* nothing new on a first look: no release notes, just the lineup */
    expect(within(dialog).queryByText("What’s new")).not.toBeInTheDocument();
    expect(within(dialog).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Split systems",
      "Multi-split",
      "VRF",
    ]);

    /* split: indoor by form, in the schema's form order; the outdoor comes
       with the pair and is not printed */
    const split = within(dialog).getByRole("heading", { name: "Split systems" }).parentElement!;
    expect(terms(split)).toEqual(["Wall-mounted", "Ducted"]);
    expect(defs(split)).toEqual(["MSZ-AP, MSZ-EF", "PEAD-M-JAA"]);
    expect(within(split).queryByText(/MUZ-AP/)).not.toBeInTheDocument();

    /* multi and VRF are their outdoor unit first; the multi's indoor units
       are the ranges already printed, said as a phrase, not printed again */
    const multi = within(dialog).getByRole("heading", { name: "Multi-split" }).parentElement!;
    expect(terms(multi)).toEqual(["Outdoor", "Indoor"]);
    expect(defs(multi)).toEqual(["MXZ-F", "The split and VRF indoor ranges"]);
    const vrf = within(dialog).getByRole("heading", { name: "VRF" }).parentElement!;
    expect(terms(vrf)).toEqual(["Outdoor", "4-way cassette"]);
    expect(defs(vrf)).toEqual(["PUHY-P-YNW-A1", "PLFY-P-VEM-A"]);

    /* and none of the detail that belongs to the unit browser */
    expect(within(dialog).queryByText(/MSZ-AP25VGD/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/\d+ (models?|series)/)).not.toBeInTheDocument();

    /* Escape shuts it */
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("records what it saw on a first visit, and says nothing", async () => {
    render(studio(manifest()));
    await screen.findByRole("button", { name: /^Library/ });
    expect(JSON.parse(window.localStorage.getItem(SNAPSHOT_KEY)!)).toEqual(librarySnapshot(manifest()));
  });

  it("badges the door New when something has arrived, opens on what's new, and reading it clears the badge", async () => {
    const user = userEvent.setup();
    /* last time: version 2026.1, two AP sizes, no MSZ-GS */
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(librarySnapshot(manifest())));
    /* now: a new version, a third AP size, and a whole new wall series */
    const now = manifest("2026.2", ["MSZ-AP25VGD", "MSZ-AP35VGD", "MSZ-AP50VGD"], "2026-09-15");
    now.brands[0].systems[0].series.splice(2, 0, idu("MSZ-GS", "wall", ["MSZ-GS25VF", "MSZ-GS35VF"]));
    render(studio(now));

    const door = await screen.findByRole("button", { name: /^Library/ });
    expect(door).toHaveTextContent("Updated 15 Sep 2026");
    expect(door).toHaveTextContent("New");
    /* the snapshot is NOT overwritten by arriving — only by reading */
    expect(JSON.parse(window.localStorage.getItem(SNAPSHOT_KEY)!).brands["mitsubishi-electric"].version).toBe("2026.1");

    await user.click(door);
    const dialog = screen.getByRole("dialog", { name: "Library" });
    const notes = within(dialog).getByRole("region", { name: "What's new" });
    expect(notes).toHaveTextContent("Mitsubishi Electric is now on 2026.2.");
    expect(notes).toHaveTextContent("MSZ-AP wall-mounted, 1 new size");
    expect(notes).toHaveTextContent("MSZ-GS wall-mounted, new series");
    /* never model codes */
    expect(notes).not.toHaveTextContent("MSZ-AP50VGD");

    /* the lineup marks the series that arrived whole, and only that one */
    const split = within(dialog).getByRole("heading", { name: "Split systems" }).parentElement!;
    const wall = within(split).getAllByRole("definition")[0];
    expect(wall).toHaveTextContent("MSZ-AP, MSZ-EF, MSZ-GS new");
    expect(wall.querySelectorAll(".ds-libm-arrived")).toHaveLength(1);

    /* opening was reading: the snapshot has caught up and the badge is gone,
       while the dialog keeps the notes it opened with */
    expect(JSON.parse(window.localStorage.getItem(SNAPSHOT_KEY)!)).toEqual(librarySnapshot(now));
    expect(door).not.toHaveTextContent("New");
    expect(within(dialog).getByRole("region", { name: "What's new" })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    /* and a second look has nothing new to say */
    await user.click(door);
    expect(within(screen.getByRole("dialog")).queryByRole("region", { name: "What's new" })).not.toBeInTheDocument();
  });

  it("says which models are no longer offered, and skips the version line when it did not change", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(librarySnapshot(manifest())));
    render(studio(manifest("2026.1", ["MSZ-AP25VGD"])));
    await user.click(await screen.findByRole("button", { name: /^Library/ }));
    const notes = within(screen.getByRole("dialog")).getByRole("region", { name: "What's new" });
    expect(notes).toHaveTextContent("No longer offered: MSZ-AP35VGD.");
    expect(notes).not.toHaveTextContent("is now on");
  });

  it("says so when nothing is installed", async () => {
    const user = userEvent.setup();
    render(studio({ brands: [] }));
    await user.click(await screen.findByRole("button", { name: /^Library/ }));
    expect(within(screen.getByRole("dialog")).getByText("No product data is installed yet.")).toBeInTheDocument();
  });
});
