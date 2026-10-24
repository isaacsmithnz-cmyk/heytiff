import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useContext, type ReactNode } from "react";
import { DOCK_MAX, PageRecordsProvider, RecordsProvider, useRecords, type OpenRecordOptions } from "../record-host";
import { RecordDock } from "../record-dock";
import { RecordsContext, WindowsContext } from "../records-context";
import { RecordLink } from "../record-link";
import { RecordWindows } from "../record-windows";
import type { RecordKind } from "@/lib/records/ref";

/* THE APP'S RECORD HOST. Mounted once in the dashboard layout, above the
   outlet: a maintenance visit or a service agreement opens OVER the screen
   you are on, the address carries it so Back closes it and a refresh brings
   it back, and going somewhere else puts it away. A job is a page of its
   own (24 October 2026: the pop-up job card went), so a door to one goes
   there. This suite pins that contract; the cards are the board's own
   sheets with their own suites, so here they are stand-ins that print what
   they were opened on. The board read is a server action, and "use server"
   modules cannot be imported into jsdom. */

let mockPath = "/dashboard/assets";
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockRouter = {
  refresh: jest.fn(),
  push: (...a: unknown[]) => mockPush(...a),
  replace: (...a: unknown[]) => mockReplace(...a),
};
jest.mock("next/navigation", () => ({
  usePathname: () => mockPath,
  useRouter: () => mockRouter,
}));

/* A visit and an agreement are read off the maintenance board. What the
   board holds (`hold`) answers at once; anything else waits until the test
   answers it, so a late answer can be seen to open nothing. */
type Answer = { resolve: (body: unknown) => void; reject: (e: unknown) => void };
const asks = new Map<string, Answer>();
const board = new Map<string, unknown>();
function readBoard(kind: string, id: string): Promise<unknown> {
  const key = `${kind}.${id}`;
  if (board.has(key)) return Promise.resolve(board.get(key));
  return new Promise((resolve, reject) => asks.set(key, { resolve, reject }));
}
const openMaintenanceCard = jest.fn();
jest.mock("@/app/actions/workboard-records", () => ({
  openMaintenanceCard: (...a: unknown[]) => openMaintenanceCard(...a),
}));
/* The visit's card carries the window's controls where the real one does,
   and keeps a little state of its own, so a card set aside can be seen to
   come back as it was left. */
jest.mock("@/components/workboard/board/visit-sheet", () => {
  const { useState } = jest.requireActual<typeof import("react")>("react");
  return {
    VisitSheet: function VisitSheet(p: {
      visit: { label: string; clientName: string | null; notes?: string };
      windowControls?: React.ReactNode;
      onOpenAgreement: (id: string) => void;
      onChanged?: () => void;
      onClose: () => void;
    }) {
      const [written, setWritten] = useState(0);
      return (
        <div role="dialog" aria-label={`Visit ${p.visit.label}`}>
          {p.visit.clientName}, notes:{p.visit.notes ?? "none"}, written:{written}
          {p.windowControls}
          <button onClick={() => setWritten((n) => n + 1)}>Write a note</button>
          <button onClick={() => p.onOpenAgreement("a-1")}>The agreement</button>
          <button onClick={() => p.onChanged?.()}>Book the visit</button>
          <button onClick={p.onClose}>Close the visit</button>
        </div>
      );
    },
  };
});
jest.mock("@/components/workboard/board/agreement-sheet", () => ({
  AgreementSheet: (p: { agreement: { label: string }; windowControls?: React.ReactNode; onClose: () => void }) => (
    <div role="dialog" aria-label={`Agreement ${p.agreement.label}`}>
      {p.windowControls}
      <button onClick={p.onClose}>Close the agreement</button>
    </div>
  ),
}));

/** A visit's card as the board hands it. */
const visitCard = (
  id: string,
  label = "Quarterly service",
  clientName: string | null = "Bayview Apartments",
  over: Record<string, unknown> = {},
) => ({
  kind: "visit",
  card: {
    visit: {
      id,
      agreementId: "a-1",
      label,
      clientName,
      status: "upcoming",
      dueDate: "2026-10-20",
      readiness: { equipment_ready: false, access_confirmed: false },
      techs: [],
      mirrorStatus: null,
      bookedDate: null,
      ...over,
    },
    today: "2026-10-11",
    staff: [],
    tagPool: [],
    connected: true,
    history: [],
    lastDone: null,
    siteAddress: null,
    siteRequirements: null,
    equipment: [],
  },
});

