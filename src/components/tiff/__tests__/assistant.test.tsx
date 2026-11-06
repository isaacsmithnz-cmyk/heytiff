import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { answerBlocks, TiffAssistant, type ConversationParts } from "../assistant";
import type { AskSourceItem } from "@/lib/tiff/ask-client";
import { STORE_KEY } from "@/lib/tiff/threads";
import { resetThreadSync } from "@/lib/tiff/thread-sync";

/* Conversations' Tiff, drawn as the place draws her: the list and the open
   conversation, with the box at its foot.

   What these pin, beside what the place's own suite does
   (components/conversations): the grammar an answer is drawn in; what she
   read, one card per document, opened at the page; where an older answer
   came from, as it was kept; a document or a question handed over; and
   renaming and deleting a thread. The network is the brain's stream,
   scripted here, and the threads' server copy, which answers "not kept" as it
   does until the table is applied. */

type BrainOn = { onDelta: (t: string) => void; onTool: (l: string) => void; onError: (m: string) => void; onDone: () => void };
const asks: { question: string }[] = [];
let script: (on: BrainOn) => void = (on) => {
  on.onDelta("P8 is a piping temperature fault.");
  on.onDone();
};
jest.mock("@/lib/brain/ask-client", () => ({
  askBrain: async (input: { question: string }, on: BrainOn) => {
    asks.push(input);
    script(on);
  },
}));

const kbDocUrl = jest.fn(async () => ({ ok: true as const, url: "https://signed.example/doc.pdf" }));
jest.mock("@/app/actions/kb", () => ({ kbDocUrl: (...a: unknown[]) => kbDocUrl(...(a as [])) }));

const ASK_KEY = "heytiff.tiff.ask.v1";
const NOW = Date.now();

const src = (over: Partial<AskSourceItem> = {}): AskSourceItem => ({
  n: 1,
  chunkId: "c-1",
  docId: "d-1",
  title: "City Multi fault codes",
  category: "faults",
  pageFrom: 41,
  pageTo: 41,
  excerpt: "P8 — abnormal piping temperature. Check the liquid line thermistor.",
  ...over,
});

/** One thread: a question and the answer it was given, kept as `answer` says. */
const thread = (answer: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => ({
  id: "t-1",
  title: "R32 pressures",
  updatedAt: NOW,
  messages: [
    { role: "user", text: "why P8?", at: NOW },
    { role: "tiff", text: "Check the liquid line thermistor.", at: NOW, ...answer },
  ],
  ...over,
});

const seed = (...threads: unknown[]) => localStorage.setItem(STORE_KEY, JSON.stringify(threads));

const stored = (): { title: string; messages: { text: string }[] }[] => JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]");
const titles = () => stored().map((t) => t.title);

const frame = ({ list, pane }: ConversationParts) => (
  <>
    {list}
    {pane}
  </>
);
const draw = (props: Partial<Parameters<typeof TiffAssistant>[0]> = {}) => render(<TiffAssistant frame={frame} canManage {...props} />);

const pane = (name = "R32 pressures") => within(screen.getByRole("region", { name }));
const box = () => screen.getByRole("textbox", { name: "Ask Tiff" });

const notKept = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({ ok: false }) }));

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  asks.length = 0;
  resetThreadSync();
  (globalThis as { fetch?: unknown }).fetch = notKept;
  script = (on) => {
    on.onDelta("P8 is a piping temperature fault.");
    on.onDone();
  };
});

afterEach(cleanup);

/* ── the grammar an answer is allowed to use ─────────────────────────────── */

