import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Sidebar } from "../sidebar";
import { resolve } from "@/lib/permissions";
import type { Role } from "@/lib/roles-shared";

/* Render as a real role would resolve — capabilities come from the same
   resolver the server uses, so these tests track the real defaults. */
const as = (role: Role, orgName: string | null = null) => (
  <Sidebar role={role} caps={[...resolve(role)]} orgName={orgName} />
);

jest.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

// auto-cleanup isn't wired in this jest setup; without this, earlier renders
// (owner rails containing "Admin") leak into later queryByText assertions
afterEach(cleanup);

describe("Sidebar — no standing 'look at me' marks", () => {
  it("draws no pulsing dot on any row, for any role", () => {
    /* The Library carried a hard-coded `dot: true` from the day it shipped: a teal
       dot that pulsed on the rail forever, with nothing behind it that could
       ever turn it off. The `dot` field is gone from NavItem, so this can only
       come back deliberately — and it should come back with a source of truth,
       not a boolean. */
    for (const role of ["staff", "admin", "owner"] as Role[]) {
      const { container } = render(as(role));
      expect(container.querySelector(".pdot")).toBeNull();
      cleanup();
    }
  });
});

describe("Sidebar — the business chip", () => {
  it("chips the trading name under the wordmark when set", () => {
    const { container } = render(as("owner", "Smith Air Conditioning"));
    const chip = container.querySelector(".ht-orgpill");
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toBe("Smith Air Conditioning");
    // the chip wraps rather than truncating, and `overflow-wrap:anywhere` can
    // wrap mid-word — the hover gives the name back unbroken
    expect(chip?.getAttribute("title")).toBe("Smith Air Conditioning");
  });

  it("renders no chip at all while the org has no trading name", () => {
    const { container } = render(as("owner"));
    expect(container.querySelector(".ht-orgpill")).toBeNull();
  });

  it("renders no chip when the prop is omitted", () => {
    const { container } = render(as("owner"));
    expect(container.querySelector(".ht-orgpill")).toBeNull();
  });

  it("keeps the wordmark regardless", () => {
    render(as("owner"));
    expect(screen.getByText("Hey")).toBeTruthy();
    expect(screen.getByText("Tiff")).toBeTruthy();
  });

  /* THE ORG LOGO DOES NOT BELONG IN THE RAIL, and this is the guard.

     It was rendered here once, in a 40×40 box where the × had been. What a
     business actually uploads is a letterhead — the artwork in prod is
     3780×1064 — so `object-fit:contain` drew it 9px tall, in the near-black
     ink a letterhead is drawn in, on a near-black rail. It read as an empty
     tile with the business name printed underneath it a second time.

     224px of rail has nowhere to put a wordmark that wide. The logo renders on
     the surfaces a customer receives (components/org/letterhead.tsx), where
     there is a document's width to give it. */
  it("never renders the org logo in the rail, however wide the name", () => {
    const { container } = render(
      <Sidebar
        role="owner"
        caps={[...resolve("owner")]}
        orgName="Diamond Air Solutions"
      />
    );
    // the Chevron is an inline <svg>; an <img> here could only be the logo
    expect(container.querySelector(".brand img")).toBeNull();
    expect(container.querySelector(".ht-orgpill")?.textContent).toBe(
      "Diamond Air Solutions"
    );
  });
});

describe("Sidebar — role-gated nav", () => {
  it("staff see no Operations entries, but keep their own vehicle", () => {
    render(as("staff"));
    expect(screen.queryByText("Team")).toBeNull();
    expect(screen.queryByText("Time & Pay")).toBeNull();
    expect(screen.queryByText("Admin")).toBeNull();
    expect(screen.queryByText("Assets")).toBeNull(); // the register is admin+
    expect(screen.getByText("Vehicle")).toBeTruthy(); // Personal group carries the "my"
    expect(screen.getByText("Toolbox")).toBeTruthy();
  });

  it("admins get Team, Time & Pay and the Admin section (its items gate inside)", () => {
    render(as("admin"));
    expect(screen.getByText("Team")).toBeTruthy();
    expect(screen.getByText("Time & Pay")).toBeTruthy();
    expect(screen.getByText("Admin")).toBeTruthy();
  });

  it("owners get the full rail", () => {
    render(as("owner", "Smith Air"));
    for (const label of ["Home", "Workboard", "Toolbox", "Design Studio", "Library", "Team", "Time & Pay", "Assets", "Admin", "Vehicle"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });
});

describe("Sidebar — a granted capability shows its entry", () => {
  /* The gap this closes: during the signed-in walkthrough, granting an admin
     `financials` opened the Rate Calculator ROUTE but no nav entry appeared,
     because the sidebar still filtered by role. */
  it("reveals Team for a staff member granted `team`", () => {
    render(<Sidebar role="staff" caps={[...resolve("staff", { team: true })]} />);
    expect(screen.getByText("Team")).toBeTruthy();
    expect(screen.queryByText("Time & Pay")).toBeNull(); // nothing else leaked in
  });

  it("hides Toolbox when it is revoked, even though every role has it by default", () => {
    render(<Sidebar role="owner" caps={[...resolve("owner")]} />);
    expect(screen.getByText("Toolbox")).toBeTruthy();
    cleanup();
    // an explicit revoke is respected for non-owners
    render(<Sidebar role="admin" caps={[...resolve("admin", { toolbox: false })]} />);
    expect(screen.queryByText("Toolbox")).toBeNull();
    expect(screen.getByText("Design Studio")).toBeTruthy();
  });
});

describe("Sidebar — the rail's two sizes", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-rail");
    window.localStorage.clear();
  });

  it("the foot toggle collapses to the rail, remembers it, and expands back", () => {
    render(as("owner"));
    fireEvent.click(screen.getByRole("button", { name: "Collapse navigation" }));
    expect(document.documentElement.hasAttribute("data-rail")).toBe(true);
    expect(window.localStorage.getItem("ht-rail")).toBe("1");
    /* collapsed rows are icon-only, so each grows a hover title giving the
       word back — and the same control now reads as Expand */
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("title")).toBe("Home");
    fireEvent.click(screen.getByRole("button", { name: "Expand navigation" }));
    expect(document.documentElement.hasAttribute("data-rail")).toBe(false);
    expect(window.localStorage.getItem("ht-rail")).toBe("0");
  });

  it("expanded rows carry no tooltip — the label is already worn", () => {
    render(as("owner"));
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("title")).toBeNull();
  });
});
