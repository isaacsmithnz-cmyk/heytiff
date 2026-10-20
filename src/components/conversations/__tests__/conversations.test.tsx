import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Conversations, type ConversationsProps } from "../conversations";
import type { AskEvent, AskInput, AskSourceItem } from "@/lib/tiff/ask-client";
import type { MyNote } from "@/lib/notes/my-notes-query";
import { STORE_KEY } from "@/lib/tiff/threads";
import { resetThreadSync } from "@/lib/tiff/thread-sync";

/* CONVERSATIONS (v2, the board v2-board-conversations). What these pin: the
   three views and what each says; the open thread laid out as the board
   draws it, from the Library's own threads; Team saying honestly that it
   isn't built; Only me being your notes, with their own box and Save; and
   the box asking through the assistant's own flow, not a second Tiff. The
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

const notesApi = {
  addMyNote: jest.fn(async (_input: { body: string; source?: string }) => ({ ok: true as const, id: "n-new" })),
  archiveMyNote: jest.fn(async (_id: string, _archived?: boolean) => ({ ok: true as const })),
  deleteMyNote: jest.fn(async (_id: string) => ({ ok: true as const })),
  editMyNote: jest.fn(async (_id: string, _body: string) => ({ ok: true as const })),
};
jest.mock("@/app/actions/my-notes", () => ({
  addMyNote: (input: { body: string; source?: string }) => notesApi.addMyNote(input),
  archiveMyNote: (id: string, archived?: boolean) => notesApi.archiveMyNote(id, archived),
  deleteMyNote: (id: string) => notesApi.deleteMyNote(id),
  editMyNote: (id: string, body: string) => notesApi.editMyNote(id, body),
}));

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

const note = (over: Partial<MyNote> = {}): MyNote => ({
  id: "n1",
  body: "Ring the wholesaler back\nabout the coil pricing",
  source: "text",
  sourceNoteId: null,
  createdAt: new Date(at(8, 12)).toISOString(),
  updatedAt: new Date(at(8, 12)).toISOString(),
  archivedAt: null,
  ...over,
});

const props = (over: Partial<ConversationsProps> = {}): ConversationsProps => ({
  counts: { install: 3, faults: 0, specs: 0, sops: 0, field: 0 },
  readyCount: 3,
  canManage: true,
  docTitles: {},
  voiceEnabled: false,
  notes: [note()],
  archived: [],
  initial: { view: "all", open: null },
  you: "Isaac Smith",
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
  it("names the place and offers All, Team and Only me, each with its count", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify(threads()));
    render(<Conversations {...props()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Conversations" })).toBeInTheDocument();
    expect(tab(/^All/)).toHaveAttribute("aria-selected", "true");
    expect(tab(/^All/)).toHaveTextContent("All2");
    expect(tab(/^Team/)).toHaveTextContent("Team0");
    expect(tab(/^Only me/)).toHaveTextContent("Only me1");
  });

  it("puts the view in the address, so a tab or a refresh holds it", async () => {
    const user = userEvent.setup();
    render(<Conversations {...props()} />);
    await user.click(tab(/^Only me/));
    expect(window.location.search).toBe("?view=me");
    await user.click(tab(/^All/));
    expect(window.location.search).toBe("");
  });

  it("opens on the view the address names", () => {
    render(<Conversations {...props({ initial: { view: "me", open: null } })} />);
    expect(tab(/^Only me/)).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("list", { name: "Your notes" })).toBeInTheDocument();
  });
});

describe("All: the threads and the open one", () => {
  it("lists the Library's own threads, newest first, each a title over its time", () => {
    localStorage.setItem(STORE_KEY, JSON.stringify(threads()));
    render(<Conversations {...props()} />);
    const rows = within(screen.getByRole("list", { name: "Your conversations with Tiff" })).getAllByRole("button");
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
    expect(window.location.search).toBe("?open=t-ducted");
    const pane = screen.getByRole("region", { name: "Last 10 kW Mitsubishi ducted" });
    expect(within(pane).getByText("Today")).toBeInTheDocument();
    expect(within(pane).getAllByText("Isaac Smith")).toHaveLength(2);
    expect(within(pane).getAllByText("Tiff")).toHaveLength(2);
    expect(within(pane).getAllByText("10:42 am").length).toBeGreaterThan(0);
    expect(within(pane).getByText("When did we last put in a 10 kW ducted?")).toBeInTheDocument();
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
    render(<Conversations {...props({ initial: { view: "all", open: "t-ducted" } })} />);
    expect(screen.getByRole("region", { name: "Last 10 kW Mitsubishi ducted" })).toBeInTheDocument();
  });

  it("shows the passages she read when a card is opened", async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORE_KEY, JSON.stringify(threads()));
    render(<Conversations {...props({ initial: { view: "all", open: "t-ducted" } })} />);
    await user.click(screen.getByRole("button", { name: "Open PEAD-M100JAA installation manual, p.12" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Keep the return air path clear.");
  });

  it("says what is missing when there are no conversations yet, and leads to Home, where they start", () => {
    render(<Conversations {...props()} />);
    expect(screen.getByText("No conversations yet")).toBeInTheDocument();
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
    render(<Conversations {...props({ initial: { view: "all", open: "t-ducted" } })} />);
    await user.click(screen.getByRole("button", { name: "Delete “Last 10 kW Mitsubishi ducted”" }));
    await user.click(screen.getByRole("button", { name: "Delete chat" }));
    expect(stored().map((t) => t.id)).toEqual(["t-e6"]);
    expect(window.location.search).toBe("");
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
    render(<Conversations {...props({ initial: { view: "all", open: "t-ducted" } })} />);
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
    render(<Conversations {...props({ initial: { view: "all", open: "t-e6" } })} />);
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

describe("Team", () => {
  it("says honestly that shared conversations aren't built, and leads back to yours", async () => {
    const user = userEvent.setup();
    render(<Conversations {...props({ initial: { view: "team", open: null } })} />);
    expect(screen.getByText("No team conversations yet")).toBeInTheDocument();
    expect(screen.getByText(/isn't built yet/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open your conversations" }));
    expect(tab(/^All/)).toHaveAttribute("aria-selected", "true");
  });
});

describe("Only me: your private notes", () => {
  const open = async () => {
    const user = userEvent.setup();
    render(<Conversations {...props({ initial: { view: "me", open: null }, archived: [note({ id: "n0", body: "Old gate code", archivedAt: new Date().toISOString() })] })} />);
    return user;
  };

  it("lists your notes by their first line and time, and the archived ones apart", async () => {
    await open();
    const live = within(screen.getByRole("list", { name: "Your notes" })).getAllByRole("button");
    expect(live.map((b) => b.textContent)).toEqual(["Ring the wholesaler backToday 8:12 am"]);
    expect(within(screen.getByRole("list", { name: "Archived notes" })).getByRole("button")).toHaveTextContent("Old gate code");
  });

  it("opens a note with Edit and Archive, and archiving says so with Undo", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: /Ring the wholesaler back/ }));
    expect(window.location.search).toBe("?view=me&open=n1");
    const pane = screen.getByRole("region", { name: "Ring the wholesaler back" });
    expect(within(pane).getByText(/about the coil pricing/)).toBeInTheDocument();
    await user.click(within(pane).getByRole("button", { name: "Archive" }));
    expect(notesApi.archiveMyNote).toHaveBeenCalledWith("n1", undefined);
    expect(await screen.findByText("Note archived")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(notesApi.archiveMyNote).toHaveBeenLastCalledWith("n1", false));
  });

  it("edits a note in place", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: /Ring the wholesaler back/ }));
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const field = screen.getByRole("textbox", { name: "Edit the note" });
    await user.clear(field);
    await user.type(field, "Ring them Monday");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(notesApi.editMyNote).toHaveBeenCalledWith("n1", "Ring them Monday");
  });

  it("puts an archived note back, and deletes one for good only after asking", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: /Old gate code/ }));
    await user.click(screen.getByRole("button", { name: "Delete for good" }));
    expect(notesApi.deleteMyNote).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete note" }));
    expect(notesApi.deleteMyNote).toHaveBeenCalledWith("n0");
  });

  it("keeps a note from its own box with Save, never asking Tiff", async () => {
    const user = await open();
    const box = screen.getByRole("textbox", { name: "Write a note for yourself" });
    await user.type(box, "Gate code 4471");
    await user.click(screen.getByRole("button", { name: "Save the note" }));
    expect(notesApi.addMyNote).toHaveBeenCalledWith({ body: "Gate code 4471", source: "text" });
    expect(asks).toHaveLength(0);
    expect(window.location.search).toBe("?view=me&open=n-new");
  });

  it("says what is missing when there are no notes", () => {
    render(<Conversations {...props({ notes: [], initial: { view: "me", open: null } })} />);
    expect(screen.getByText("No notes yet")).toBeInTheDocument();
  });
});
