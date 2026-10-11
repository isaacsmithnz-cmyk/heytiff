import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { RecordsProvider, useRecords, type OpenRecordOptions } from "../record-host";
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
jest.mock("@/components/workboard/board/job-sheet", () => ({
  JobSheet: (p: {
    row: { id: string; number: string | null; clientName: string | null };
    initialTab?: string;
    onClose: () => void;
    onOpenTracked: (t: { kind: "visit" | "project"; label: string; id: string }) => void;
  }) => (
    <div role="dialog" aria-label={`Job ${p.row.number ?? ""}`}>
      {p.row.clientName}, tab:{p.initialTab ?? "summary"}
      <button onClick={p.onClose}>Close the card</button>
      <button onClick={() => p.onOpenTracked({ kind: "project", label: "Fit-out", id: "p-3" })}>
        On the projects board
      </button>
    </div>
  ),
}));
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
      <RecordWindows manage moneyVisible={false} />
    </RecordsProvider>
  );
}

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
