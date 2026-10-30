import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Conversations, type ConversationsProps } from "../conversations";
import type { AskEvent, AskInput, AskSourceItem } from "@/lib/tiff/ask-client";
import { STORE_KEY } from "@/lib/tiff/threads";
import type { InboxEmail } from "@/lib/email/inbox";
import { resetThreadSync } from "@/lib/tiff/thread-sync";

/* CONVERSATIONS (v2, the board v2-board-conversations). What these pin: the
   two views, Inbox and Chats, and what each says; an email open at its
   decision; the open chat laid out in the job conversation's look, from the
   Library's own threads; Team and Only me gone; and the box asking through
   the assistant's own flow, not a second Tiff. The
   network is the ask stream, scripted here, and the threads' server copy,
   which answers "not kept" as it does until the table is applied. */

const asks: AskInput[] = [];
let script: (emit: (e: AskEvent) => void, input: AskInput) => void = (emit) => {
  emit({ t: "delta", text: "P8 is a piping temperature fault." });
  emit({ t: "done" });
};

jest.mock("@/lib/tiff/ask-client", () => ({
  askTiff: async (input: AskInput) => {
    asks.push(input);
    script(input.onEvent, input);
  },
}));

jest.mock("@/app/actions/kb", () => ({ kbDocUrl: jest.fn(async () => ({ ok: true, url: "https://signed.example/doc.pdf" })) }));

const readEmailJob = jest.fn();
const createJobFromEmail = jest.fn();
const fileEmailOnJob = jest.fn();
jest.mock("@/app/actions/email-in-job", () => ({
  readEmailJob: (...a: unknown[]) => readEmailJob(...a),
  createJobFromEmail: (...a: unknown[]) => createJobFromEmail(...a),
  fileEmailOnJob: (...a: unknown[]) => fileEmailOnJob(...a),
  emailJobMade: jest.fn(),
  notAJob: jest.fn(),
}));
jest.mock("@/components/making/new-job-form", () => ({ NewJobForm: () => null }));

const at = (h: number, m = 0, daysBack = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  d.setHours(h, m, 0, 0);
  return d.getTime();
};

const src = (over: Partial<AskSourceItem> = {}): AskSourceItem => ({
  n: 1,
  chunkId: "c-1",
  docId: "d-1",
  title: "PEAD-M100JAA installation manual",
  category: "install",
  pageFrom: 12,
  pageTo: 12,
  excerpt: "Keep the return air path clear.",
  ...over,
});

const threads = () => [
  {
    id: "t-ducted",
    title: "Last 10 kW Mitsubishi ducted",
    updatedAt: at(10, 44),
    messages: [
      { role: "user", text: "When did we last put in a 10 kW ducted?", at: at(10, 42) },
      {
        role: "tiff",
        text: "3318 Hartley in Lane Cove.",
        at: at(10, 42),
        researched: true,
        steps: ["Searched your library: 4 matching passages", "Read PEAD-M100JAA installation manual"],
        sources: [src()],
      },
      { role: "user", text: "Why would the coil ice up?", at: at(10, 44) },
      { role: "tiff", text: "Usually too little air over the coil.", at: at(10, 44) },
    ],
  },
  { id: "t-e6", title: "Clearing an E6 on a Daikin split", updatedAt: at(9, 0, 1), messages: [] },
];

const props = (over: Partial<ConversationsProps> = {}): ConversationsProps => ({
  counts: { install: 3, faults: 0, specs: 0, sops: 0, field: 0 },
  readyCount: 3,
  canManage: true,
  docTitles: {},
  voiceEnabled: false,
  initial: { view: "chats", open: null },
  you: "Isaac Smith",
  inbox: [],
  ...over,
});

const stored = (): { id: string; title: string; messages: { role: string; text: string }[] }[] =>
  JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]");

const notKept = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({ ok: false }) }));

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  asks.length = 0;
  resetThreadSync();
  (globalThis as { fetch?: unknown }).fetch = notKept;
  window.history.replaceState(null, "", "/dashboard/conversations");
  script = (emit) => {
    emit({ t: "delta", text: "P8 is a piping temperature fault." });
    emit({ t: "done" });
  };
});