describe("rendering an answer", () => {
  it("makes a paragraph of consecutive lines and breaks on a blank one", () => {
    expect(answerBlocks("one\ntwo\n\nthree")).toEqual([
      { kind: "p", text: "one two" },
      { kind: "p", text: "three" },
    ]);
  });

  it("groups '- ' lines into one list", () => {
    expect(answerBlocks("Check:\n- the thermistor\n- the harness\nThen retest.")).toEqual([
      { kind: "p", text: "Check:" },
      { kind: "ul", items: ["the thermistor", "the harness"] },
      { kind: "p", text: "Then retest." },
    ]);
  });

  it("keeps a numbered procedure ordered, and separate from bullets", () => {
    expect(answerBlocks("Do this:\n1. isolate\n2) measure TH7\n- unrelated aside")).toEqual([
      { kind: "p", text: "Do this:" },
      { kind: "ol", items: ["isolate", "measure TH7"] },
      { kind: "ul", items: ["unrelated aside"] },
    ]);
  });

  it("reads a pipe table, outer pipes or not", () => {
    expect(answerBlocks("| Coil | Ω |\n| --- | --- |\n| 0°C | 15.0k |\n25°C | 5.0k")).toEqual([
      { kind: "table", head: ["Coil", "Ω"], rows: [["0°C", "15.0k"], ["25°C", "5.0k"]] },
    ]);
  });

  it("pads a ragged row rather than dropping the data in it", () => {
    const [block] = answerBlocks("| a | b | c |\n| --- | --- | --- |\n| 1 | 2 |");
    expect(block).toEqual({ kind: "table", head: ["a", "b", "c"], rows: [["1", "2", ""]] });
  });

  /* Mid-stream the header line has arrived and the rule has not, and a
     sentence containing a pipe is indistinguishable from it. */
  it("waits for the rule row before it believes a line is a table", () => {
    expect(answerBlocks("| Coil | Ω |")).toEqual([{ kind: "p", text: "| Coil | Ω |" }]);
  });

  /* Walked 24 October 2026: an answer opened with a made-up place tag, and
     the Conversations page drew it word for word (lib/brain/place-tag). */
  it("(F) never draws a place tag Tiff wrote into an answer", () => {
    const blocks = answerBlocks(
      '<where-they-are> Screen: Design — "Kooyong Road" (design id dsn_8841) </where-they-are>\n\nI\'ll pull that design up.',
    );
    expect(JSON.stringify(blocks)).not.toContain("where-they-are");
    expect(JSON.stringify(blocks)).toContain("I'll pull that design up.");
  });

  it("draws a table as a table, with its numbers in columns, as it is written", async () => {
    const user = userEvent.setup();
    script = (on) => {
      on.onDelta("| Coil temp | Resistance |\n| --- | --- |\n| 0°C | 15.0 kΩ |");
      on.onDone();
    };
    seed(thread());
    draw();
    await user.type(box(), "thermistor curve?{Enter}");

    await waitFor(() => expect(pane().getByRole("table")).toBeInTheDocument());
    expect(pane().getByRole("columnheader", { name: "Coil temp" })).toBeInTheDocument();
    expect(pane().getByRole("cell", { name: "15.0 kΩ" })).toBeInTheDocument();
  });

  it("draws bullets as a real list, not as characters", () => {
    seed(thread({ text: "Check:\n- the thermistor\n- the harness" }));
    draw();
    expect(pane().getAllByRole("listitem")).toHaveLength(2);
    expect(pane().getByText("the thermistor").tagName).toBe("LI");
  });
});

/* ── what she read ───────────────────────────────────────────────────────── */

