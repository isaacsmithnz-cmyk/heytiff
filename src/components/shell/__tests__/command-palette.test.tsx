/* ⌘K finds jobs as well as screens (2026-09-24). Isaac typed "job 288" into
   it and was told it only jumps between screens. It asks the whole ServiceM8
   mirror now — the same search the Workboard's own box reaches past its
   window with — and a job opens on the Workboard with its card up. Clients
   and projects joined it the same day: a project opens its own page, and a
   client, who has no page, opens the Workboard searching for their name.

   What these pin: the word in front of the number is not asked for; nothing
   says "no match" before the work has answered; only the newest question
   may answer; the groups run screens, clients, projects, jobs and the keys
   walk through them; and nobody without the Workboard is sent to ask. */

import { act, fireEvent, render, screen } from "@testing-library/react";
import type { AllJobsMirrorJob } from "@/lib/workboard/all-jobs";
import type { Capability } from "@/lib/permissions";

const push = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const close = jest.fn();
let isOpen = true;
jest.mock("../command-palette-context", () => ({
  useCommandPalette: () => ({ isOpen, close }),
}));

const searchPalette = jest.fn();
jest.mock("@/app/actions/palette", () => ({
  searchPalette: (...a: unknown[]) => searchPalette(...a),
}));

import { CommandPalette } from "../command-palette";
import type { PaletteFinds } from "@/app/actions/palette";
import type { PaletteClient, PaletteProject, PaletteStaff } from "@/lib/workboard/palette-query";

const job = (over: Partial<AllJobsMirrorJob> = {}): AllJobsMirrorJob => ({
  remoteId: "j-288",
  jobNumber: "288",
  status: "Completed",
  clientName: "Kingsford Bakery",
  description: "Replace the split in the office",
  suburb: "Kingsford",
  categoryName: null,
  categoryColour: null,
  date: "2024-03-02 09:00:00",
  quoteDate: null,
  completionDate: "2024-03-04 15:00:00",
  nextBooking: null,
  money: null,
  paidCents: 0,
  ...over,
});

const client = (over: Partial<PaletteClient> = {}): PaletteClient => ({
  uuid: "c-1",
  name: "Kingsford Bakery",
  address: "12 Anzac Pde, Kingsford NSW 2032",
  ...over,
});

const project = (over: Partial<PaletteProject> = {}): PaletteProject => ({
  id: "p-9",
  name: "Kingsford fitout",
  clientName: "Kingsford Bakery",
  siteLabel: "Kingsford",
  stage: "Pre-install",
  status: "active",
  ...over,
});

const person = (over: Partial<PaletteStaff> = {}): PaletteStaff => ({
  id: "s-1",
  name: "Robert Smith",
  known: null,
  initials: "RS",
  title: "Senior Tech",
  active: true,
  ...over,
});

/** What the one round trip answers — jobs only unless a test says otherwise. */
const finds = (over: Partial<PaletteFinds> = {}): PaletteFinds => ({
  staff: [],
  clients: [],
  projects: [],
  jobs: [],
  ...over,
});

/** A promise the test resolves when it chooses — an answer still on its way. */
function later<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const WORKBOARD: Capability[] = ["workboard"];

const palette = (caps: readonly Capability[] = WORKBOARD) =>
  render(<CommandPalette role="staff" caps={caps} />);

const box = () => screen.getByRole("textbox");
const type = (value: string) => fireEvent.change(box(), { target: { value } });
const press = (key: string) => fireEvent.keyDown(window, { key });
/** Past the pause the palette waits before asking, and past the answer. */
const settle = async () => {
  await act(async () => {
    jest.advanceTimersByTime(250);
  });
  await act(async () => {});
};

beforeEach(() => {
  jest.useFakeTimers();
  push.mockClear();
  close.mockClear();
  searchPalette.mockReset();
  searchPalette.mockResolvedValue(finds());
  isOpen = true;
});
afterEach(() => jest.useRealTimers());