afterEach(cleanup);

const tab = (name: RegExp) => screen.getByRole("tab", { name });

describe("the views", () => {
  it("names the place and offers Inbox and Chats, with no numbers on them, and Team and Only me gone", () => {
    localStorage.setItem(STORE_KEY, JSON.stringify(threads()));
    render(<Conversations {...props({ initial: { view: "inbox", open: null } })} />);
    expect(screen.getByRole("heading", { level: 1, name: "Conversations" })).toBeInTheDocument();
    expect(tab(/^Inbox/)).toHaveAttribute("aria-selected", "true");
    expect(tab(/^Inbox/)).toHaveTextContent(/^Inbox$/);
    expect(tab(/^Chats/)).toHaveTextContent(/^Chats$/);
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("puts the view in the address, so a tab or a refresh holds it", async () => {
    const user = userEvent.setup();
    render(<Conversations {...props({ initial: { view: "inbox", open: null } })} />);
    await user.click(tab(/^Chats/));
    expect(window.location.search).toBe("?view=chats");
    await user.click(tab(/^Inbox/));
    expect(window.location.search).toBe("");
  });

  it("opens on the view the address names", () => {
    render(<Conversations {...props()} />);
    expect(tab(/^Chats/)).toHaveAttribute("aria-selected", "true");
  });

  it("lands a question handed over on Chats, whatever the address says", async () => {
    sessionStorage.setItem("heytiff.tiff.ask.v1", JSON.stringify({ ask: "what does P8 mean?" }));
    render(<Conversations {...props({ initial: { view: "inbox", open: null } })} />);
    expect(await screen.findByRole("tab", { name: /^Chats/, selected: true })).toBeInTheDocument();
    await waitFor(() => expect(asks).toHaveLength(1));
  });
});

describe("Inbox", () => {
  const EID = "d4c5fd98-2550-4132-896a-89d2dfbcc97b";
  const OTHER = "6a3e5b78-0003-41de-bc30-08d2572017a0";
  const row = (over: Partial<InboxEmail> = {}): InboxEmail => ({
    id: EID,
    subject: "Request for quotation – 2 Krui Street, Fairlight",
    from: "Shaheer Khan",
    by: "Isaac",
    mine: true,
    at: at(9, 0),
    state: "read",
    jobNumber: null,
    forJob: null,
    kind: "new",
    ...over,
  });
  const email = (over: Record<string, unknown> = {}) => ({
    id: EID,
    state: "read",
    proposal: {
      isJob: true,
      aboutJob: false,
      jobNumbers: [],
      notJobWhy: "",
      summary: "JT Construct is asking for a quote.",
      client: "JT Construct Pty Ltd",
      contact: { first: "Shaheer", last: "Khan", mobile: "", phone: "", email: "" },
      site: "2 Krui Street, Fairlight",
      due: "",
      scope: ["Price the ducted system"],
      excluded: [],
      clientMatch: null,
      siteMatch: null,
      jobs: [],
    },
    files: [],
    links: [],
    why: null,
    jobUuid: null,
    jobNumber: null,
    fromName: null,
    receivedAt: new Date(at(9, 0)).toISOString(),
    subject: "Fwd: Request for quotation – 2 Krui Street, Fairlight",
    body: "---------- Forwarded message ---------\nFrom: Shaheer Khan <s@jt.example>\nDate: Fri, 9 Oct 2026 at 13:02\nTo: <i@da.example>\n\nHi,\n\nPlease quote the attached.",
    ...over,
  });
  const inbox = (rows: InboxEmail[], open: string | null = null) => props({ inbox: rows, initial: { view: "inbox", open } });

  beforeEach(() => {
    readEmailJob.mockReset();
    createJobFromEmail.mockReset();
    fileEmailOnJob.mockReset();
    readEmailJob.mockResolvedValue(email());
  });

  it("lists every email with who it's from, who forwarded it and where it stands, and turns the tab amber while one waits", async () => {
    render(
      <Conversations
        {...inbox([
          row(),
          row({ id: OTHER, subject: "October statement", from: "Reece Accounts", by: "Alex", mine: false, at: at(9, 0, 2), state: "not_a_job", kind: "none" }),
        ])}
      />
    );
    const list = screen.getByRole("list", { name: "Emails to Tiff" });
    const rows = within(list).getAllByRole("button");
    expect(rows[0]).toHaveTextContent("Request for quotation – 2 Krui Street, Fairlight");
    expect(rows[0]).toHaveTextContent("Not made yet");
    expect(rows[0]).toHaveTextContent("From Shaheer Khan, forwarded by you at 9:00 am");
    expect(rows[1]).toHaveTextContent("Not a job");
    expect(rows[1]).toHaveTextContent(/From Reece Accounts, forwarded by Alex on /);
    expect(tab(/^Inbox/)).toHaveClass("pt-vtab--look");
    await screen.findByRole("button", { name: "Create job" });
  });

  it("opens the newest at its decision: whose it was, Create job, her read, and the builder's own email without the forward's header", async () => {
    render(<Conversations {...inbox([row()])} />);
    expect(await screen.findByRole("button", { name: "Create job" })).toBeInTheDocument();
    const pane = screen.getByRole("region", { name: "Request for quotation – 2 Krui Street, Fairlight" });
    expect(within(pane).getByRole("heading", { level: 2, name: "Request for quotation – 2 Krui Street, Fairlight" })).toBeInTheDocument();
    expect(within(pane).getByText("From Shaheer Khan at JT Construct Pty Ltd, forwarded by you today at 9:00 am")).toBeInTheDocument();
    expect(within(pane).getByText(/JT Construct is asking for a quote\./)).toBeInTheDocument();
    expect(within(pane).getByRole("heading", { name: "New job" })).toBeInTheDocument();
    expect(within(pane).getByText(/Please quote the attached\./)).toBeInTheDocument();
    expect(within(pane).queryByText(/Forwarded message/)).toBeNull();
    expect(within(pane).getByText("Fri, 9 Oct 2026 at 13:02")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Ask Tiff" })).toHaveAttribute("placeholder", "Ask Tiff about this email");
    expect(screen.queryByRole("button", { name: /^Delete/ })).toBeNull();
  });

  it("offers Add to job N for drawings on a job already here, and the row's word follows what's done", async () => {
    const user = userEvent.setup();
    readEmailJob.mockResolvedValue(
      email({
        proposal: {
          ...email().proposal,
          isJob: false,
          aboutJob: true,
          jobs: [{ uuid: "u-3402", number: "3402", address: "40 Westbourne Street", client: "Truecut", status: "Quote", found: "number" }],
        },
      })
    );
    fileEmailOnJob.mockResolvedValue(true);
    render(<Conversations {...inbox([row({ kind: "existing", forJob: "3402" })])} />);
    expect(within(screen.getByRole("list", { name: "Emails to Tiff" })).getByRole("button")).toHaveTextContent("Not added yet");
    await user.click(await screen.findByRole("button", { name: "Add to job 3402" }));
    expect(fileEmailOnJob).toHaveBeenCalledWith(EID, "u-3402");
    expect(within(screen.getByRole("list", { name: "Emails to Tiff" })).getByRole("button")).toHaveTextContent("Added to job 3402");
    expect(tab(/^Inbox/)).not.toHaveClass("pt-vtab--look");
    expect(screen.getByRole("link", { name: "Open job 3402" })).toBeInTheDocument();
  });

  it("opens the email the address names, and writes the one you open", async () => {
    const user = userEvent.setup();
    render(<Conversations {...inbox([row(), row({ id: OTHER, subject: "Another" })], `email-${OTHER}`)} />);
    await waitFor(() => expect(readEmailJob).toHaveBeenCalledWith(OTHER));
    await user.click(within(screen.getByRole("list", { name: "Emails to Tiff" })).getByRole("button", { name: /Request for quotation/ }));
    expect(window.location.search).toBe(`?open=email-${EID}`);
    await waitFor(() => expect(readEmailJob).toHaveBeenCalledWith(EID));
  });

  it("asks about an email you didn't forward with what she read as context, and keeps it out of Chats", async () => {
    const user = userEvent.setup();
    render(<Conversations {...inbox([row({ mine: false, by: "Alex" })])} />);
    await screen.findByRole("button", { name: "Create job" });
    await user.type(screen.getByRole("textbox", { name: "Ask Tiff" }), "how many zones?{Enter}");
    expect(asks[0].question).toBe("how many zones?");
    expect(asks[0].history[0].text).toContain("Please quote the attached.");
    expect(asks[0].history[1].text).toContain("JT Construct is asking for a quote.");
    expect(await screen.findByText("P8 is a piping temperature fault.")).toBeInTheDocument();
    await waitFor(() => expect(stored().find((t) => t.id === `email-${EID}`)!.messages).toHaveLength(4));
    await user.click(tab(/^Chats/));
    expect(screen.getByText("No chats yet")).toBeInTheDocument();
  });

  it("says what's missing when nothing has been sent, and leads to Tiff's address", () => {
    render(<Conversations {...inbox([])} />);
    expect(screen.getByText("Nothing in the inbox yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Find Tiff's address" })).toHaveAttribute("href", "/dashboard/admin/integrations");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(readEmailJob).not.toHaveBeenCalled();
  });
});

describe("Chats: the threads and the open one", () => {
  it("lists the Library's own threads, newest first, each a title over its time", () => {
    localStorage.setItem(STORE_KEY, JSON.stringify(threads()));
    render(<Conversations {...props()} />);
    const rows = within(screen.getByRole("list", { name: "Your chats with Tiff" })).getAllByRole("button");
    expect(rows.map((r) => r.textContent)).toEqual([
      "Last 10 kW Mitsubishi ductedToday 10:44 am",
      "Clearing an E6 on a Daikin splitYesterday",
    ]);
  });

  it("opens a thread as the board draws it: the day, who said what and when, her steps, what she read, and where it came from", async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORE_KEY, JSON.stringify(threads()));
    render(<Conversations {...props()} />);
    await user.click(screen.getByRole("button", { name: /^Last 10 kW Mitsubishi ducted/ }));

    expect(screen.getByRole("button", { name: /^Last 10 kW Mitsubishi ducted/ })).toHaveAttribute("aria-current", "true");
    expect(window.location.search).toBe("?view=chats&open=t-ducted");
    const pane = screen.getByRole("region", { name: "Last 10 kW Mitsubishi ducted" });
    expect(within(pane).getByText("Today")).toBeInTheDocument();
    expect(within(pane).getAllByText("Isaac Smith")).toHaveLength(2);
    expect(within(pane).getAllByText("Tiff")).toHaveLength(2);
    expect(within(pane).getAllByText("10:42 am").length).toBeGreaterThan(0);
    // the job conversation's look: your words on the right in a bubble, hers plain
    expect(within(pane).getByText("When did we last put in a 10 kW ducted?").closest(".jc-bm--you")).not.toBeNull();
    expect(within(pane).getByText("3318 Hartley in Lane Cove.").closest(".jc-tiffturn")).not.toBeNull();
    // her steps, ticked
    const steps = within(pane).getByRole("list", { name: "What Tiff did" });
    expect(within(steps).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Searched your library: 4 matching passages",
      "Read PEAD-M100JAA installation manual",
    ]);
    // what she read, as a card with Open
    const read = within(pane).getByRole("list", { name: "What Tiff read" });
    expect(read).toHaveTextContent("PEAD-M100JAA installation manual");
    expect(read).toHaveTextContent("Installation documents, p.12");
    expect(within(read).getByRole("button", { name: "Open PEAD-M100JAA installation manual, p.12" })).toBeInTheDocument();
    // where each answer came from
    expect(within(pane).getByText("From PEAD-M100JAA installation manual, in your library")).toBeInTheDocument();
    expect(within(pane).getByText("General knowledge, not from your documents")).toBeInTheDocument();
  });

  it("opens the thread the address names", () => {
    localStorage.setItem(STORE_KEY, JSON.stringify(threads()));
    render(<Conversations {...props({ initial: { view: "chats", open: "t-ducted" } })} />);
    expect(screen.getByRole("region", { name: "Last 10 kW Mitsubishi ducted" })).toBeInTheDocument();
  });

  it("shows the passages she read when a card is opened", async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORE_KEY, JSON.stringify(threads()));
    render(<Conversations {...props({ initial: { view: "chats", open: "t-ducted" } })} />);
    await user.click(screen.getByRole("button", { name: "Open PEAD-M100JAA installation manual, p.12" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Keep the return air path clear.");
  });

  it("says what is missing when there are no conversations yet, and leads to Home, where they start", () => {
    render(<Conversations {...props()} />);
    expect(screen.getByText("No chats yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Home" })).toHaveAttribute("href", "/dashboard");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("only keeps them: no New conversation, and the newest opens when none is named (Isaac, 20 October)", () => {
    localStorage.setItem(STORE_KEY, JSON.stringify(threads()));
    render(<Conversations {...props()} />);
    expect(screen.queryByRole("button", { name: /New conversation/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Last 10 kW Mitsubishi ducted/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("textbox", { name: "Ask Tiff" })).toHaveAttribute("placeholder", "Reply to Tiff");
  });

  it("renames and deletes the open thread from its own head", async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORE_KEY, JSON.stringify(threads()));
    render(<Conversations {...props({ initial: { view: "chats", open: "t-ducted" } })} />);
    await user.click(screen.getByRole("button", { name: "Delete “Last 10 kW Mitsubishi ducted”" }));
    await user.click(screen.getByRole("button", { name: "Delete chat" }));
    expect(stored().map((t) => t.id)).toEqual(["t-e6"]);
    expect(window.location.search).toBe("?view=chats");
  });
});

describe("the box", () => {
  const box = () => screen.getByRole("textbox", { name: "Ask Tiff" });

  it("asks through the assistant's own flow and keeps the reply in the thread it was asked in", async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORE_KEY, JSON.stringify(threads()));
    render(<Conversations {...props()} />);
    await user.type(box(), "what does P8 mean?");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatchObject({ question: "what does P8 mean?", research: true });
    expect(await screen.findByText("P8 is a piping temperature fault.")).toBeInTheDocument();
    await waitFor(() => expect(stored().find((t) => t.id === "t-ducted")!.messages.at(-1)!.text).toBe("P8 is a piping temperature fault."));
    expect(stored()).toHaveLength(2);
    expect(box()).toHaveValue("");
  });

  it("sends on Enter, and Shift+Enter starts a new line", async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORE_KEY, JSON.stringify(threads()));
    render(<Conversations {...props()} />);
    await user.type(box(), "first line{Shift>}{Enter}{/Shift}second");
    expect(asks).toHaveLength(0);
    await user.keyboard("{Enter}");
    expect(asks[0].question).toBe("first line\nsecond");
  });

  it("sends the turns before it as context on a follow-up", async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORE_KEY, JSON.stringify(threads()));
    render(<Conversations {...props({ initial: { view: "chats", open: "t-ducted" } })} />);
    await user.type(box(), "and the filter?{Enter}");
    expect(asks[0].history).toHaveLength(4);
    expect(asks[0].history[0]).toEqual({ role: "user", text: "When did we last put in a 10 kW ducted?" });
  });

  it("shows what she is doing while she works, ticks her steps, and fades Send until she's done", async () => {
    const user = userEvent.setup();
    let emit: (e: AskEvent) => void = () => {};
    script = (e) => {
      emit = e;
    };
    localStorage.setItem(STORE_KEY, JSON.stringify(threads()));
    render(<Conversations {...props({ initial: { view: "chats", open: "t-e6" } })} />);
    await user.type(box(), "coil icing{Enter}");
    expect(screen.getByText("Searching the library")).toHaveAttribute("role", "status");
    act(() =>
      emit({
        t: "trace",
        categories: {
          install: { hits: 3, topDoc: "PEAD-M100JAA installation manual" },
          faults: { hits: 0, topDoc: null },
          specs: { hits: 0, topDoc: null },
          sops: { hits: 0, topDoc: null },
          field: { hits: 0, topDoc: null },
        },
        winners: ["install"],
        terms: ["coil"],
      }),
    );
    expect(screen.getByText("Searched your library: 3 matching passages")).toBeInTheDocument();
    expect(screen.getByText("Read PEAD-M100JAA installation manual")).toBeInTheDocument();
    await user.type(box(), "next");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    act(() => {
      emit({ t: "delta", text: "Check the filter." });
      emit({ t: "done" });
    });
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
    await waitFor(() => expect((stored().find((t) => t.id === "t-e6")!.messages.at(-1) as { steps?: string[] }).steps).toEqual([
      "Searched your library: 3 matching passages",
      "Read PEAD-M100JAA installation manual",
    ]));
  });

  it("says what went wrong and offers to try the same question again", async () => {
    const user = userEvent.setup();
    script = (emit) => emit({ t: "err", message: "Tiff couldn't answer that just now." });
    localStorage.setItem(STORE_KEY, JSON.stringify(threads()));
    render(<Conversations {...props()} />);
    await user.type(box(), "why P8?{Enter}");
    expect(await screen.findByText("Tiff couldn't answer that just now.")).toBeInTheDocument();
    script = (emit) => {
      emit({ t: "delta", text: "Piping temperature." });
      emit({ t: "done" });
    };
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(asks.map((a) => a.question)).toEqual(["why P8?", "why P8?"]);
    expect(await screen.findByText("Piping temperature.")).toBeInTheDocument();
  });
});

