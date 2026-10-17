import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Sidebar, type ShellUser } from "../sidebar";
import { CommandPaletteProvider } from "../command-palette-context";
import { resolve } from "@/lib/permissions";
import type { Role } from "@/lib/roles-shared";

/* The sidebar, v2 (docs/design.md rules 1, 3 to 7 and 27): the wordmark,
   New, Search, the places, Recents, and your name at the foot. */

const push = jest.fn();
jest.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/team",
  useRouter: () => ({ push }),
}));
/* New's Job opens the board's own form, which reaches server actions;
   stubbed so this suite stays about the sidebar. */
jest.mock("@/components/workboard/board/new-job-modal", () => ({
  NewJobModal: () => <div role="dialog" aria-label="New job" />,
}));

const userAs = (role: Role, caps = [...resolve(role)]): ShellUser => ({
  name: "Isaac Smith",
  initials: "IS",
  roleLabel: role === "owner" ? "Owner" : role === "admin" ? "Admin" : "Staff",
  role,
  caps,
});

const draw = (user: ShellUser, newJob = false) =>
  render(
    <CommandPaletteProvider>
      <Sidebar user={user} newJob={newJob} />
    </CommandPaletteProvider>,
  );

afterEach(() => {
  cleanup();
  push.mockReset();
});

const places = () =>
  within(screen.getByRole("navigation", { name: "Places" }))
    .getAllByRole("link")
    .map((a) => a.textContent);

describe("the sidebar's top", () => {
  it("wears HeyTiff in one colour, with no business chip and no logo", () => {
    const { container } = draw(userAs("owner"));
    const wm = container.querySelector(".fr-wm")!;
    expect(wm.textContent).toBe("HeyTiff");
    expect(wm.querySelector("span")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("offers Search with ⌘K under New", () => {
    draw(userAs("staff"));
    expect(screen.getByRole("button", { name: /Search/ })).toHaveTextContent("⌘K");
  });

  it("shows New only where a Job can be made from it", () => {
    draw(userAs("owner"));
    expect(screen.queryByRole("button", { name: "New" })).toBeNull();
    cleanup();
    draw(userAs("owner"), true);
    expect(screen.getByRole("button", { name: "New" })).toHaveAttribute("aria-haspopup", "menu");
  });
});

describe("the places (rule 5)", () => {
  it("gives everyone Home, and each place to whoever holds it", () => {
    draw(userAs("staff", []));
    expect(places()).toEqual(["Home"]);
    cleanup();
    draw(userAs("owner"));
    expect(places().slice(0, 5)).toEqual(["Home", "Jobs", "Library", "Design", "Team"]);
  });

  it("marks the place you're on", () => {
    draw(userAs("owner"));
    const team = screen.getByRole("link", { name: "Team" });
    expect(team).toHaveAttribute("aria-current", "page");
    expect(team).toHaveClass("on");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("keeps today's screens that haven't moved yet, after a hairline", () => {
    draw(userAs("owner"));
    expect(places()).toEqual(expect.arrayContaining(["Toolbox", "Time & Pay", "Assets"]));
    expect(document.querySelector(".fr-places .fr-hair")).not.toBeNull();
  });

  it("hides a screen when its capability is revoked", () => {
    const caps = [...resolve("staff")].filter((c) => c !== "toolbox");
    draw(userAs("staff", caps));
    expect(places()).not.toContain("Toolbox");
  });

  it("doesn't fold: no collapse control (rule 27)", () => {
    draw(userAs("owner"));
    expect(screen.queryByRole("button", { name: /collapse|expand/i })).toBeNull();
  });
});

describe("your name (rule 7)", () => {
  it("opens your card, time, leave, claims, Reports and Settings, then Sign out", () => {
    draw(userAs("owner", [...resolve("owner")]));
    act(() => screen.getByRole("button", { name: /Isaac Smith/ }).click());
    const menu = screen.getByRole("menu", { name: "Your name" });
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "Your card",
      "Timesheet",
      "Leave",
      "Expense claims",
      "Reports",
      "Settings",
      "Sign out",
    ]);
  });

  it("keeps Settings from staff", () => {
    draw(userAs("staff"));
    act(() => screen.getByRole("button", { name: /Isaac Smith/ }).click());
    const items = within(screen.getByRole("menu", { name: "Your name" })).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).not.toContain("Settings");
  });

  it("goes where you pick", () => {
    draw(userAs("staff"));
    act(() => screen.getByRole("button", { name: /Isaac Smith/ }).click());
    fireEvent.click(screen.getByRole("menuitem", { name: "Leave" }));
    expect(push).toHaveBeenCalledWith("/dashboard/my-leave");
  });
});

describe("New", () => {
  it("makes a Job with the board's own form", () => {
    draw(userAs("owner"), true);
    act(() => screen.getByRole("button", { name: "New" }).click());
    fireEvent.click(screen.getByRole("menuitem", { name: "Job" }));
    expect(screen.getByRole("dialog", { name: "New job" })).toBeInTheDocument();
  });
});