const agreementCard = (id = "a-1", label = "Bayview HVAC") => ({
  kind: "agreement",
  card: { agreement: { id, label, clientName: "Bayview Apartments" }, today: "2026-10-11", categories: [], tagPool: [] },
});

/** The board holds this visit, and answers for it at once. */
function hold(id: string, label?: string, clientName?: string | null) {
  board.set(`visit.${id}`, visitCard(id, label, clientName));
}

async function answer(key: string, body: unknown) {
  await act(async () => asks.get(key)!.resolve(body));
}

function Door({
  kind = "visit",
  id,
  opts,
  label = "Open",
}: {
  kind?: RecordKind;
  id: string;
  opts?: OpenRecordOptions;
  label?: string;
}) {
  const records = useRecords();
  return <button onClick={() => records.open({ kind, id }, opts)}>{label}</button>;
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <RecordsProvider>
      <main>{children}</main>
      <RecordDock />
      <RecordWindows manage />
    </RecordsProvider>
  );
}

const dock = () => screen.queryByRole("navigation", { name: "Set aside" });

const card = () => screen.queryByRole("dialog");

const visit = (label = "Quarterly service") => screen.findByRole("dialog", { name: `Visit ${label}` });

beforeEach(() => {
  openMaintenanceCard.mockReset();
  openMaintenanceCard.mockImplementation(readBoard);
  asks.clear();
  board.clear();
  mockPush.mockClear();
  mockReplace.mockClear();
  mockPath = "/dashboard/assets";
  window.history.replaceState(null, "", "/dashboard/assets?v=v1");
});

