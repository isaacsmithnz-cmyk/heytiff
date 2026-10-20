/* WHAT A PAGE IS CALLED IN ITS OPEN TAB (rules 10 and 11). The header names
   a tab by its address; a job's page is named by the job, "3209 Richards",
   which the header can't read. The page says it (page-names.ts), keyed by
   its path, and the header reads that first. */

import { act, render, screen, within } from "@testing-library/react";

jest.mock("@/components/notes/tiff-button", () => ({ TiffButton: () => null }));
let pathname = "/dashboard/jobs/j-3209";
jest.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ push: jest.fn() }) }));

import { Topbar, tabName } from "../topbar";
import { CommandPaletteProvider } from "../command-palette-context";
import { namePage, pageName, pageNamesSnapshot } from "../page-names";

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("a page's own name", () => {
  it("is kept by the page's path, whatever its query", () => {
    namePage("/dashboard/jobs/j-1?tab=photos", { label: "3209 Richards", hue: "blue" });
    expect(pageName(pageNamesSnapshot(), "/dashboard/jobs/j-1")).toEqual({ label: "3209 Richards", hue: "blue" });
    expect(pageName(pageNamesSnapshot(), "/dashboard/jobs/j-1?tab=billing")).toEqual({ label: "3209 Richards", hue: "blue" });
    expect(JSON.parse(window.sessionStorage.getItem("ht:names")!)["/dashboard/jobs/j-1"]).toEqual({ label: "3209 Richards", hue: "blue" });
  });

  it("names the tab before the address does, and the address names the rest", () => {
    const names = { "/dashboard/jobs/j-1": { label: "3209 Richards", hue: "blue" as const } };
    expect(tabName("/dashboard/jobs/j-1", names)).toEqual({ label: "3209 Richards", icon: "folder", hue: "blue" });
    /* a job's page that hasn't said its name yet is a Job, not Home */
    expect(tabName("/dashboard/jobs/j-2", names)).toMatchObject({ label: "Job", icon: "folder" });
    expect(tabName("/dashboard/team/s-1", names).label).toBe("Team");
  });

  it("wears the glyph a page names, the truck on a vehicle's, and keeps it across a reload", () => {
    namePage("/dashboard/vehicles/v1?tab=service", { label: "Hilux XQG 41B", icon: "truck" });
    expect(tabName("/dashboard/vehicles/v1", pageNamesSnapshot())).toEqual({ label: "Hilux XQG 41B", icon: "truck" });
    expect(JSON.parse(window.sessionStorage.getItem("ht:names")!)["/dashboard/vehicles/v1"]).toEqual({ label: "Hilux XQG 41B", icon: "truck" });
    /* before it has said its name, a Vehicle with the truck */
    expect(tabName("/dashboard/vehicles/v2", {})).toMatchObject({ label: "Vehicle", icon: "truck" });
  });
});

describe("the header's tab for a job's page", () => {
  it("reads the job's number and short name, with its colour's dot", () => {
    pathname = "/dashboard/jobs/j-3209";
    render(
      <CommandPaletteProvider>
        <Topbar today="2026-10-18" />
      </CommandPaletteProvider>,
    );
    act(() => namePage("/dashboard/jobs/j-3209", { label: "3209 Richards", hue: "purple" }));
    const tabs = screen.getByRole("tablist", { name: "Open tabs" });
    const tab = within(tabs).getByRole("tab", { name: /3209 Richards/ });
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(tab.querySelector(".pt-dot--purple")).not.toBeNull();
  });
});
