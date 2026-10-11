import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useContext, type ReactNode } from "react";
import { DOCK_MAX, PageRecordsProvider, RecordsProvider, useRecords, type OpenRecordOptions } from "../record-host";
import { RecordDock } from "../record-dock";
import { WindowsContext } from "../records-context";
import { RecordLink } from "../record-link";
import { RecordWindows } from "../record-windows";
import type { AllJobRow } from "@/lib/workboard/all-jobs";

/* THE APP'S RECORD HOST. Mounted once in the dashboard layout, above the
   outlet: a job opens OVER the screen you are on, the address carries it
   so Back closes it and a refresh brings it back, and going somewhere else
   puts it away. This suite pins that contract; the card is the board's own
   component with its own suite, so here it is a window that prints what it
   was opened on. The mirror read is a server action, and "use server"
   modules cannot be imported into jsdom. */

let mockPath = "/dashboard/assets";
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  usePathname: () => mockPath,
  useRouter: () => ({ refresh: jest.fn(), push: (...a: unknown[]) => mockPush(...a) }),
}));
/* The card is on the overlay stack as the real one is, carries the window's
   controls where the real one does, and keeps a little state of its own, so
   a card set aside can be seen to come back as it was left. */
jest.mock("@/components/workboard/board/job-sheet", () => {
  const { useRef, useState } = jest.requireActual<typeof import("react")>("react");
  const { useOverlay } = jest.requireActual<typeof import("@/components/overlay/use-overlay")>(
    "@/components/overlay/use-overlay",
  );
  return {
    JobSheet: function JobSheet(p: {
      row: { id: string; number: string | null; clientName: string | null };
      initialTab?: string;
      windowControls?: React.ReactNode;
      onClose: () => void;
      onOpenTracked: (t: { kind: "visit" | "project"; label: string; id: string }) => void;
    }) {
      const ref = useRef<HTMLDivElement>(null);
      useOverlay(ref, { onEscape: p.onClose });
      const [notes, setNotes] = useState(0);
      return (
        <div ref={ref} role="dialog" aria-modal="true" aria-label={`Job ${p.row.number ?? ""}`}>
          {p.row.clientName}, tab:{p.initialTab ?? "summary"}, notes:{notes}
          {p.windowControls}
          <button onClick={() => setNotes((n) => n + 1)}>Write a note</button>
          <button onClick={p.onClose}>Close the card</button>
          <button onClick={() => p.onOpenTracked({ kind: "project", label: "Fit-out", id: "p-3" })}>
            On the projects board
          </button>
        </div>
      );
    },
  };
});
type Answer = { resolve: (row: AllJobRow | null) => void; reject: (e: unknown) => void };
const asks = new Map<string, Answer>();
const openMirrorJob = jest.fn(
  (uuid: string) =>
    new Promise<AllJobRow | null>((resolve, reject) => {
      asks.set(uuid, { resolve, reject });
    }),
);
jest.mock("@/app/actions/workboard", () => ({
  openMirrorJob: (uuid: string) => openMirrorJob(uuid),
}));

const row = (over: Partial<AllJobRow> = {}): AllJobRow =>
  ({ id: "j1", number: "1042", clientName: "Bayview Apartments", ...over }) as AllJobRow;

async function answer(uuid: string, with_: AllJobRow | null) {
  await act(async () => asks.get(uuid)!.resolve(with_));
}

function Door({ id, row: held, opts, label = "Open" }: { id: string; row?: AllJobRow; opts?: OpenRecordOptions; label?: string }) {
  const records = useRecords();
  return <button onClick={() => records.open({ kind: "job", id }, { ...opts, ...(held ? { row: held } : {}) })}>{label}</button>;
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <RecordsProvider>
      <main>{children}</main>
      <RecordDock />
      <RecordWindows manage moneyVisible={false} />
    </RecordsProvider>
  );
}

const dock = () => screen.queryByRole("navigation", { name: "Set aside" });

const card = () => screen.queryByRole("dialog");

beforeEach(() => {
  asks.clear();
  openMirrorJob.mockClear();
  mockPush.mockClear();
  mockPath = "/dashboard/assets";
  window.history.replaceState(null, "", "/dashboard/assets?v=v1");
});