describe("a question handed over whole (the Library's box)", () => {
  it("is asked on arrival, in a conversation of its own, once", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify(threads()));
    sessionStorage.setItem("heytiff.tiff.ask.v1", JSON.stringify({ ask: "what does P8 mean?" }));
    render(<Conversations {...props()} />);
    await waitFor(() => expect(asks).toHaveLength(1));
    expect(asks[0].question).toBe("what does P8 mean?");
    await waitFor(() => expect(stored()).toHaveLength(3));
    expect(sessionStorage.getItem("heytiff.tiff.ask.v1")).toBeNull();
  });
});

describe("where the threads are kept", () => {
  it("stays on this device, as it always has, while the server doesn't keep them", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify(threads()));
    render(<Conversations {...props()} />);
    await waitFor(() => expect(notKept).toHaveBeenCalled());
    expect(stored().map((t) => t.id)).toEqual(["t-ducted", "t-e6"]);
    expect(screen.getAllByRole("button", { name: /^Last 10 kW|^Clearing an E6/ })).toHaveLength(2);
  });

  it("with the table, brings the person's other devices' threads in and sends this browser's up, once", async () => {
    const phone = { id: "t-phone", title: "Who's free Thursday", updatedAt: at(11, 0), messages: [{ role: "user", text: "Who's free Thursday?", at: at(11, 0) }] };
    const posted: unknown[] = [];
    (globalThis as { fetch?: unknown }).fetch = jest.fn(async (_url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === "POST") {
        posted.push(JSON.parse(init.body ?? "null"));
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, who: "who-isaac", threads: [phone] }) };
    });
    localStorage.setItem(STORE_KEY, JSON.stringify(threads()));
    const user = userEvent.setup();
    render(<Conversations {...props()} />);

    expect(await screen.findByRole("button", { name: /^Who's free Thursday/ })).toBeInTheDocument();
    expect(stored().map((t) => t.id)).toEqual(["t-phone", "t-ducted", "t-e6"]);
    await waitFor(() => expect(posted).toHaveLength(1));
    expect((posted[0] as { upsert: { id: string }[] }).upsert.map((t) => t.id)).toEqual(["t-ducted", "t-e6"]);

    // and deleting says it goes everywhere
    await user.click(screen.getByRole("button", { name: /^Who's free Thursday/ }));
    await user.click(screen.getByRole("button", { name: "Delete “Who's free Thursday”" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("It goes from your other devices too");
  });
});
