import { cleanup, render } from "@testing-library/react";
import { Topbar } from "../topbar";
import { ShellTopbar } from "../shell-chrome";
import { CommandPaletteProvider } from "../command-palette-context";
import { TiffContext, type TiffApi } from "@/components/tiff/modal/tiff-context";
import type { ShellUser } from "../sidebar";

/* WHO GETS THE TIFF MODAL IS ASKED WHERE THE ROLE IS, AND REPORTED UP.

   The dashboard layout must stay synchronous, so it cannot ask. The top
   bar's slot is a server component that already has the viewer's role: it
   asks `deskOn(role)` (HOME_DESK, owner-only until the flip) and hands the
   answer to the top bar, which reports it into the frame's modal host the
   way a screen reports what it is about into the note scope. Break either
   half and every Tiff button quietly goes on opening the capture sheet. */

jest.mock("@/components/notes/tiff-button", () => ({
  TiffButton: () => <button aria-label="Ask or tell Tiff" />,
}));
jest.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
// the bell and the slot's neighbours, which this suite is not about
jest.mock("../bell", () => ({ Bell: () => null }));
jest.mock("../command-palette", () => ({ CommandPalette: () => null }));
jest.mock("../sidebar", () => ({ Sidebar: () => null }));

const owner: ShellUser = { name: "Isaac Smith", initials: "IS", roleLabel: "Owner", role: "owner", caps: [] };

const deskOn = jest.fn();
jest.mock("@/lib/dashboard/desk-flag", () => ({ deskOn: (...a: unknown[]) => deskOn(...a) }));
jest.mock("@/lib/shell/data", () => ({ loadShell: async () => ({ user: owner, orgName: "Diamond Air" }) }));

const api = (report: jest.Mock): TiffApi => ({
  enabled: false,
  open: () => false,
  openedBy: null,
  isOpen: false,
  landed: null,
  report,
});

afterEach(cleanup);

it("the top bar's server slot asks the switch with the viewer's role", async () => {
  deskOn.mockReturnValue(true);
  const el = (await ShellTopbar()) as React.ReactElement<{ tiffModal: boolean }>;
  expect(deskOn).toHaveBeenCalledWith("owner");
  expect(el.props.tiffModal).toBe(true);

  deskOn.mockReturnValue(false);
  const off = (await ShellTopbar()) as React.ReactElement<{ tiffModal: boolean }>;
  expect(off.props.tiffModal).toBe(false);
});

it("the top bar reports the answer up to the modal's host", () => {
  const report = jest.fn();
  const { rerender } = render(
    <TiffContext.Provider value={api(report)}>
      <CommandPaletteProvider>
        <Topbar user={owner} today="2026-09-26" tiffModal />
      </CommandPaletteProvider>
    </TiffContext.Provider>
  );
  expect(report).toHaveBeenLastCalledWith(true);

  rerender(
    <TiffContext.Provider value={api(report)}>
      <CommandPaletteProvider>
        <Topbar user={owner} today="2026-09-26" tiffModal={false} />
      </CommandPaletteProvider>
    </TiffContext.Provider>
  );
  expect(report).toHaveBeenLastCalledWith(false);
});

it("says nothing is on until it is told", () => {
  const report = jest.fn();
  render(
    <TiffContext.Provider value={api(report)}>
      <CommandPaletteProvider>
        <Topbar user={owner} today="2026-09-26" />
      </CommandPaletteProvider>
    </TiffContext.Provider>
  );
  expect(report).not.toHaveBeenCalledWith(true);
});