describe("a door", () => {
  it("opens the job over the screen without going anywhere, and the address names it", async () => {
    const user = userEvent.setup();
    render(
      <Frame>
        <h1>Assets</h1>
        <Door id="j1" row={row()} />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("dialog", { name: "Job 1042" })).toHaveTextContent("Bayview Apartments");
    expect(screen.getByRole("heading", { name: "Assets" })).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
    expect(openMirrorJob).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/dashboard/assets");
    expect(window.location.search).toBe("?v=v1&open=job.j1");
  });

  it("asks the mirror for a job it knows only by uuid, on the face it came for", async () => {
    const user = userEvent.setup();
    render(
      <Frame>
        <Door id="j1" opts={{ tab: "quote" }} />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(openMirrorJob).toHaveBeenCalledWith("j1");
    expect(card()).toBeNull();
    await answer("j1", row());
    expect(screen.getByRole("dialog", { name: "Job 1042" })).toHaveTextContent("tab:quote");
  });

  it("says so when the job has left the mirror, and opens nothing", async () => {
    const user = userEvent.setup();
    render(
      <Frame>
        <Door id="j1" />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    await answer("j1", null);
    expect(card()).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("That job isn't in ServiceM8's copy any more.");
    expect(window.location.search).toBe("?v=v1");
  });

  it("lets the last ask win: an earlier answer arriving late opens nothing over it", async () => {
    const user = userEvent.setup();
    render(
      <Frame>
        <Door id="j1" label="First" />
        <Door id="j2" label="Second" />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "First" }));
    await user.click(screen.getByRole("button", { name: "Second" }));
    await answer("j2", row({ id: "j2", number: "2002" }));
    await answer("j1", row());
    expect(screen.getByRole("dialog", { name: "Job 2002" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Job 1042" })).toBeNull();
    expect(window.location.search).toBe("?v=v1&open=job.j2");
  });

  it("keeps one card: a second door replaces the first", async () => {
    const user = userEvent.setup();
    render(
      <Frame>
        <Door id="j1" row={row()} label="First" />
        <Door id="j2" row={row({ id: "j2", number: "2002" })} label="Second" />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "First" }));
    await user.click(screen.getByRole("button", { name: "Second" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Job 2002" })).toBeInTheDocument();
  });
});

describe("closing", () => {
  it("takes the address's entry back off and gives focus to the door", async () => {
    const user = userEvent.setup();
    render(
      <Frame>
        <Door id="j1" row={row()} />
      </Frame>,
    );
    const door = screen.getByRole("button", { name: "Open" });
    await user.click(door);
    const depth = window.history.length;
    await user.click(screen.getByRole("button", { name: "Close the card" }));
    expect(card()).toBeNull();
    await waitFor(() => expect(window.location.search).toBe("?v=v1"));
    expect(window.history.length).toBe(depth);
    expect(document.activeElement).toBe(door);
  });

  it("Back closes it, and Forward opens it again", async () => {
    const user = userEvent.setup();
    render(
      <Frame>
        <Door id="j1" row={row()} />
      </Frame>,
    );
    const door = screen.getByRole("button", { name: "Open" });
    await user.click(door);
    act(() => window.history.back());
    await waitFor(() => expect(card()).toBeNull());
    expect(window.location.search).toBe("?v=v1");
    expect(document.activeElement).toBe(door);

    act(() => window.history.forward());
    await waitFor(() => expect(openMirrorJob).toHaveBeenCalledWith("j1"));
    await answer("j1", row());
    expect(screen.getByRole("dialog", { name: "Job 1042" })).toBeInTheDocument();
  });

  it("a close while the mirror is still being asked opens nothing after it", async () => {
    const user = userEvent.setup();
    render(
      <Frame>
        <Door id="j1" row={row()} label="First" />
        <Door id="j2" label="Second" />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "First" }));
    await user.click(screen.getByRole("button", { name: "Second" }));
    await user.click(screen.getByRole("button", { name: "Close the card" }));
    await answer("j2", row({ id: "j2", number: "2002" }));
    expect(card()).toBeNull();
  });
});

describe("a refresh, or a copied link", () => {
  it("brings the record back over the same screen, and closing it drops it from the address", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/dashboard/assets?v=v1&open=job.j9");
    const depth = window.history.length;
    render(
      <Frame>
        <h1>Assets</h1>
      </Frame>,
    );
    expect(openMirrorJob).toHaveBeenCalledWith("j9");
    await answer("j9", row({ id: "j9", number: "9009" }));
    expect(screen.getByRole("dialog", { name: "Job 9009" })).toBeInTheDocument();
    expect(window.history.length).toBe(depth);

    await user.click(screen.getByRole("button", { name: "Close the card" }));
    expect(card()).toBeNull();
    // not Back: the entry before this one is not ours to take
    expect(window.location.search).toBe("?v=v1");
    expect(window.history.length).toBe(depth);
  });

  it("ignores an address naming something the host cannot open", () => {
    window.history.replaceState(null, "", "/dashboard/assets?open=visit.v-1");
    render(<Frame>{null}</Frame>);
    expect(openMirrorJob).not.toHaveBeenCalled();
  });
});

describe("going somewhere else", () => {
  it("puts it away, and coming back by another road does not bring it back", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <Frame>
        <Door id="j1" row={row()} />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(card()).not.toBeNull();

    mockPath = "/dashboard/workboard";
    window.history.pushState(null, "", "/dashboard/workboard");
    rerender(
      <Frame>
        <Door id="j1" row={row()} />
      </Frame>,
    );
    expect(card()).toBeNull();

    mockPath = "/dashboard/assets";
    window.history.pushState(null, "", "/dashboard/assets?v=v1");
    rerender(
      <Frame>
        <Door id="j1" row={row()} />
      </Frame>,
    );
    expect(card()).toBeNull();
  });

  it("an answer that lands after you went opens nothing on the new screen", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <Frame>
        <Door id="j1" />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    mockPath = "/dashboard/workboard";
    window.history.pushState(null, "", "/dashboard/workboard");
    rerender(
      <Frame>
        <Door id="j1" />
      </Frame>,
    );
    await answer("j1", row());
    expect(card()).toBeNull();
    expect(window.location.search).toBe("");
  });

  it("a card's own door to another screen puts the card away first", async () => {
    const user = userEvent.setup();
    render(
      <Frame>
        <Door id="j1" row={row()} />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.click(screen.getByRole("button", { name: "On the projects board" }));
    expect(card()).toBeNull();
    expect(mockPush).toHaveBeenCalledWith("/dashboard/workboard/projects/p-3");
  });
});