describe("a door", () => {
  it("opens the visit over the screen without going anywhere, and the address names it", async () => {
    const user = userEvent.setup();
    hold("v-7");
    render(
      <Frame>
        <h1>Assets</h1>
        <Door id="v-7" />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(await visit()).toHaveTextContent("Bayview Apartments");
    expect(openMaintenanceCard).toHaveBeenCalledWith("visit", "v-7");
    expect(screen.getByRole("heading", { name: "Assets" })).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/dashboard/assets");
    expect(window.location.search).toBe("?v=v1&open=visit.v-7");
  });

  it("opens nothing until the board answers", async () => {
    const user = userEvent.setup();
    render(
      <Frame>
        <Door id="v-7" />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(card()).toBeNull();
    expect(window.location.search).toBe("?v=v1");
    await answer("visit.v-7", visitCard("v-7"));
    expect(screen.getByRole("dialog", { name: "Visit Quarterly service" })).toBeInTheDocument();
  });

  it("lets the last ask win: an earlier answer arriving late opens nothing over it", async () => {
    const user = userEvent.setup();
    render(
      <Frame>
        <Door id="v-1" label="First" />
        <Door id="v-2" label="Second" />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "First" }));
    await user.click(screen.getByRole("button", { name: "Second" }));
    await answer("visit.v-2", visitCard("v-2", "Annual service"));
    await answer("visit.v-1", visitCard("v-1"));
    expect(screen.getByRole("dialog", { name: "Visit Annual service" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Visit Quarterly service" })).toBeNull();
    expect(window.location.search).toBe("?v=v1&open=visit.v-2");
  });

  it("keeps one card: a second door replaces the first", async () => {
    const user = userEvent.setup();
    hold("v-1");
    board.set("agreement.a-1", agreementCard());
    render(
      <Frame>
        <Door id="v-1" label="First" />
        <Door kind="agreement" id="a-1" label="Second" />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "First" }));
    await visit();
    await user.click(screen.getByRole("button", { name: "Second" }));
    expect(await screen.findByRole("dialog", { name: "Agreement Bayview HVAC" })).toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(window.location.search).toBe("?v=v1&open=agreement.a-1");
  });

  it("says so when a read fails, and opens nothing", async () => {
    const user = userEvent.setup();
    openMaintenanceCard.mockRejectedValue(new Error("offline"));
    render(
      <Frame>
        <Door id="v-7" />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Could not open that visit");
    expect(card()).toBeNull();
    expect(window.location.search).toBe("?v=v1");
  });
});

describe("a door to a job", () => {
  it("goes to the job's page, on the section it came for, and opens nothing over the screen", async () => {
    const user = userEvent.setup();
    render(
      <Frame>
        <Door kind="job" id="j1" opts={{ tab: "quote" }} />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(mockPush).toHaveBeenCalledWith("/dashboard/jobs/j1?tab=quote");
    expect(mockReplace).not.toHaveBeenCalled();
    expect(openMaintenanceCard).not.toHaveBeenCalled();
    expect(card()).toBeNull();
    expect(window.location.search).toBe("?v=v1");
  });

  it("goes to the job's Overview when the door names no section", async () => {
    const user = userEvent.setup();
    render(
      <Frame>
        <Door kind="job" id="j1" />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(mockPush).toHaveBeenCalledWith("/dashboard/jobs/j1");
  });

  it("is the last ask: a visit still being read when you leave for a job opens nothing", async () => {
    const user = userEvent.setup();
    render(
      <Frame>
        <Door id="v-7" label="The visit" />
        <Door kind="job" id="j1" label="The job" />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "The visit" }));
    await user.click(screen.getByRole("button", { name: "The job" }));
    await answer("visit.v-7", visitCard("v-7"));
    expect(card()).toBeNull();
    expect(window.location.search).toBe("?v=v1");
    expect(mockPush).toHaveBeenCalledWith("/dashboard/jobs/j1");
  });

  it("has no Set aside, Next job or dock of its own: nothing of a job is held", async () => {
    const user = userEvent.setup();
    render(
      <Frame>
        <Door kind="job" id="j1" />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.queryByRole("button", { name: "Set aside" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next job" })).toBeNull();
    expect(dock()).toBeNull();
  });
});

describe("closing", () => {
  it("takes the address's entry back off and gives focus to the door", async () => {
    const user = userEvent.setup();
    hold("v-7");
    render(
      <Frame>
        <Door id="v-7" />
      </Frame>,
    );
    const door = screen.getByRole("button", { name: "Open" });
    await user.click(door);
    await visit();
    const depth = window.history.length;
    await user.click(screen.getByRole("button", { name: "Close the visit" }));
    expect(card()).toBeNull();
    await waitFor(() => expect(window.location.search).toBe("?v=v1"));
    expect(window.history.length).toBe(depth);
    expect(document.activeElement).toBe(door);
  });

  it("Back closes it, and Forward opens it again", async () => {
    const user = userEvent.setup();
    hold("v-7");
    render(
      <Frame>
        <Door id="v-7" />
      </Frame>,
    );
    const door = screen.getByRole("button", { name: "Open" });
    await user.click(door);
    await visit();
    act(() => window.history.back());
    await waitFor(() => expect(card()).toBeNull());
    expect(window.location.search).toBe("?v=v1");
    expect(document.activeElement).toBe(door);

    act(() => window.history.forward());
    expect(await visit()).toBeInTheDocument();
    expect(openMaintenanceCard).toHaveBeenCalledTimes(2);
    expect(window.location.search).toBe("?v=v1&open=visit.v-7");
  });

  it("a close while the board is still being asked opens nothing after it", async () => {
    const user = userEvent.setup();
    hold("v-1");
    render(
      <Frame>
        <Door id="v-1" label="First" />
        <Door id="v-2" label="Second" />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "First" }));
    await visit();
    await user.click(screen.getByRole("button", { name: "Second" }));
    await user.click(screen.getByRole("button", { name: "Close the visit" }));
    await answer("visit.v-2", visitCard("v-2", "Annual service"));
    expect(card()).toBeNull();
  });
});

describe("a refresh, or a copied link", () => {
  it("brings the record back over the same screen, and closing it drops it from the address", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/dashboard/assets?v=v1&open=visit.v-9");
    const depth = window.history.length;
    render(
      <Frame>
        <h1>Assets</h1>
      </Frame>,
    );
    expect(openMaintenanceCard).toHaveBeenCalledWith("visit", "v-9");
    await answer("visit.v-9", visitCard("v-9", "Annual service"));
    expect(screen.getByRole("dialog", { name: "Visit Annual service" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Assets" })).toBeInTheDocument();
    expect(window.history.length).toBe(depth);

    await user.click(screen.getByRole("button", { name: "Close the visit" }));
    expect(card()).toBeNull();
    // not Back: the entry before this one is not ours to take
    expect(window.location.search).toBe("?v=v1");
    expect(window.history.length).toBe(depth);
  });

  it("brings an agreement back too", async () => {
    board.set("agreement.a-1", agreementCard());
    window.history.replaceState(null, "", "/dashboard/jobs?open=agreement.a-1");
    mockPath = "/dashboard/jobs";
    render(<Frame>{null}</Frame>);
    expect(await screen.findByRole("dialog", { name: "Agreement Bayview HVAC" })).toBeInTheDocument();
    expect(openMaintenanceCard).toHaveBeenCalledWith("agreement", "a-1");
  });

  it("replaces an address naming a job with the job's page, rather than pushing it", () => {
    window.history.replaceState(null, "", "/dashboard/assets?v=v1&open=job.j9");
    render(<Frame>{null}</Frame>);
    expect(mockReplace).toHaveBeenCalledWith("/dashboard/jobs/j9");
    expect(mockPush).not.toHaveBeenCalled();
    expect(openMaintenanceCard).not.toHaveBeenCalled();
    expect(card()).toBeNull();
  });

  it("replaces a job's address that Back lands on with the job's page", async () => {
    window.history.pushState(null, "", "/dashboard/assets?v=v1&open=job.j2");
    window.history.pushState(null, "", "/dashboard/assets?v=v1");
    render(<Frame>{null}</Frame>);
    expect(mockReplace).not.toHaveBeenCalled();
    act(() => window.history.back());
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/dashboard/jobs/j2"));
    expect(mockPush).not.toHaveBeenCalled();
    expect(card()).toBeNull();
  });

  it("ignores an address naming something the host cannot open", () => {
    window.history.replaceState(null, "", "/dashboard/assets?open=project.p-1");
    render(<Frame>{null}</Frame>);
    expect(openMaintenanceCard).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe("going somewhere else", () => {
  it("puts it away, and coming back by another road does not bring it back", async () => {
    const user = userEvent.setup();
    hold("v-7");
    const { rerender } = render(
      <Frame>
        <Door id="v-7" />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    await visit();

    mockPath = "/dashboard/workboard";
    window.history.pushState(null, "", "/dashboard/workboard");
    rerender(
      <Frame>
        <Door id="v-7" />
      </Frame>,
    );
    expect(card()).toBeNull();

    mockPath = "/dashboard/assets";
    window.history.pushState(null, "", "/dashboard/assets?v=v1");
    rerender(
      <Frame>
        <Door id="v-7" />
      </Frame>,
    );
    expect(card()).toBeNull();
  });

  it("an answer that lands after you went opens nothing on the new screen", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <Frame>
        <Door id="v-7" />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    mockPath = "/dashboard/workboard";
    window.history.pushState(null, "", "/dashboard/workboard");
    rerender(
      <Frame>
        <Door id="v-7" />
      </Frame>,
    );
    await answer("visit.v-7", visitCard("v-7"));
    expect(card()).toBeNull();
    expect(window.location.search).toBe("");
  });
});

describe("a RecordLink", () => {
  /* What the browser would do with a click nobody took: jsdom cannot
     navigate, so the page takes it after every handler has had its say,
     and notes whether anyone took it first. */
  let taken: boolean[] = [];
  const leave = (e: MouseEvent) => {
    taken.push(e.defaultPrevented);
    e.preventDefault();
  };
  beforeEach(() => {
    taken = [];
    document.addEventListener("click", leave);
  });
  afterEach(() => document.removeEventListener("click", leave));

  /** A host that only notes what it is asked to open. */
  function Spy({ open, children }: { open: jest.Mock; children: ReactNode }) {
    return <RecordsContext.Provider value={{ hosted: true, open }}>{children}</RecordsContext.Provider>;
  }

  it("leaves a job's link to Next: the host is not asked, and the click is not taken", () => {
    const open = jest.fn();
    render(
      <Spy open={open}>
        <RecordLink href="/dashboard/workboard?job=j1&face=quote">Job 1042</RecordLink>
      </Spy>,
    );
    const link = screen.getByRole("link", { name: "Job 1042" });
    expect(link).toHaveAttribute("href", "/dashboard/workboard?job=j1&face=quote");
    fireEvent.click(link);
    expect(open).not.toHaveBeenCalled();
    expect(taken).toEqual([false]);
  });

  it("opens nothing over the screen for a job's link in the frame's host", () => {
    render(
      <Frame>
        <RecordLink href="/dashboard/workboard?job=j1">Job 1042</RecordLink>
        <RecordLink href="/dashboard/assets?open=job.j1">Job 1042 by its token</RecordLink>
      </Frame>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Job 1042" }));
    fireEvent.click(screen.getByRole("link", { name: "Job 1042 by its token" }));
    expect(taken).toEqual([false, false]);
    expect(openMaintenanceCard).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(card()).toBeNull();
  });

  it("asks the host for a visit's link, and takes the click", () => {
    const open = jest.fn();
    render(
      <Spy open={open}>
        <RecordLink href="/dashboard/workboard?visit=v-7">Quarterly service</RecordLink>
      </Spy>,
    );
    const link = screen.getByRole("link", { name: "Quarterly service" });
    fireEvent.click(link);
    expect(open).toHaveBeenCalledWith({ kind: "visit", id: "v-7" }, { from: link });
    expect(taken).toEqual([true]);
  });

  it("opens a visit's link over the screen, and keeps the real address to copy", async () => {
    const user = userEvent.setup();
    hold("v-7");
    render(
      <Frame>
        <RecordLink href="/dashboard/workboard?visit=v-7">Quarterly service</RecordLink>
      </Frame>,
    );
    const link = screen.getByRole("link", { name: "Quarterly service" });
    expect(link).toHaveAttribute("href", "/dashboard/workboard?visit=v-7");
    await user.click(link);
    expect(await visit()).toBeInTheDocument();
    expect(window.location.pathname).toBe("/dashboard/assets");

    await user.click(screen.getByRole("button", { name: "Close the visit" }));
    expect(document.activeElement).toBe(link);
  });

  it("leaves a ⌘-click, a middle click or another tab to the browser", () => {
    render(
      <Frame>
        <RecordLink href="/dashboard/workboard?visit=v-7">Quarterly service</RecordLink>
        <RecordLink href="/dashboard/workboard?visit=v-8" target="_blank">
          Annual service
        </RecordLink>
      </Frame>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Quarterly service" }), { metaKey: true });
    fireEvent.click(screen.getByRole("link", { name: "Quarterly service" }), { ctrlKey: true });
    fireEvent.click(screen.getByRole("link", { name: "Quarterly service" }), { button: 1 });
    fireEvent.click(screen.getByRole("link", { name: "Annual service" }));
    expect(openMaintenanceCard).not.toHaveBeenCalled();
  });

  it("is only a link when the address is not a record's", () => {
    render(
      <Frame>
        <RecordLink href="/dashboard/workboard?visit=v-7&q=pump">Search</RecordLink>
        <RecordLink href="/dashboard/assets?v=v2">Van</RecordLink>
      </Frame>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Search" }));
    fireEvent.click(screen.getByRole("link", { name: "Van" }));
    expect(openMaintenanceCard).not.toHaveBeenCalled();
    expect(taken).toEqual([false, false]);
  });

  it("is only a link outside a host", () => {
    render(<RecordLink href="/dashboard/workboard?visit=v-7">Quarterly service</RecordLink>);
    fireEvent.click(screen.getByRole("link", { name: "Quarterly service" }));
    expect(openMaintenanceCard).not.toHaveBeenCalled();
    expect(taken).toEqual([false]);
  });

  it("gives focus, on close, to where the door says when the link will be gone", async () => {
    const user = userEvent.setup();
    hold("v-7");
    render(
      <Frame>
        <button>Bell</button>
        <RecordLink href="/dashboard/workboard?visit=v-7" returnFocus={() => screen.getByRole("button", { name: "Bell" })}>
          Quarterly service
        </RecordLink>
      </Frame>,
    );
    await user.click(screen.getByRole("link", { name: "Quarterly service" }));
    await visit();
    await user.click(screen.getByRole("button", { name: "Close the visit" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Bell" }));
  });
});

describe("set aside", () => {
  it("puts the card in the dock, lets the address go, and brings it back as it was left", async () => {
    const user = userEvent.setup();
    hold("v-7");
    render(
      <Frame>
        <Door id="v-7" />
      </Frame>,
    );
    const door = screen.getByRole("button", { name: "Open" });
    await user.click(door);
    await visit();
    await user.click(screen.getByRole("button", { name: "Write a note" }));
    await user.click(screen.getByRole("button", { name: "Set aside" }));

    expect(card()).toBeNull();
    expect(document.activeElement).toBe(door);
    await waitFor(() => expect(window.location.search).toBe("?v=v1"));
    const waiting = within(dock()!).getByRole("button", { name: "Quarterly service Bayview Apartments" });

    await user.click(waiting);
    expect(screen.getByRole("dialog", { name: "Visit Quarterly service" })).toHaveTextContent("written:1");
    expect(openMaintenanceCard).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe("?v=v1&open=visit.v-7");
    expect(dock()).toBeNull();
  });

  it("goes with you to another screen, where the card in front does not", async () => {
    const user = userEvent.setup();
    hold("v-1");
    hold("v-2", "Annual service", "Coogee Strata");
    const { rerender } = render(
      <Frame>
        <Door id="v-1" label="First" />
        <Door id="v-2" label="Second" />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "First" }));
    await user.click(await screen.findByRole("button", { name: "Set aside" }));
    await user.click(screen.getByRole("button", { name: "Second" }));
    await visit("Annual service");

    mockPath = "/dashboard/workboard";
    window.history.pushState(null, "", "/dashboard/workboard");
    rerender(
      <Frame>
        <h1>Workboard</h1>
      </Frame>,
    );
    expect(card()).toBeNull();
    expect(within(dock()!).getAllByRole("button", { name: /^Close / })).toHaveLength(1);

    await user.click(within(dock()!).getByRole("button", { name: "Quarterly service Bayview Apartments" }));
    expect(screen.getByRole("dialog", { name: "Visit Quarterly service" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Workboard" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/dashboard/workboard");
  });

  it(`keeps ${DOCK_MAX}, and lets the oldest go for a fourth`, async () => {
    const user = userEvent.setup();
    const ids = ["v-1", "v-2", "v-3", "v-4"];
    ids.forEach((id, i) => hold(id, `Service ${i + 1}`, null));
    render(
      <Frame>
        {ids.map((id) => (
          <Door key={id} id={id} label={`Open ${id}`} />
        ))}
      </Frame>,
    );
    for (const id of ids) {
      await user.click(screen.getByRole("button", { name: `Open ${id}` }));
      await user.click(await screen.findByRole("button", { name: "Set aside" }));
    }
    const names = within(dock()!)
      .getAllByRole("button", { name: /^Service \d+$/ })
      .map((b) => b.textContent);
    expect(names).toEqual(["Service 2", "Service 3", "Service 4"]);
  });

  it("a card in the dock can be let go", async () => {
    const user = userEvent.setup();
    hold("v-7");
    render(
      <Frame>
        <Door id="v-7" />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.click(await screen.findByRole("button", { name: "Set aside" }));
    await user.click(screen.getByRole("button", { name: "Close Quarterly service" }));
    expect(dock()).toBeNull();
    expect(card()).toBeNull();
  });

  it("opening a card that waits in the dock brings that one back, not a second", async () => {
    const user = userEvent.setup();
    hold("v-7");
    render(
      <Frame>
        <Door id="v-7" label="Open here" />
        <Door id="v-7" label="Open from elsewhere" />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "Open here" }));
    await visit();
    await user.click(screen.getByRole("button", { name: "Write a note" }));
    await user.click(screen.getByRole("button", { name: "Set aside" }));
    await user.click(screen.getByRole("button", { name: "Open from elsewhere" }));
    expect(openMaintenanceCard).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Visit Quarterly service" })).toHaveTextContent("written:1");
  });

  it("is not offered by a host drawn inside a page, which has no dock", async () => {
    const user = userEvent.setup();
    hold("v-7");
    render(
      <PageRecordsProvider>
        <Door id="v-7" />
        <RecordWindows manage />
      </PageRecordsProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(await visit()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Set aside" })).toBeNull();
  });
});

describe("what the palette reads", () => {
  function Recent() {
    const host = useContext(WindowsContext);
    return <output aria-label="recent">{host?.recent.map((r) => r.title).join(", ") || "none"}</output>;
  }
  function Forget() {
    const records = useRecords();
    return <button onClick={() => records.forget?.()}>Switch workspace</button>;
  }

  it("keeps the records opened lately, newest first, once each", async () => {
    const user = userEvent.setup();
    hold("v-1");
    hold("v-2", "Annual service");
    render(
      <Frame>
        <Recent />
        <Door id="v-1" label="First" />
        <Door id="v-2" label="Second" />
      </Frame>,
    );
    expect(screen.getByRole("status", { name: "recent" })).toHaveTextContent("none");
    await user.click(screen.getByRole("button", { name: "First" }));
    await visit();
    await user.click(screen.getByRole("button", { name: "Second" }));
    await visit("Annual service");
    await user.click(screen.getByRole("button", { name: "First" }));
    await visit();
    expect(screen.getByRole("status", { name: "recent" })).toHaveTextContent("Quarterly service, Annual service");
  });

  it("lets every card go, the dock's and the recent list with them, on a switch of workspace", async () => {
    const user = userEvent.setup();
    hold("v-1");
    hold("v-2", "Annual service");
    render(
      <Frame>
        <Recent />
        <Forget />
        <Door id="v-1" label="First" />
        <Door id="v-2" label="Second" />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "First" }));
    await user.click(await screen.findByRole("button", { name: "Set aside" }));
    await user.click(screen.getByRole("button", { name: "Second" }));
    await visit("Annual service");
    await user.click(screen.getByRole("button", { name: "Switch workspace" }));
    expect(card()).toBeNull();
    expect(dock()).toBeNull();
    expect(screen.getByRole("status", { name: "recent" })).toHaveTextContent("none");
  });
});

describe("a maintenance visit", () => {
  const leave = (e: MouseEvent) => e.preventDefault();

  it("opens over the screen from its link, read off the board, and the address names it", async () => {
    const user = userEvent.setup();
    openMaintenanceCard.mockResolvedValue(visitCard("v-7"));
    document.addEventListener("click", leave);
    render(
      <Frame>
        <RecordLink href="/dashboard/workboard?visit=v-7">Quarterly service</RecordLink>
      </Frame>,
    );
    await user.click(screen.getByRole("link", { name: "Quarterly service" }));
    document.removeEventListener("click", leave);
    expect(openMaintenanceCard).toHaveBeenCalledWith("visit", "v-7");
    expect(await screen.findByRole("dialog", { name: "Visit Quarterly service" })).toHaveTextContent("Bayview Apartments");
    expect(window.location.search).toBe("?v=v1&open=visit.v-7");
  });

  it("says so when the board no longer holds it", async () => {
    const user = userEvent.setup();
    openMaintenanceCard.mockResolvedValue(null);
    render(
      <Frame>
        <VisitDoor />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "Open the visit" }));
    expect(await screen.findByRole("status")).toHaveTextContent("That visit isn't on the board any more.");
    expect(card()).toBeNull();
  });

  it("is read again after a press changes it", async () => {
    const user = userEvent.setup();
    openMaintenanceCard
      .mockResolvedValueOnce(visitCard("v-7"))
      .mockResolvedValueOnce(visitCard("v-7", undefined, undefined, { notes: "booked" }));
    render(
      <Frame>
        <VisitDoor />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "Open the visit" }));
    await user.click(await screen.findByRole("button", { name: "Book the visit" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Visit Quarterly service" })).toHaveTextContent("notes:booked"));
    expect(openMaintenanceCard).toHaveBeenCalledTimes(2);
  });

  it("opens its agreement in its place, and can be set aside under its own name", async () => {
    const user = userEvent.setup();
    openMaintenanceCard.mockResolvedValueOnce(visitCard("v-7")).mockResolvedValueOnce(agreementCard());
    render(
      <Frame>
        <VisitDoor />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "Open the visit" }));
    await user.click(await screen.findByRole("button", { name: "Set aside" }));
    expect(within(dock()!).getByRole("button", { name: "Quarterly service Bayview Apartments" })).toBeInTheDocument();
    await user.click(within(dock()!).getByRole("button", { name: "Quarterly service Bayview Apartments" }));
    await user.click(await screen.findByRole("button", { name: "The agreement" }));
    expect(await screen.findByRole("dialog", { name: "Agreement Bayview HVAC" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Visit Quarterly service" })).toBeNull();
    expect(openMaintenanceCard).toHaveBeenLastCalledWith("agreement", "a-1");
  });
});

function VisitDoor() {
  const records = useRecords();
  return <button onClick={() => records.open({ kind: "visit", id: "v-7" })}>Open the visit</button>;
}
