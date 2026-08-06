import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "../app-shell";
import { SidebarSkeleton, TopbarSkeleton } from "../shell-skeletons";
import { CommandPaletteProvider, useCommandPalette } from "../command-palette-context";

/* The frame must render WITHOUT knowing who is looking at it.

   That is the whole point of the change these cover: the layout used to await
   the session, the staff name and the membership before anything painted, so
   the black frame itself waited on three database round trips. Now the frame
   is synchronous and the personalised chrome arrives as suspended slots.

   If someone later "tidies" AppShell by giving it a `user` prop again, these
   fail — which is the intent. */

/* The frame now carries the Tiff button, which reaches the note flow and its
   server actions — and "use server" modules cannot be imported into jsdom.
   Stubbed here because this suite is about the shell's streaming slots; the
   button has its own suite. */
jest.mock("@/components/notes/tiff-button", () => ({
  TiffButton: () => <div data-testid="tiff-button" />,
}));

jest.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));

const slots = {
  sidebar: <SidebarSkeleton />,
  topbar: <TopbarSkeleton />,
  palette: null,
};

it("draws the frame with no session, no user and no capabilities", () => {
  render(
    <AppShell {...slots}>
      <p>page content</p>
    </AppShell>
  );
  // the frame itself
  expect(document.querySelector(".fg")).toBeInTheDocument();
  expect(document.querySelector(".gridbg")).toBeInTheDocument();
  expect(document.querySelector(".framefx")).toBeInTheDocument();
  // and the page under it, which must NOT wait on the chrome
  expect(screen.getByText("page content")).toBeInTheDocument();
});

/* The skeletons hold the space the real chrome will occupy. If they collapsed,
   the sidebar would jump under the cursor the moment the session resolved. */
it("the fallback chrome occupies the sidebar and topbar slots", () => {
  render(
    <AppShell {...slots}>
      <p>page</p>
    </AppShell>
  );
  expect(document.querySelector("aside.side")).toBeInTheDocument();
  expect(document.querySelector("header.topbar")).toBeInTheDocument();
  // the wordmark is knowable without a database, so it is real, not a grey block
  expect(screen.getByText("Hey")).toBeInTheDocument();
});

/* The skeleton chrome is scenery: it must not offer controls that would do
   nothing, or look focusable to a screen reader. */
it("the fallback chrome exposes no buttons and is hidden from assistive tech", () => {
  render(<SidebarSkeleton />);
  render(<TopbarSkeleton />);
  expect(screen.queryAllByRole("button")).toHaveLength(0);
  expect(document.querySelector("aside.side")).toHaveAttribute("aria-hidden", "true");
});

/* The palette opener crosses a server/client boundary now — the topbar is a
   server-rendered slot, so it cannot be handed a callback and reads context
   instead. This pins that the wiring actually connects. */
describe("command palette context", () => {
  function Opener() {
    const { isOpen, open, close } = useCommandPalette();
    return (
      <>
        <button onClick={open}>open it</button>
        <button onClick={close}>close it</button>
        <span>{isOpen ? "palette open" : "palette shut"}</span>
      </>
    );
  }

  it("carries open and close between two components that share no props", async () => {
    const user = userEvent.setup();
    render(
      <CommandPaletteProvider>
        <Opener />
      </CommandPaletteProvider>
    );
    expect(screen.getByText("palette shut")).toBeInTheDocument();
    await user.click(screen.getByText("open it"));
    expect(screen.getByText("palette open")).toBeInTheDocument();
    await user.click(screen.getByText("close it"));
    expect(screen.getByText("palette shut")).toBeInTheDocument();
  });

  /* Failing loudly beats a dead search button: without the provider the
     opener silently does nothing, which is the kind of bug that ships. */
  it("refuses to be used outside the provider", () => {
    const quiet = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Opener />)).toThrow(/CommandPaletteProvider/);
    quiet.mockRestore();
  });

  it("AppShell provides it, so a slotted topbar can open the palette", async () => {
    const user = userEvent.setup();
    render(
      <AppShell {...slots} topbar={<Opener />}>
        <p>page</p>
      </AppShell>
    );
    await user.click(screen.getByText("open it"));
    expect(screen.getByText("palette open")).toBeInTheDocument();
  });
});
