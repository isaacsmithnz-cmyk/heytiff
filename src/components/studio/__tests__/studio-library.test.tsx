/* The library on the start screen: what it lists, how it opens, and what it
   calls new. The manifest is handed in the way the route hands it — already
   built — so these are about the card, not the packs (library.test.ts is). */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Studio } from "../studio";
import { LocalDesignStore } from "@/lib/studio/store";
import { librarySnapshot, type LibraryManifest } from "@/lib/studio/packs/library";

const SNAPSHOT_KEY = "heytiff.studio.library";

function manifest(version = "2026.1", ap: string[] = ["MSZ-AP25VGD", "MSZ-AP35VGD"]): LibraryManifest {
  return {
    brands: [
      {
        id: "mitsubishi-electric",
        name: "Mitsubishi Electric",
        version,
        systems: [
          {
            system: "split",
            label: "Split systems",
            series: [
              { series: "MSZ-AP", side: "indoor", form: "Wall-mounted", models: ap },
              { series: "MUZ-AP", side: "outdoor", form: null, models: ["MUZ-AP25VG", "MUZ-AP35VG"] },
            ],
          },
          { system: "multi", label: "Multi-split", series: [] },
          {
            system: "vrf",
            label: "VRF",
            series: [{ series: "PLFY-P-VEM-A", side: "indoor", form: "4-way cassette", models: ["PLFY-P20VEM-A"] }],
          },
        ],
      },
    ],
  };
}

const studio = (library?: LibraryManifest, admin?: boolean) => (
  <Studio store={new LocalDesignStore(window.localStorage)} library={library} libraryAdmin={admin} />
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
    expect(within(card).getByText("Mitsubishi Electric")).toBeInTheDocument();
    expect(within(card).getByText("Version 2026.1")).toBeInTheDocument();
  });

  it("lists brand, system, series and model — the groups shut until pressed, an empty one not at all", async () => {
    const user = userEvent.setup();
    render(studio(manifest()));
    const card = await screen.findByRole("region", { name: "Library" });

    const split = within(card).getByRole("button", { name: /Split systems/ });
    expect(split).toHaveAttribute("aria-expanded", "false");
    expect(split).toHaveTextContent("2 series");
    expect(within(card).getByRole("button", { name: /VRF/ })).toHaveTextContent("1 series");
    /* nothing multi-ready: no row rather than a row that opens on nothing */
    expect(within(card).queryByRole("button", { name: /Multi-split/ })).not.toBeInTheDocument();
    expect(within(card).queryByText("MSZ-AP")).not.toBeInTheDocument();

    await user.click(split);
    expect(split).toHaveAttribute("aria-expanded", "true");
    expect(within(card).getByText("MSZ-AP")).toBeInTheDocument();
    expect(within(card).getByText("Wall-mounted")).toBeInTheDocument();
    expect(within(card).getByText("MSZ-AP25VGD, MSZ-AP35VGD")).toBeInTheDocument();
    expect(within(card).getByText("Outdoor")).toBeInTheDocument();
    expect(within(card).getAllByText("2 models")).toHaveLength(2);

    await user.click(split);
    expect(within(card).queryByText("MSZ-AP")).not.toBeInTheDocument();
  });

  it("offers the Data Library door to an admin only", async () => {
    const { unmount } = render(studio(manifest(), true));
    const card = await screen.findByRole("region", { name: "Library" });
    expect(within(card).getByRole("link", { name: "Data Library" })).toHaveAttribute(
      "href",
      "/dashboard/studio/data-library"
    );
    unmount();
    render(studio(manifest(), false));
    const again = await screen.findByRole("region", { name: "Library" });
    expect(within(again).queryByRole("link", { name: "Data Library" })).not.toBeInTheDocument();
  });

  it("says nothing on a first visit, and records what it saw", async () => {
    render(studio(manifest()));
    await screen.findByRole("region", { name: "Library" });
    expect(screen.queryByText("Library updated")).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(SNAPSHOT_KEY)!)).toEqual(librarySnapshot(manifest()));
  });

  it("says what arrived since this browser last looked, marks it in the directory, and Dismiss catches the snapshot up", async () => {
    const user = userEvent.setup();
    /* last time: version 2026.1, two AP models */
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(librarySnapshot(manifest())));
    /* now: a new version, a third AP model */
    const now = manifest("2026.2", ["MSZ-AP25VGD", "MSZ-AP35VGD", "MSZ-AP50VGD"]);
    render(studio(now));
    const card = await screen.findByRole("region", { name: "Library" });

    const notice = within(card).getByRole("status");
    expect(notice).toHaveTextContent("Library updated");
    expect(notice).toHaveTextContent("Mitsubishi Electric is now version 2026.2, from 2026.1.");
    expect(notice).toHaveTextContent("1 model added.");
    expect(notice).toHaveTextContent("MSZ-AP: MSZ-AP50VGD");
    /* the snapshot is NOT overwritten by looking — only by dismissing */
    expect(JSON.parse(window.localStorage.getItem(SNAPSHOT_KEY)!).brands["mitsubishi-electric"].version).toBe("2026.1");

    /* and the directory marks it */
    const split = within(card).getByRole("button", { name: /Split systems/ });
    expect(split).toHaveTextContent("2 series, 1 new");
    await user.click(split);
    expect(within(card).getByText("1 new")).toBeInTheDocument();

    await user.click(within(card).getByRole("button", { name: "Dismiss" }));
    expect(within(card).queryByRole("status")).not.toBeInTheDocument();
    expect(split).toHaveTextContent("2 series");
    expect(split).not.toHaveTextContent("new");
    expect(JSON.parse(window.localStorage.getItem(SNAPSHOT_KEY)!)).toEqual(librarySnapshot(now));
  });

  it("calls a series that arrived whole a new series, and says which models are no longer offered", async () => {
    const before = manifest();
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(librarySnapshot(before)));
    const now: LibraryManifest = manifest("2026.1", ["MSZ-AP25VGD"]);
    now.brands[0].systems[0].series.push({
      series: "MSZ-EF",
      side: "indoor",
      form: "Wall-mounted",
      models: ["MSZ-EF25VGK"],
    });
    render(studio(now));
    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent("MSZ-EF, new series: MSZ-EF25VGK");
    expect(notice).toHaveTextContent("No longer offered: MSZ-AP35VGD.");
    /* no version line: the version did not change */
    expect(notice).not.toHaveTextContent("is now version");
  });

  it("says so when nothing is installed", async () => {
    render(studio({ brands: [] }));
    const card = await screen.findByRole("region", { name: "Library" });
    expect(within(card).getByText("No product data is installed yet.")).toBeInTheDocument();
  });
});