describe("a RecordLink", () => {
  /* What the browser would do with a click nobody took: jsdom cannot
     navigate, so the page takes it after every handler has had its say. */
  const leave = (e: MouseEvent) => e.preventDefault();
  beforeEach(() => document.addEventListener("click", leave));
  afterEach(() => document.removeEventListener("click", leave));

  it("opens a job's link over the screen, on the face it names, and keeps the real address to copy", async () => {
    const user = userEvent.setup();
    render(
      <Frame>
        <RecordLink href="/dashboard/workboard?job=j1&face=quote">Job 1042</RecordLink>
      </Frame>,
    );
    const link = screen.getByRole("link", { name: "Job 1042" });
    expect(link).toHaveAttribute("href", "/dashboard/workboard?job=j1&face=quote");
    await user.click(link);
    expect(openMirrorJob).toHaveBeenCalledWith("j1");
    await answer("j1", row());
    expect(screen.getByRole("dialog", { name: "Job 1042" })).toHaveTextContent("tab:quote");
    expect(window.location.pathname).toBe("/dashboard/assets");

    await user.click(screen.getByRole("button", { name: "Close the card" }));
    expect(document.activeElement).toBe(link);
  });

  it("leaves a ⌘-click, a middle click or another tab to the browser", () => {
    render(
      <Frame>
        <RecordLink href="/dashboard/workboard?job=j1">Job 1042</RecordLink>
        <RecordLink href="/dashboard/workboard?job=j2" target="_blank">
          Job 2002
        </RecordLink>
      </Frame>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Job 1042" }), { metaKey: true });
    fireEvent.click(screen.getByRole("link", { name: "Job 1042" }), { ctrlKey: true });
    fireEvent.click(screen.getByRole("link", { name: "Job 1042" }), { button: 1 });
    fireEvent.click(screen.getByRole("link", { name: "Job 2002" }));
    expect(openMirrorJob).not.toHaveBeenCalled();
  });

  it("is only a link when the address is not a job's", () => {
    render(
      <Frame>
        <RecordLink href="/dashboard/workboard?job=j1&q=pump">Search</RecordLink>
        <RecordLink href="/dashboard/assets?v=v2">Van</RecordLink>
      </Frame>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Search" }));
    fireEvent.click(screen.getByRole("link", { name: "Van" }));
    expect(openMirrorJob).not.toHaveBeenCalled();
  });

  it("is only a link outside a host", () => {
    render(<RecordLink href="/dashboard/workboard?job=j1">Job 1042</RecordLink>);
    fireEvent.click(screen.getByRole("link", { name: "Job 1042" }));
    expect(openMirrorJob).not.toHaveBeenCalled();
  });

  it("gives focus, on close, to where the door says when the link will be gone", async () => {
    const user = userEvent.setup();
    render(
      <Frame>
        <button>Bell</button>
        <RecordLink href="/dashboard/workboard?job=j1" returnFocus={() => screen.getByRole("button", { name: "Bell" })}>
          Job 1042
        </RecordLink>
      </Frame>,
    );
    await user.click(screen.getByRole("link", { name: "Job 1042" }));
    await answer("j1", row());
    await user.click(screen.getByRole("button", { name: "Close the card" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Bell" }));
  });
});

describe("set aside", () => {
  it("puts the card in the dock, lets the address go, and brings it back as it was left", async () => {
    const user = userEvent.setup();
    render(
      <Frame>
        <Door id="j1" row={row()} />
      </Frame>,
    );
    const door = screen.getByRole("button", { name: "Open" });
    await user.click(door);
    await user.click(screen.getByRole("button", { name: "Write a note" }));
    await user.click(screen.getByRole("button", { name: "Set aside" }));

    expect(card()).toBeNull();
    expect(document.activeElement).toBe(door);
    await waitFor(() => expect(window.location.search).toBe("?v=v1"));
    const waiting = within(dock()!).getByRole("button", { name: "Job 1042 Bayview Apartments" });

    await user.click(waiting);
    expect(screen.getByRole("dialog", { name: "Job 1042" })).toHaveTextContent("notes:1");
    expect(openMirrorJob).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?v=v1&open=job.j1");
    expect(dock()).toBeNull();
  });

  it("goes with you to another screen, where the card in front does not", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <Frame>
        <Door id="j1" row={row()} label="First" />
        <Door id="j2" row={row({ id: "j2", number: "2002", clientName: "Coogee Strata" })} label="Second" />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "First" }));
    await user.click(screen.getByRole("button", { name: "Set aside" }));
    await user.click(screen.getByRole("button", { name: "Second" }));

    mockPath = "/dashboard/workboard";
    window.history.pushState(null, "", "/dashboard/workboard");
    rerender(
      <Frame>
        <h1>Workboard</h1>
      </Frame>,
    );
    expect(card()).toBeNull();
    expect(within(dock()!).getAllByRole("button", { name: /^Job/ })).toHaveLength(1);

    await user.click(within(dock()!).getByRole("button", { name: "Job 1042 Bayview Apartments" }));
    expect(screen.getByRole("dialog", { name: "Job 1042" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Workboard" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/dashboard/workboard");
  });

  it(`keeps ${DOCK_MAX}, and lets the oldest go for a fourth`, async () => {
    const user = userEvent.setup();
    const ids = ["j1", "j2", "j3", "j4"];
    render(
      <Frame>
        {ids.map((id, i) => (
          <Door key={id} id={id} row={row({ id, number: `10${i}`, clientName: null })} label={`Open ${id}`} />
        ))}
      </Frame>,
    );
    for (const id of ids) {
      await user.click(screen.getByRole("button", { name: `Open ${id}` }));
      await user.click(screen.getByRole("button", { name: "Set aside" }));
    }
    const names = within(dock()!)
      .getAllByRole("button", { name: /^Job \d+$/ })
      .map((b) => b.textContent);
    expect(names).toEqual(["Job 101", "Job 102", "Job 103"]);
  });

  it("a card in the dock can be let go", async () => {
    const user = userEvent.setup();
    render(
      <Frame>
        <Door id="j1" row={row()} />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.click(screen.getByRole("button", { name: "Set aside" }));
    await user.click(screen.getByRole("button", { name: "Close job 1042" }));
    expect(dock()).toBeNull();
    expect(card()).toBeNull();
  });

  it("opening a card that waits in the dock brings that one back, not a second", async () => {
    const user = userEvent.setup();
    render(
      <Frame>
        <Door id="j1" row={row()} label="Open with the row" />
        <Door id="j1" label="Open by id" />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "Open with the row" }));
    await user.click(screen.getByRole("button", { name: "Write a note" }));
    await user.click(screen.getByRole("button", { name: "Set aside" }));
    await user.click(screen.getByRole("button", { name: "Open by id" }));
    expect(openMirrorJob).not.toHaveBeenCalled();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Job 1042" })).toHaveTextContent("notes:1");
  });

  it("is not offered by a host drawn inside a page, which has no dock", async () => {
    const user = userEvent.setup();
    render(
      <PageRecordsProvider>
        <Door id="j1" row={row()} />
        <RecordWindows manage moneyVisible={false} />
      </PageRecordsProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("dialog", { name: "Job 1042" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Set aside" })).toBeNull();
  });
});

describe("Next job", () => {
  const LIST = ["j1", "j2", "j3"];

  it("steps through the list the door opened it from, in place, and Back still closes it", async () => {
    const user = userEvent.setup();
    render(
      <Frame>
        <Door id="j1" row={row()} opts={{ list: LIST }} />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    const depth = window.history.length;
    await user.click(screen.getByRole("button", { name: "Next job" }));
    expect(openMirrorJob).toHaveBeenCalledWith("j2");
    expect(window.location.search).toBe("?v=v1&open=job.j2");
    await answer("j2", row({ id: "j2", number: "2002" }));
    expect(screen.getByRole("dialog", { name: "Job 2002" })).toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(window.history.length).toBe(depth);

    act(() => window.history.back());
    await waitFor(() => expect(card()).toBeNull());
    expect(window.location.search).toBe("?v=v1");
  });

  it("walks with J and K while the card is in front, and not while typing", async () => {
    const user = userEvent.setup();
    render(
      <Frame>
        <input aria-label="Somewhere to type" />
        <Door id="j2" row={row({ id: "j2", number: "2002" })} opts={{ list: LIST }} />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Somewhere to type" }), { key: "j" });
    expect(openMirrorJob).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole("dialog", { name: "Job 2002" }), { key: "k" });
    expect(openMirrorJob).toHaveBeenCalledWith("j1");
    await answer("j1", row());
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Job 1042" }), { key: "j" });
    expect(openMirrorJob).toHaveBeenLastCalledWith("j2");
  });

  it("is not offered at the end of the list, or without one", async () => {
    const user = userEvent.setup();
    render(
      <Frame>
        <Door id="j3" row={row({ id: "j3", number: "3003" })} opts={{ list: LIST }} label="Last" />
        <Door id="j1" row={row()} label="Alone" />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "Last" }));
    expect(screen.queryByRole("button", { name: "Next job" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Alone" }));
    expect(screen.queryByRole("button", { name: "Next job" })).toBeNull();
  });

  it("comes with a RecordLink from a list of them, in the order they are shown", async () => {
    const user = userEvent.setup();
    document.addEventListener("click", leave);
    render(
      <Frame>
        <ul data-record-list>
          <li>
            <RecordLink href="/dashboard/workboard?job=j1">Job 1042</RecordLink>
          </li>
          <li>
            <RecordLink href="/dashboard/assets?v=v2">Van</RecordLink>
          </li>
          <li>
            <RecordLink href="/dashboard/workboard?job=j2">Job 2002</RecordLink>
          </li>
        </ul>
      </Frame>,
    );
    await user.click(screen.getByRole("link", { name: "Job 1042" }));
    await answer("j1", row());
    await user.click(screen.getByRole("button", { name: "Next job" }));
    expect(openMirrorJob).toHaveBeenLastCalledWith("j2");
    document.removeEventListener("click", leave);
  });
});

function leave(e: MouseEvent) {
  e.preventDefault();
}

describe("what the palette reads", () => {
  function Recent() {
    const host = useContext(WindowsContext);
    return <output aria-label="recent">{host?.recent.map((r) => r.number ?? r.id).join(" ") || "none"}</output>;
  }
  function Forget() {
    const records = useRecords();
    return <button onClick={() => records.forget?.()}>Switch workspace</button>;
  }

  it("keeps the jobs opened lately, newest first, once each", async () => {
    const user = userEvent.setup();
    render(
      <Frame>
        <Recent />
        <Door id="j1" row={row()} label="First" />
        <Door id="j2" row={row({ id: "j2", number: "2002" })} label="Second" />
      </Frame>,
    );
    expect(screen.getByRole("status", { name: "recent" })).toHaveTextContent("none");
    await user.click(screen.getByRole("button", { name: "First" }));
    await user.click(screen.getByRole("button", { name: "Second" }));
    await user.click(screen.getByRole("button", { name: "First" }));
    expect(screen.getByRole("status", { name: "recent" })).toHaveTextContent("1042 2002");
  });

  it("lets every card go, the dock's and the recent list with them, on a switch of workspace", async () => {
    const user = userEvent.setup();
    render(
      <Frame>
        <Recent />
        <Forget />
        <Door id="j1" row={row()} label="First" />
        <Door id="j2" row={row({ id: "j2", number: "2002" })} label="Second" />
      </Frame>,
    );
    await user.click(screen.getByRole("button", { name: "First" }));
    await user.click(screen.getByRole("button", { name: "Set aside" }));
    await user.click(screen.getByRole("button", { name: "Second" }));
    await user.click(screen.getByRole("button", { name: "Switch workspace" }));
    expect(card()).toBeNull();
    expect(dock()).toBeNull();
    expect(screen.getByRole("status", { name: "recent" })).toHaveTextContent("none");
  });
});