describe("the palette finds jobs", () => {
  it("finds job 288 asked the way people ask for it, and opens its card", async () => {
    searchPalette.mockResolvedValue(finds({ jobs: [job()] }));
    palette();

    type("job 288");
    expect(searchPalette).not.toHaveBeenCalled(); // not per keystroke
    await settle();

    expect(searchPalette).toHaveBeenCalledTimes(1);
    expect(searchPalette).toHaveBeenCalledWith("288");
    expect(screen.getByText("ServiceM8 jobs")).toBeInTheDocument();
    const row = screen.getByRole("button", { name: /#288 Kingsford Bakery/ });
    expect(row).toHaveTextContent("Replace the split in the office");
    expect(row).toHaveTextContent("Completed");

    press("Enter");
    expect(close).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/dashboard/workboard?job=j-288");
  });

  it("opens a job from a click as well", async () => {
    searchPalette.mockResolvedValue(finds({ jobs: [job({ remoteId: "j/odd id" })] }));
    palette();
    type("288");
    await settle();

    fireEvent.click(screen.getByRole("button", { name: /#288 Kingsford Bakery/ }));
    expect(push).toHaveBeenCalledWith("/dashboard/workboard?job=j%2Fodd%20id");
  });

  it("says it is searching, and never 'no match', until the jobs have answered", async () => {
    const answer = later<PaletteFinds>();
    searchPalette.mockReturnValue(answer.promise);
    palette();

    type("job 288");
    expect(screen.getByText("Searching…")).toBeInTheDocument();
    await settle();
    expect(screen.getByText("Searching…")).toBeInTheDocument();
    expect(screen.queryByText(/matches/)).toBeNull();

    await act(async () => answer.resolve(finds()));
    expect(screen.getByText(/Nothing matches/)).toHaveTextContent("Nothing matches “job 288”");
  });

  it("lets only the newest question answer", async () => {
    const first = later<PaletteFinds>();
    const second = later<PaletteFinds>();
    searchPalette.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    palette();

    type("job 28");
    await settle();
    type("job 288");
    await settle();

    await act(async () => second.resolve(finds({ jobs: [job()] })));
    // the older, slower answer lands last and must not be painted
    await act(async () => first.resolve(finds({ jobs: [job({ remoteId: "j-28", jobNumber: "28" })] })));

    expect(screen.getByRole("button", { name: /#288 Kingsford Bakery/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /#28 Kingsford/ })).toBeNull();
  });

  it("puts the screens first and walks the keys on into the jobs", async () => {
    searchPalette.mockResolvedValue(finds({ jobs: [job({ remoteId: "j-9", jobNumber: "2380" })] }));
    palette();
    type("workboard");
    await settle();

    const screenRow = screen.getByRole("button", { name: /^Workboard/ });
    const jobRow = screen.getByRole("button", { name: /#2380 Kingsford Bakery/ });
    expect(screenRow.compareDocumentPosition(jobRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screenRow).toHaveClass("on");

    press("ArrowDown");
    expect(jobRow).toHaveClass("on");
    press("Enter");
    expect(push).toHaveBeenCalledWith("/dashboard/workboard?job=j-9");
  });

  it("does not ask for one character, or for the word 'job' alone", async () => {
    palette();
    type("job 2");
    await settle();
    type("job");
    await settle();
    expect(searchPalette).not.toHaveBeenCalled();
  });

  it("starts clean when it opens again", async () => {
    searchPalette.mockResolvedValue(finds({ jobs: [job()] }));
    const { rerender } = palette();
    type("job 288");
    await settle();
    expect(screen.getByRole("button", { name: /#288/ })).toBeInTheDocument();

    isOpen = false;
    rerender(<CommandPalette role="staff" caps={WORKBOARD} />);
    isOpen = true;
    rerender(<CommandPalette role="staff" caps={WORKBOARD} />);

    expect(box()).toHaveValue("");
    expect(screen.queryByRole("button", { name: /#288/ })).toBeNull();
  });
});

describe("the palette finds clients and projects", () => {
  it("lists clients, then projects, then jobs, under the screens", async () => {
    searchPalette.mockResolvedValue(
      finds({ clients: [client()], projects: [project()], jobs: [job()] })
    );
    palette();
    type("kingsford");
    await settle();

    expect(searchPalette).toHaveBeenCalledWith("kingsford");
    const heads = [...document.querySelectorAll(".cgl")].map((h) => h.textContent);
    expect(heads).toEqual(["Clients", "Projects", "ServiceM8 jobs"]);
    expect(screen.getByRole("button", { name: /^Kingsford Bakery/ })).toHaveTextContent(
      "12 Anzac Pde, Kingsford NSW 2032"
    );
    const row = screen.getByRole("button", { name: /^Kingsford fitout/ });
    expect(row).toHaveTextContent("Kingsford Bakery, Kingsford");
    expect(row).toHaveTextContent("Pre-install");
  });

  /* A client has no page of their own; the board's search on their name is
     every job, visit, project and photo that names them. */
  it("opens a client as the Workboard searching for their name", async () => {
    searchPalette.mockResolvedValue(finds({ clients: [client({ name: "Smith & Sons" })] }));
    palette();
    type("smith");
    await settle();

    press("Enter");
    expect(close).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/dashboard/workboard?q=Smith%20%26%20Sons");
  });

  it("opens a project on its own page", async () => {
    searchPalette.mockResolvedValue(finds({ projects: [project()] }));
    palette();
    type("fitout");
    await settle();

    fireEvent.click(screen.getByRole("button", { name: /^Kingsford fitout/ }));
    expect(push).toHaveBeenCalledWith("/dashboard/workboard/projects/p-9");
  });

  it("says a stopped project's state, and a running one's stage", async () => {
    searchPalette.mockResolvedValue(
      finds({
        projects: [
          project({ id: "p-1", name: "Held tower", status: "on_hold" }),
          project({ id: "p-2", name: "Stuck tower", status: "blocked" }),
          project({ id: "p-3", name: "Finished tower", status: "done" }),
          project({ id: "p-4", name: "Running tower", stage: "Rough-in" }),
        ],
      })
    );
    palette();
    type("tower");
    await settle();

    expect(screen.getByRole("button", { name: /^Held tower/ })).toHaveTextContent("On hold");
    expect(screen.getByRole("button", { name: /^Stuck tower/ })).toHaveTextContent("Blocked");
    expect(screen.getByRole("button", { name: /^Finished tower/ })).toHaveTextContent("Done");
    expect(screen.getByRole("button", { name: /^Running tower/ })).toHaveTextContent("Rough-in");
  });

  it("walks the keys from a client through a project to a job", async () => {
    searchPalette.mockResolvedValue(
      finds({ clients: [client()], projects: [project()], jobs: [job()] })
    );
    palette();
    type("kingsford");
    await settle();

    const order = ["^Kingsford Bakery", "^Kingsford fitout", "#288 Kingsford Bakery"].map((n) =>
      screen.getByRole("button", { name: new RegExp(n) })
    );
    expect(order[0]).toHaveClass("on");
    press("ArrowDown");
    expect(order[1]).toHaveClass("on");
    press("ArrowDown");
    expect(order[2]).toHaveClass("on");
    press("Enter");
    expect(push).toHaveBeenCalledWith("/dashboard/workboard?job=j-288");
  });
});

/* Staff joined the palette on 2026-09-24, for whoever holds `team` — the
   grant the staff card's own route checks. */
describe("the palette finds staff", () => {
  const TEAM_AND_WORK: Capability[] = ["team", "workboard"];

  it("lists staff under the screens and ahead of the work, and opens a staff card", async () => {
    searchPalette.mockResolvedValue(
      finds({ staff: [person()], clients: [client({ name: "Smith & Sons" })] })
    );
    palette(TEAM_AND_WORK);
    type("smith");
    await settle();

    const heads = [...document.querySelectorAll(".cgl")].map((h) => h.textContent);
    expect(heads).toEqual(["Staff", "Clients"]);
    const row = screen.getByRole("button", { name: /Robert Smith/ });
    expect(row).toHaveTextContent("Senior Tech");
    expect(row.querySelector(".ci2.who")).toHaveTextContent("RS");

    press("Enter");
    expect(push).toHaveBeenCalledWith("/dashboard/team/s-1");
  });

  it("says what a person goes by, and says when they have left", async () => {
    searchPalette.mockResolvedValue(
      finds({
        staff: [
          person({ id: "s-1", known: "Bob" }),
          person({ id: "s-2", name: "Ann Smith", title: null, active: false }),
        ],
      })
    );
    palette(TEAM_AND_WORK);
    type("smith");
    await settle();

    expect(screen.getByRole("button", { name: /Robert Smith \(Bob\)/ })).not.toHaveTextContent(
      "Inactive"
    );
    expect(screen.getByRole("button", { name: /Ann Smith/ })).toHaveTextContent("Inactive");
  });

  /* Somebody who holds the Team screen but not the Workboard still asks —
     for the people, and the box says that is what it reaches. */
  it("asks for someone with the Team screen alone, and says so in the box", async () => {
    searchPalette.mockResolvedValue(finds({ staff: [person()] }));
    palette(["team"]);
    expect(box()).toHaveAttribute("placeholder", "Search screens and staff…");

    type("smith");
    await settle();
    expect(searchPalette).toHaveBeenCalledWith("smith");
    expect(screen.getByRole("button", { name: /Robert Smith/ })).toBeInTheDocument();
  });

  it("names everything it reaches for someone who holds both", () => {
    palette(TEAM_AND_WORK);
    expect(box()).toHaveAttribute(
      "placeholder",
      "Search screens, staff, clients, projects and jobs…"
    );
  });
});

describe("without the Workboard", () => {
  it("never asks, and says what it did look through", async () => {
    palette([]);
    expect(box()).toHaveAttribute("placeholder", "Jump to a screen…");

    type("job 288");
    await settle();

    expect(searchPalette).not.toHaveBeenCalled();
    expect(screen.getByText(/No screen matches/)).toHaveTextContent("No screen matches “job 288”");
  });
});