describe("what she read", () => {
  const read = () => pane().getByRole("list", { name: "What Tiff read" });

  /* Six chips all reading the same manual was one citation shouting over
     itself (the live walk's E4 answer). A source is a DOCUMENT — its passages
     fold into one card that wears every page. */
  it("folds a document's passages into one card wearing every page", () => {
    seed(
      thread({
        researched: true,
        sources: [
          src(),
          src({ n: 2, chunkId: "c-2", pageFrom: 106, pageTo: 107 }),
          src({ n: 3, chunkId: "c-3", docId: "d-2", title: "Install manual", category: "install", pageFrom: 12, pageTo: 12 }),
        ],
      })
    );
    draw();
    expect(within(read()).getAllByRole("listitem")).toHaveLength(2);
    expect(within(read()).getByRole("button", { name: "Open City Multi fault codes, p.41, p.106–107" })).toBeInTheDocument();
    expect(within(read()).getByRole("button", { name: "Open Install manual, p.12" })).toBeInTheDocument();
    expect(pane().getByText("From 2 documents in your library")).toBeInTheDocument();
  });

  it("peeks every passage of the document, labelled by page", async () => {
    const user = userEvent.setup();
    seed(thread({ researched: true, sources: [src(), src({ n: 2, chunkId: "c-2", pageFrom: 106, pageTo: 107, excerpt: "E6-01 STD compressor 1 OC activated." })] }));
    draw();
    await user.click(screen.getByRole("button", { name: /^Open City Multi fault codes/ }));

    const peek = screen.getByRole("dialog");
    expect(within(peek).getByText(/abnormal piping temperature/)).toBeInTheDocument();
    expect(within(peek).getByText(/STD compressor 1 OC/)).toBeInTheDocument();
    expect(within(peek).getByText("Page 41")).toBeInTheDocument();
    expect(within(peek).getByText("Pages 106–107")).toBeInTheDocument();
    expect(within(peek).getByText(/Service documents, pages 41 and 106–107/)).toBeInTheDocument();
  });

  /* ── a citation is a pointer, not a memento ──
     The title travels into localStorage with the answer, so renaming a
     document left every older answer citing a name the library had stopped
     using. Found live: a thread still reading "545846862 Daikin Vrv Diagnosis
     Manual" for a document since retitled "Daikin VRV Diagnosis Manual". */
  it("names a renamed document by the name the library uses now", () => {
    seed(thread({ researched: true, sources: [src({ title: "545846862 Daikin Vrv Diagnosis Manual" })] }));
    draw({ docTitles: { "d-1": "Daikin VRV Diagnosis Manual" } });
    expect(within(read()).getByRole("button", { name: "Open Daikin VRV Diagnosis Manual, p.41" })).toBeInTheDocument();
    expect(screen.queryByText(/545846862/)).not.toBeInTheDocument();
  });

  /* A DELETED document still has to be named, and the name it was cited under
     is the only honest one left. */
  it("keeps the stored name when the document is gone from the library", () => {
    seed(thread({ researched: true, sources: [src()] }));
    draw({ docTitles: {} });
    expect(within(read()).getByRole("button", { name: "Open City Multi fault codes, p.41" })).toBeInTheDocument();
  });

  it("closes the peek on Escape", async () => {
    const user = userEvent.setup();
    seed(thread({ researched: true, sources: [src()] }));
    draw();
    await user.click(screen.getByRole("button", { name: /^Open City Multi fault codes/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  /* Opening at the page is the point of a citation — a link to page one of a
     300-page manual is not a source. */
  it("opens the document at the page the answer leaned on hardest", async () => {
    const tab = { opener: {} as unknown, location: { href: "" }, close: jest.fn() };
    const open = jest.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    const user = userEvent.setup();
    seed(thread({ researched: true, sources: [src(), src({ n: 2, chunkId: "c-2", pageFrom: 12, pageTo: 12 })] }));
    draw();
    await user.click(screen.getByRole("button", { name: /^Open City Multi fault codes/ }));
    await user.click(screen.getByRole("button", { name: "Open document" }));

    await waitFor(() => expect(kbDocUrl).toHaveBeenCalledWith("d-1"));
    await waitFor(() => expect(tab.location.href).toBe("https://signed.example/doc.pdf#page=41"));
    open.mockRestore();
  });
});

/* ── where an older answer came from, as it was kept ─────────────────────── */

describe("where the answer came from", () => {
  it("says the library had nothing, and a manager is told to add the manual", () => {
    seed(thread({ missed: true }));
    draw({ canManage: true });
    expect(pane().getByText("General knowledge: nothing in your library covered this. Add the manual that does and ask again.")).toBeInTheDocument();
  });

  it("tells a staff member who to ask instead", () => {
    seed(thread({ missed: true }));
    draw({ canManage: false });
    expect(pane().getByText(/Ask a manager to add the manual that does\./)).toBeInTheDocument();
  });

  it("says when the answer came from the rest of the library instead of the document named", () => {
    seed(thread({ researched: true, widenedFrom: "City Multi fault codes" }));
    draw();
    expect(pane().getByText("Nothing in “City Multi fault codes” covered this, so the answer is from the rest of your library")).toBeInTheDocument();
  });

  it("marks an answer that ran to its ceiling", () => {
    seed(thread({ truncated: true }));
    draw();
    expect(pane().getByText(/ran to its limit/)).toBeInTheDocument();
  });

  it("keeps what she did with the answer, and nothing it didn't carry", async () => {
    const user = userEvent.setup();
    script = (on) => {
      on.onTool("Searching the manuals");
      on.onDelta("Check the filter.");
      on.onDone();
    };
    seed(thread());
    draw();
    await user.type(box(), "coil icing?{Enter}");
    await waitFor(() => expect(stored()[0].messages).toHaveLength(4));
    expect(stored()[0].messages[3]).toEqual({ role: "tiff", text: "Check the filter.", at: expect.any(Number), steps: ["Searching the manuals"] });
  });
});

/* ── handed over: a question, a document, or words ───────────────────────── */

describe("handed over", () => {
  it("titles a conversation of its own from the question, capped", async () => {
    sessionStorage.setItem(ASK_KEY, JSON.stringify({ ask: "x".repeat(80) }));
    draw();
    await waitFor(() => expect(stored()).toHaveLength(1));
    expect(titles()[0]).toHaveLength(53);
    expect(asks[0].question).toBe("x".repeat(80));
  });

  /* THE DOCUMENT IS A CONTROL, NOT A SENTENCE. A library row used to type
     `In “City Multi fault codes”, ` into the box, and words filter nothing.
     The chip is the choice now. */
  it("names the document, leaves the box empty for the question, and sends nothing", () => {
    sessionStorage.setItem(ASK_KEY, JSON.stringify({ doc: { docId: "d-1", title: "City Multi fault codes" } }));
    draw();
    expect(screen.getByText("City Multi fault codes")).toBeInTheDocument();
    expect(box()).toHaveValue("");
    expect(box()).toHaveAttribute("placeholder", "Ask Tiff about this document");
    expect(asks).toHaveLength(0);
  });

  it("clears back to the whole library", async () => {
    const user = userEvent.setup();
    sessionStorage.setItem(ASK_KEY, JSON.stringify({ doc: { docId: "d-1", title: "City Multi fault codes" } }));
    draw();
    await user.click(screen.getByRole("button", { name: "Ask the whole library" }));
    expect(screen.queryByText("City Multi fault codes")).toBeNull();
  });

  /* The Fault Finder leaves WORDS, not a document — the code it just
     diagnosed, written as a question. That note fills the box. */
  it("opens with a fault code's question typed out, the caret in the box", () => {
    sessionStorage.setItem(ASK_KEY, "The unit is showing “E5”. What does that fault code mean? ");
    draw();
    expect((box() as HTMLTextAreaElement).value).toContain("“E5”");
    expect(box()).toHaveFocus();
    expect(asks).toHaveLength(0);
  });

  it("eats the note, so a refresh comes back to nothing handed over", () => {
    sessionStorage.setItem(ASK_KEY, JSON.stringify({ doc: { docId: "d-1", title: "City Multi fault codes" } }));
    const first = draw();
    expect(sessionStorage.getItem(ASK_KEY)).toBeNull();

    first.unmount();
    draw();
    expect(screen.queryByText("City Multi fault codes")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

/* ── renaming and dropping a conversation (brief §4A) ────────────────────── */

describe("managing a thread", () => {
  const field = () => within(screen.getByRole("dialog", { name: "Rename this chat" })).getByLabelText("Title");

  it("renames the open thread from its own head and keeps the new name", async () => {
    const user = userEvent.setup();
    seed(thread());
    draw();
    await user.click(screen.getByRole("button", { name: "Rename “R32 pressures”" }));
    expect(field()).toHaveValue("R32 pressures");

    await user.clear(field());
    await user.type(field(), "R32 pressures at 35°C");
    await user.click(screen.getByRole("button", { name: "Save name" }));

    expect(titles()).toEqual(["R32 pressures at 35°C"]);
    expect(screen.getByRole("button", { name: /^R32 pressures at 35°C/ })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("commits on Enter, because it is a one-field question", async () => {
    const user = userEvent.setup();
    seed(thread());
    draw();
    await user.click(screen.getByRole("button", { name: "Rename “R32 pressures”" }));
    await user.clear(field());
    await user.type(field(), "Warranty steps{Enter}");
    expect(titles()).toEqual(["Warranty steps"]);
  });

  it("caps the title and refuses an empty one", async () => {
    const user = userEvent.setup();
    seed(thread());
    draw();
    await user.click(screen.getByRole("button", { name: "Rename “R32 pressures”" }));
    expect(field()).toHaveAttribute("maxLength", "60");
    await user.clear(field());
    expect(screen.getByRole("button", { name: "Save name" })).toBeDisabled();
    await user.type(field(), "z".repeat(70));
    expect((field() as HTMLInputElement).value).toHaveLength(60);
  });

  it("leaves the thread as it was when the rename is cancelled, or put down with Escape", async () => {
    const user = userEvent.setup();
    seed(thread());
    draw();
    await user.click(screen.getByRole("button", { name: "Rename “R32 pressures”" }));
    await user.clear(field());
    await user.type(field(), "not this");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(titles()).toEqual(["R32 pressures"]);

    await user.click(screen.getByRole("button", { name: "Rename “R32 pressures”" }));
    await user.clear(field());
    await user.type(field(), "not this");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(titles()).toEqual(["R32 pressures"]);
  });

  it("names the thread in the confirm, and keeps it when the confirm is declined", async () => {
    const user = userEvent.setup();
    seed(thread());
    draw();
    await user.click(screen.getByRole("button", { name: "Delete “R32 pressures”" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Delete “R32 pressures”\?/)).toBeInTheDocument();
    expect(within(dialog).getByText(/2 messages go with it\. Threads live on this device only, so there is no copy elsewhere and no undo\./)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Keep it" }));
    expect(titles()).toEqual(["R32 pressures"]);

    await user.click(screen.getByRole("button", { name: "Delete “R32 pressures”" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(titles()).toEqual(["R32 pressures"]);
  });

  it("puts the open conversation down when it is the one deleted", async () => {
    const user = userEvent.setup();
    seed(thread(), thread({}, { id: "t-2", title: "U4 error", updatedAt: NOW - 1000 }));
    const onOpenChange = jest.fn();
    draw({ onOpenChange });
    await user.click(screen.getByRole("button", { name: "Delete “R32 pressures”" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete chat" }));

    expect(titles()).toEqual(["U4 error"]);
    expect(onOpenChange).toHaveBeenLastCalledWith(null);
  });
});
