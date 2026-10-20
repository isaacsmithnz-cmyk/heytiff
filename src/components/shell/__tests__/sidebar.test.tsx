import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Sidebar, type ShellUser } from "../sidebar";
import { CommandPaletteProvider } from "../command-palette-context";
import { namePage } from "../page-names";
import { RecordsContext, WindowsContext } from "@/components/records/records-context";
import { resolve } from "@/lib/permissions";
import type { Role } from "@/lib/roles-shared";

/* The sidebar, v2 (docs/design.md rules 1, 3 to 7 and 27): the wordmark,
   New, Search, the places, Recents, and your name at the foot. */

let mockPath = "/dashboard/team";
const push = jest.fn();
jest.mock("next/navigation", () => ({
  usePathname: () => mockPath,
  useRouter: () => ({ push }),
}));
/* New's Job opens the board's own form, which reaches server actions;
   stubbed so this suite stays about the sidebar. */
const taskForm = jest.fn();
jest.mock("@/components/making/task-form", () => ({
  TaskForm: (p: { job: unknown }) => {
    taskForm(p.job);
    return <div role="dialog" aria-label="New task" />;
  },
}));
jest.mock("@/components/making/new-job-form", () => ({
  NewJobForm: () => <div role="dialog" aria-label="New job" />,
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

  it("offers Search under New, with no ⌘K beside it", () => {
    draw(userAs("staff"));
    expect(screen.getByRole("button", { name: "Search" })).not.toHaveTextContent("⌘K");
  });

  it("makes a Job and a Task, Job only where ServiceM8 takes new jobs (rules 3 and 44)", () => {
    draw(userAs("owner"));
    act(() => screen.getByRole("button", { name: "New" }).click());
    expect(within(screen.getByRole("menu", { name: "New" })).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Task"]);
    cleanup();
    draw(userAs("owner"), true);
    act(() => screen.getByRole("button", { name: "New" }).click());
    const menu = screen.getByRole("menu", { name: "New" });
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Job", "Task"]);
    expect(menu.closest(".pt-menu")).toHaveClass("pt-menu--ink");
  });
});

describe("the places (rule 5)", () => {
  it("gives everyone Home, and each place to whoever holds it", () => {
    draw(userAs("staff", []));
    expect(places()).toEqual(["Home"]);
    cleanup();
    draw(userAs("owner"));
    expect(places().slice(0, 8)).toEqual(["Home", "Conversations", "Jobs", "Schedule", "Documents", "Library", "Design", "Team"]);
  });

  it("marks the place you're on", () => {
    draw(userAs("owner"));
    const team = screen.getByRole("link", { name: "Team" });
    expect(team).toHaveAttribute("aria-current", "page");
    expect(team).toHaveClass("on");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("is the eight places and nothing else: every screen has moved into one (20 October)", () => {
    draw(userAs("owner"));
    for (const gone of ["Workboard", "Toolbox", "Time & Pay", "Assets"]) expect(places()).not.toContain(gone);
    expect(document.querySelector(".fr-places .fr-hair")).toBeNull();
  });

  it("shows the Library for Tiff's documents or the field tools, and hides it without either", () => {
    const staff = [...resolve("staff")];
    draw(userAs("staff", staff.filter((c) => c !== "tiff")));
    expect(places()).toContain("Library");
    cleanup();
    draw(userAs("staff", staff.filter((c) => c !== "tiff" && c !== "toolbox")));
    expect(places()).not.toContain("Library");
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
  it("makes a general task away from a job", () => {
    draw(userAs("staff"));
    act(() => screen.getByRole("button", { name: "New" }).click());
    fireEvent.click(screen.getByRole("menuitem", { name: "Task" }));
    expect(screen.getByRole("dialog", { name: "New task" })).toBeInTheDocument();
    expect(taskForm).toHaveBeenLastCalledWith(null);
  });

  it("fills in the job when it opens on a job's page, named as its tab is", () => {
    mockPath = "/dashboard/jobs/abc-123";
    namePage("/dashboard/jobs/abc-123", { label: "3209 Richards" });
    draw(userAs("staff"));
    act(() => screen.getByRole("button", { name: "New" }).click());
    fireEvent.click(screen.getByRole("menuitem", { name: "Task" }));
    expect(taskForm).toHaveBeenLastCalledWith({ uuid: "abc-123", label: "3209 Richards" });
    mockPath = "/dashboard/team";
  });

  it("makes a Job with the board's own form", () => {
    draw(userAs("owner"), true);
    act(() => screen.getByRole("button", { name: "New" }).click());
    fireEvent.click(screen.getByRole("menuitem", { name: "Job" }));
    expect(screen.getByRole("dialog", { name: "New job" })).toBeInTheDocument();
  });
});

describe("Pinned (rule 6)", () => {
  /* a job is a page now (v2, step 5): its row goes there; a visit still
     opens its card where you are */
  it("lists what you pinned, a job as a link to its page and a visit as its card", () => {
    const open = jest.fn();
    render(
      <RecordsContext.Provider value={{ hosted: true, open }}>
        <CommandPaletteProvider>
          <Sidebar
            user={userAs("staff")}
            pins={[
              { ref: { kind: "job", id: "j1" }, title: "Job 3342", sub: "Rifkin, Bellevue Hill" },
              { ref: { kind: "visit", id: "v1" }, title: "Quarterly service", sub: null },
            ]}
          />
        </CommandPaletteProvider>
      </RecordsContext.Provider>,
    );
    const pinned = screen.getByRole("region", { name: "Pinned" });
    expect(within(pinned).getByRole("link", { name: "Job 3342, Rifkin, Bellevue Hill" })).toHaveAttribute("href", "/dashboard/jobs/j1");
    fireEvent.click(within(pinned).getByRole("button", { name: "Quarterly service" }));
    expect(open).toHaveBeenCalledWith({ kind: "visit", id: "v1" });
  });
});

describe("Recents (rule 6)", () => {
  it("lists the jobs opened lately as links to their pages", () => {
    const windows = {
      windows: [],
      docked: true,
      close: jest.fn(),
      dismiss: jest.fn(),
      setAside: jest.fn(),
      restore: jest.fn(),
      stepOf: () => null,
      step: jest.fn(),
      reload: jest.fn(),
      toast: jest.fn(),
      recent: [{ key: "job.j-7", ref: { kind: "job" as const, id: "j-7" }, title: "Job 3209", sub: "Richards Building" }],
    };
    render(
      <WindowsContext.Provider value={windows}>
        <CommandPaletteProvider>
          <Sidebar user={userAs("staff")} />
        </CommandPaletteProvider>
      </WindowsContext.Provider>,
    );
    const recents = screen.getByRole("region", { name: "Recents" });
    expect(within(recents).getByRole("link", { name: "Job 3209, Richards Building" })).toHaveAttribute("href", "/dashboard/jobs/j-7");
  });
});

/* NO NUMBER BESIDE HOME (Isaac, 20 October): what waits is on Home. */
describe("Home's row", () => {
  it("(F) is the word alone, with no count", () => {
    draw(userAs("staff"));
    const home = within(screen.getByRole("navigation", { name: "Places" })).getAllByRole("link")[0]!;
    expect(home).toHaveAttribute("href", "/dashboard");
    expect(home.textContent).toBe("Home");
  });
});
