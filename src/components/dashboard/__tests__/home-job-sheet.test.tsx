import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeskJobHost, useDeskJobs, type OpenJobOptions } from "../home-job-sheet";
import type { AllJobRow } from "@/lib/workboard/all-jobs";

/* THE NEW HOME'S ONE JOB CARD. Every door on the desk opens its job here,
   by the row it holds or by the job's uuid; this suite pins the host — one
   card, on the right row, on the face asked for, the last ask winning, and
   focus back where the press came from.

   The card is the board's own component with its own suite; here it is a
   window that prints what it was opened on. The mirror read is a server
   action, and "use server" modules cannot be imported into jsdom. */
const push = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn(), push: (...a: unknown[]) => push(...(a as [])) }),
}));
jest.mock("@/components/workboard/board/job-sheet", () => ({
  JobSheet: (p: {
    row: { id: string; number: string | null; clientName: string | null };
    manage: boolean;
    moneyVisible: boolean;
    initialTab?: string;
    scheduleState: { word: string } | null;
    onClose: () => void;
    onCreateAgreement: (row: { id: string }) => void;
    onToast: (m: string) => void;
  }) => (
    <div role="dialog" aria-label={`Job ${p.row.number ?? ""}`}>
      {p.row.clientName}, tab:{p.initialTab ?? "summary"}, state:{p.scheduleState?.word ?? "none"}, manage:
      {String(p.manage)}, money:{String(p.moneyVisible)}
      <button onClick={p.onClose}>Close the card</button>
      <button onClick={() => p.onCreateAgreement(p.row)}>Create an agreement from this job</button>
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

function Door({ job, opts, label = "Open" }: { job: AllJobRow | string; opts?: OpenJobOptions; label?: string }) {
  const { openJob } = useDeskJobs();
  return <button onClick={() => openJob(job, opts)}>{label}</button>;
}

const host = (doors: React.ReactNode, over: { manage?: boolean; moneyVisible?: boolean } = {}) =>
  render(
    <DeskJobHost manage={over.manage ?? true} moneyVisible={over.moneyVisible ?? false}>
      {doors}
    </DeskJobHost>,
  );

beforeEach(() => {
  asks.clear();
  openMirrorJob.mockClear();
  push.mockClear();
});

describe("a door with the row", () => {
  it("opens the card on that row, with the board's own grants", async () => {
    const user = userEvent.setup();
    host(<Door job={row()} />, { manage: true, moneyVisible: true });
    await user.click(screen.getByRole("button", { name: "Open" }));
    const card = screen.getByRole("dialog", { name: "Job 1042" });
    expect(card.textContent).toContain("Bayview Apartments");
    expect(card.textContent).toContain("manage:true");
    expect(card.textContent).toContain("money:true");
    expect(openMirrorJob).not.toHaveBeenCalled();
  });

  it("opens it on the face the door asked for, wearing the state it was handed", async () => {
    const user = userEvent.setup();
    host(<Door job={row()} opts={{ tab: "diary", state: { kind: "on", word: "Started" } }} />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    const card = screen.getByRole("dialog", { name: "Job 1042" });
    expect(card.textContent).toContain("tab:diary");
    expect(card.textContent).toContain("state:Started");
  });

  it("is ONE card: a second door replaces it rather than opening another", async () => {
    const user = userEvent.setup();
    host(
      <>
        <Door job={row()} label="First" />
        <Door job={row({ id: "j2", number: "1043", clientName: "Northgate" })} label="Second" />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "First" }));
    // the card is a modal in life; here nothing stops the second press
    await user.click(screen.getByRole("button", { name: "Second" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Job 1043" })).toBeInTheDocument();
  });

  it("puts focus back on the door that opened it", async () => {
    const user = userEvent.setup();
    host(<Door job={row()} />);
    const door = screen.getByRole("button", { name: "Open" });
    await user.click(door);
    await user.click(screen.getByRole("button", { name: "Close the card" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(door);
  });

  it("puts it back where the door says, when the door says", async () => {
    const user = userEvent.setup();
    const Named = () => {
      const { openJob } = useDeskJobs();
      return (
        <>
          <button id="pill">The booking</button>
          <button onClick={() => openJob(row(), { from: document.getElementById("pill") })}>Open</button>
        </>
      );
    };
    host(<Named />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.click(screen.getByRole("button", { name: "Close the card" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "The booking" }));
  });

  it("sends the agreement door to the board with the job in the URL", async () => {
    const user = userEvent.setup();
    host(<Door job={row()} />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.click(screen.getByRole("button", { name: "Create an agreement from this job" }));
    expect(push).toHaveBeenCalledWith("/dashboard/workboard?job=j1");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("a door with only the job's uuid", () => {
  it("asks the mirror for the board's row, then opens the card on it", async () => {
    const user = userEvent.setup();
    host(<Door job="j7" />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(openMirrorJob).toHaveBeenCalledWith("j7");
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => asks.get("j7")!.resolve(row({ id: "j7", number: "2051", clientName: "Mosman" })));
    expect(screen.getByRole("dialog", { name: "Job 2051" }).textContent).toContain("Mosman");
  });

  it("says so, and opens nothing, for a job the mirror does not hold", async () => {
    const user = userEvent.setup();
    host(<Door job="gone" />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    await act(async () => asks.get("gone")!.resolve(null));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("That job isn't in ServiceM8's copy any more.");
  });

  it("never opens a stale answer over a later ask", async () => {
    const user = userEvent.setup();
    host(
      <>
        <Door job="slow" label="Slow" />
        <Door job={row({ id: "j2", number: "1043", clientName: "Northgate" })} label="Held" />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Slow" }));
    await user.click(screen.getByRole("button", { name: "Held" }));
    await act(async () => asks.get("slow")!.resolve(row({ id: "slow", number: "9999", clientName: "Late answer" })));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Job 1043" })).toBeInTheDocument();
  });

  it("drops an answer that lands after the card was closed", async () => {
    const user = userEvent.setup();
    host(
      <>
        <Door job="slow" label="Slow" />
        <Door job={row()} label="Held" />
      </>,
    );
    // a card is open, a second is asked for, and the reader closes before it comes
    await user.click(screen.getByRole("button", { name: "Held" }));
    await user.click(screen.getByRole("button", { name: "Slow" }));
    await user.click(screen.getByRole("button", { name: "Close the card" }));
    await act(async () => asks.get("slow")!.resolve(row({ id: "slow", number: "9999" })));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

it("is the new Home's alone: asking for it outside the host is a mistake that says so", () => {
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  expect(() => render(<Door job={row()} />)).toThrow(/DeskJobHost/);
  spy.mockRestore();
});
