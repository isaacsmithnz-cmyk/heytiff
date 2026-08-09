import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { answerBlocks, TiffAssistant } from "../assistant";
import type { AskEvent, AskInput, AskSourceItem } from "@/lib/tiff/ask-client";

/* The assistant screen.

   What these pin: the answer APPEARS as it is written; the distinction between
   a general answer and a researched one is visible on every message rather
   than only in the composer; a source chip opens the page it came from; and
   asking a second question stops the first one rather than interleaving two
   answers into one bubble. */

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

const kbDocUrl = jest.fn(async () => ({ ok: true as const, url: "https://signed.example/doc.pdf" }));
jest.mock("@/app/actions/kb", () => ({ kbDocUrl: (...a: unknown[]) => kbDocUrl(...(a as [])) }));

const STORE_KEY = "heytiff.tiff.threads.v2";
const ASK_KEY = "heytiff.tiff.ask.v1";

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

const stored = (): { messages: { text: string; sources?: AskSourceItem[] }[] }[] =>
  JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]");

const ask = async (text: string) => {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Ask Tiff"), text);
  await user.click(screen.getByLabelText("Send"));
};

/* The two halves of "Answer from". Reached by their own names rather than by a
   shared /research/i, because that is the point of the control: neither option
   is "the toggle", and the one you press is the one you get. */
const libraryMode = () => screen.getByRole("button", { name: "Your library" });
const generalMode = () => screen.getByRole("button", { name: "General knowledge" });

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  asks.length = 0;
  script = (emit) => {
    emit({ t: "delta", text: "P8 is a piping temperature fault." });
    emit({ t: "done" });
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
    expect(
      answerBlocks("Do this:\n1. isolate\n2) measure TH7\n- unrelated aside")
    ).toEqual([
      { kind: "p", text: "Do this:" },
      { kind: "ol", items: ["isolate", "measure TH7"] },
      { kind: "ul", items: ["unrelated aside"] },
    ]);
  });

  it("reads a pipe table, outer pipes or not", () => {
    expect(
      answerBlocks("| Coil | Ω |\n| --- | --- |\n| 0°C | 15.0k |\n25°C | 5.0k")
    ).toEqual([
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

  it("renders a table as a table, with its numbers in columns", async () => {
    script = (emit) => {
      emit({ t: "delta", text: "| Coil temp | Resistance |\n| --- | --- |\n| 0°C | 15.0 kΩ |" });
      emit({ t: "done" });
    };
    render(<TiffAssistant readyCount={3} counts={{ install: 3, faults: 0, specs: 0, sops: 0, field: 0 }} />);
    await ask("thermistor curve?");

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(screen.getByRole("columnheader", { name: "Coil temp" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "15.0 kΩ" })).toBeInTheDocument();
  });

  it("renders bullets as a real list, not as characters", async () => {
    script = (emit) => {
      emit({ t: "delta", text: "Check:\n- the thermistor\n- the harness" });
      emit({ t: "done" });
    };
    render(<TiffAssistant readyCount={3} counts={{ install: 3, faults: 0, specs: 0, sops: 0, field: 0 }} />);
    await ask("why P8?");

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    expect(screen.getByText("the thermistor").tagName).toBe("LI");
  });
});

/* ── the answer arrives as it is written ─────────────────────────────────── */

describe("asking in general mode", () => {
  it("shows a typing indicator until the first delta, then the answer", async () => {
    let push: (e: AskEvent) => void = () => {};
    script = (emit) => {
      push = emit;
    };

    render(<TiffAssistant />);
    await ask("why P8?");

    expect(screen.getByLabelText("Tiff is thinking")).toBeInTheDocument();

    await act(async () => push({ t: "delta", text: "P8 is " }));
    expect(screen.getByText(/P8 is/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Tiff is thinking")).not.toBeInTheDocument();

    await act(async () => push({ t: "delta", text: "a piping fault." }));
    expect(screen.getByText("P8 is a piping fault.")).toBeInTheDocument();
  });

  it("sends the question with research off and no history on the first turn", async () => {
    render(<TiffAssistant />);
    await ask("why P8?");

    expect(asks[0]).toMatchObject({ question: "why P8?", research: false, history: [] });
  });

  it("sends the prior turns as context on the second question", async () => {
    render(<TiffAssistant />);
    await ask("why P8?");
    await waitFor(() => expect(stored()[0]?.messages).toHaveLength(2));
    await ask("and in heating?");

    expect(asks[1].history).toEqual([
      { role: "user", text: "why P8?" },
      { role: "assistant", text: "P8 is a piping temperature fault." },
    ]);
  });
});

/* ── the bar knows which conversation it is in ───────────────────────────── */

describe("the composer's invitation", () => {
  it("asks for anything on the landing, and a follow-up inside a thread", async () => {
    render(<TiffAssistant />);

    expect(screen.getByPlaceholderText("Ask Tiff anything…")).toBeInTheDocument();

    await ask("why P8?");
    expect(screen.getByPlaceholderText("Ask a follow-up…")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Ask Tiff anything…")).not.toBeInTheDocument();
  });
});

/* ── research: a choice, made visible before and after ───────────────────── */

describe("where the answer comes from", () => {
  /* The switch starts where the headline points: "Ask the library" over a bar
     set to General knowledge answered every first question from the wrong
     place, then offered to look properly — the page's own promise as an
     upsell. */
  it("starts on the library whenever it has anything in it", () => {
    render(<TiffAssistant readyCount={4} counts={{ install: 4, faults: 0, specs: 0, sops: 0, field: 0 }} />);

    expect(libraryMode()).toHaveAttribute("aria-pressed", "true");
    expect(generalMode()).toHaveAttribute("aria-pressed", "false");
  });

  it("starts on general knowledge only when there is nothing to search", () => {
    render(<TiffAssistant readyCount={0} />);

    expect(generalMode()).toHaveAttribute("aria-pressed", "true");
    expect(libraryMode()).toHaveAttribute("aria-pressed", "false");
  });

  it("disables the library option with an explanation when the library is empty", () => {
    render(<TiffAssistant readyCount={0} />);

    expect(libraryMode()).toBeDisabled();
    expect(libraryMode()).toHaveAttribute("title", "Add documents to the library first");
    /* and the hint says what to do about it rather than repeating the label of
       the option that is still pressable */
    expect(screen.getByText("Add documents and Tiff can answer from those too")).toBeInTheDocument();
  });

  it("flips the hint and both pressed states, and asks the library", async () => {
    const user = userEvent.setup();
    render(<TiffAssistant readyCount={4} counts={{ install: 4, faults: 0, specs: 0, sops: 0, field: 0 }} />);

    await user.click(libraryMode());
    expect(libraryMode()).toHaveAttribute("aria-pressed", "true");
    expect(generalMode()).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Your documents only, with the page it came from")).toBeInTheDocument();

    await ask("why P8?");
    expect(asks[0]).toMatchObject({ research: true });
  });

  /* The old control was one button that flipped; pressing the lit half of this
     one must not turn it back off, or a segmented control becomes a toggle
     wearing two labels. */
  it("goes back to general knowledge only when general knowledge is pressed", async () => {
    const user = userEvent.setup();
    render(<TiffAssistant readyCount={4} counts={{ install: 4, faults: 0, specs: 0, sops: 0, field: 0 }} />);

    await user.click(libraryMode());
    await user.click(libraryMode());
    expect(libraryMode()).toHaveAttribute("aria-pressed", "true");

    await user.click(generalMode());
    expect(generalMode()).toHaveAttribute("aria-pressed", "true");

    await ask("why P8?");
    expect(asks[0]).toMatchObject({ research: false });
  });
});

describe("sources", () => {
  const researched = (sources: AskSourceItem[]) => {
    script = (emit) => {
      emit({ t: "delta", text: "Check the liquid line thermistor." });
      emit({ t: "sources", items: sources });
      emit({ t: "done" });
    };
  };

  const renderResearched = async (sources = [src()]) => {
    researched(sources);
    render(<TiffAssistant readyCount={2} counts={{ install: 0, faults: 2, specs: 0, sops: 0, field: 0 }} />);
    const user = userEvent.setup();
    await user.click(libraryMode());
    await ask("why P8?");
    return user;
  };

  it("renders a numbered chip per cited document, with its page", async () => {
    await renderResearched([src(), src({ n: 2, chunkId: "c-2", docId: "d-2", title: "Install manual", pageFrom: 12, pageTo: 14 })]);

    expect(await screen.findByRole("button", { name: /Source 1: City Multi fault codes, p.41/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Source 2: Install manual, p.12–14/ })).toBeInTheDocument();
  });

  /* Six chips all reading the same manual was one citation shouting over
     itself (the live walk's E4 answer). A source is a DOCUMENT — its passages
     fold into one chip that wears every page, and the label counts documents. */
  it("folds a document's passages into one chip wearing every page", async () => {
    await renderResearched([
      src(),
      src({ n: 2, chunkId: "c-2", pageFrom: 106, pageTo: 107 }),
      src({ n: 3, chunkId: "c-3", docId: "d-2", title: "Install manual", pageFrom: 12, pageTo: 12 }),
    ]);

    expect(
      await screen.findByRole("button", { name: /Source 1: City Multi fault codes, p\.41 · p\.106–107/ })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Source 2: Install manual, p\.12/ })).toBeInTheDocument();
    expect(screen.getByText("Sources · 2")).toBeInTheDocument();
    // the manual's name appears ONCE in the chip row
    expect(screen.getAllByText("City Multi fault codes")).toHaveLength(1);
  });

  it("peeks every passage of the document, labelled by page", async () => {
    const user = await renderResearched([
      src(),
      src({
        n: 2,
        chunkId: "c-2",
        pageFrom: 106,
        pageTo: 107,
        excerpt: "E6-01 STD compressor 1 OC activated.",
      }),
    ]);
    await user.click(await screen.findByRole("button", { name: /Source 1/ }));

    const peek = screen.getByRole("dialog");
    expect(within(peek).getByText(/abnormal piping temperature/)).toBeInTheDocument();
    expect(within(peek).getByText(/STD compressor 1 OC/)).toBeInTheDocument();
    expect(within(peek).getByText("p.41")).toBeInTheDocument();
    expect(within(peek).getByText("p.106–107")).toBeInTheDocument();
  });

  it("closes the peek on Escape", async () => {
    const user = await renderResearched();
    await user.click(await screen.findByRole("button", { name: /Source 1/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the excerpt in a peek panel", async () => {
    const user = await renderResearched();
    await user.click(await screen.findByRole("button", { name: /Source 1/ }));

    const peek = screen.getByRole("dialog");
    expect(within(peek).getByText(/abnormal piping temperature/)).toBeInTheDocument();
    expect(within(peek).getByText(/Service documents/)).toBeInTheDocument();
  });

  /* Opening at the page is the point of a citation — a link to page one of a
     300-page manual is not a source. */
  it("opens the document at the page the answer quoted", async () => {
    const tab = { opener: {} as unknown, location: { href: "" }, close: jest.fn() };
    const open = jest.spyOn(window, "open").mockReturnValue(tab as unknown as Window);

    const user = await renderResearched();
    await user.click(await screen.findByRole("button", { name: /Source 1/ }));
    await user.click(screen.getByRole("button", { name: /Open document/ }));

    await waitFor(() => expect(kbDocUrl).toHaveBeenCalledWith("d-1"));
    await waitFor(() => expect(tab.location.href).toBe("https://signed.example/doc.pdf#page=41"));
    open.mockRestore();
  });

  it("keeps the sources with the message, so a refresh still has them", async () => {
    await renderResearched();
    await waitFor(() => expect(stored()[0].messages).toHaveLength(2));

    const answer = stored()[0].messages[1];
    expect(answer.sources?.[0]).toMatchObject({ docId: "d-1", pageFrom: 41 });
    expect(answer).toMatchObject({ researched: true });
  });
});

describe("the honest miss", () => {
  it("says the library had nothing, above the answer it gave anyway", async () => {
    script = (emit) => {
      emit({ t: "miss" });
      emit({ t: "delta", text: "Nothing in your library covers that. Generally speaking…" });
      emit({ t: "done" });
    };

    render(<TiffAssistant readyCount={2} canManage />);
    const user = userEvent.setup();
    await user.click(libraryMode());
    await ask("why P8?");

    expect(
      await screen.findByText(/Nothing in your library covered this/)
    ).toBeInTheDocument();
    expect(screen.getByText(/Upload the manual, fault-code book or SOP/)).toBeInTheDocument();
  });

  it("tells a staff member who to ask instead of offering an upload", async () => {
    script = (emit) => {
      emit({ t: "miss" });
      emit({ t: "delta", text: "Generally speaking…" });
      emit({ t: "done" });
    };

    render(<TiffAssistant readyCount={2} canManage={false} />);
    const user = userEvent.setup();
    await user.click(libraryMode());
    await ask("why P8?");

    expect(await screen.findByText(/Ask a manager to add the manual/)).toBeInTheDocument();
  });
});

describe("after a general answer", () => {
  it("offers to go and look in the library, and re-asks with research on", async () => {
    render(<TiffAssistant readyCount={5} />);
    // general is a choice now, not the default — the offer is its exit
    await userEvent.setup().click(generalMode());
    await ask("why P8?");

    const offer = await screen.findByRole("button", { name: /Search the library for this/ });
    await userEvent.setup().click(offer);

    await waitFor(() => expect(asks).toHaveLength(2));
    expect(asks[1]).toMatchObject({ question: "why P8?", research: true });
  });

  it("makes no such offer when there is nothing to search", async () => {
    render(<TiffAssistant readyCount={0} />);
    await ask("why P8?");

    await screen.findByText(/piping temperature fault/);
    expect(screen.queryByRole("button", { name: /Search the library/ })).not.toBeInTheDocument();
  });
});

describe("when it goes wrong", () => {
  it("shows the sentence and a way to try the same question again", async () => {
    script = (emit) => emit({ t: "err", message: "Tiff is too busy right now — try again in a moment." });

    render(<TiffAssistant />);
    await ask("why P8?");

    expect(await screen.findByRole("alert")).toHaveTextContent("Tiff is too busy right now");

    script = (emit) => {
      emit({ t: "delta", text: "P8 is a piping fault." });
      emit({ t: "done" });
    };
    await userEvent.setup().click(screen.getByRole("button", { name: /Try again/ }));

    await screen.findByText("P8 is a piping fault.");
    expect(asks[1]).toMatchObject({ question: "why P8?" });
    // the question is not asked into the thread twice
    expect(stored()[0].messages.filter((m) => m.text === "why P8?")).toHaveLength(1);
  });

  it("marks an answer that ran to its ceiling", async () => {
    script = (emit) => {
      emit({ t: "delta", text: "P8 is" });
      emit({ t: "trunc" });
      emit({ t: "done" });
    };

    render(<TiffAssistant />);
    await ask("why P8?");
    expect(await screen.findByText(/ran to its limit/)).toBeInTheDocument();
  });
});

/* Two answers writing into one bubble is the failure this prevents. */
/* ── the bar says it is working ─────────────────────────────────────────
   The eye is on the bar when the wait starts: you press send and look at what
   you pressed. The thinking dots are up in the transcript and the lanes are
   out in the corridor, so between the press and the first word the composer
   said nothing and the screen read as frozen. */

describe("the composer while an answer is coming", () => {
  it("spins on the send button from the press until the answer lands", async () => {
    let push: (e: AskEvent) => void = () => {};
    script = (emit) => {
      push = emit;
    };
    render(<TiffAssistant />);

    // the name never changes — it is the send button throughout
    expect(screen.getByLabelText("Send")).toHaveAttribute("aria-busy", "false");

    await ask("why P8?");
    expect(screen.getByLabelText("Send")).toHaveAttribute("aria-busy", "true");

    // still working while the words are arriving — an answer half-written is
    // still an answer being written
    await act(async () => push({ t: "delta", text: "P8 is a piping fault." }));
    expect(screen.getByLabelText("Send")).toHaveAttribute("aria-busy", "true");

    await act(async () => push({ t: "done" }));
    expect(screen.getByLabelText("Send")).toHaveAttribute("aria-busy", "false");
  });

  /* A statement, never a lock: asking again mid-answer drops the first, which
     is the behaviour the test below this one pins. */
  it("keeps the button live so a second question can still interrupt", async () => {
    script = () => {};
    render(<TiffAssistant />);
    await ask("why P8?");

    expect(screen.getByLabelText("Send")).toBeEnabled();
  });

  it("gives the bar itself a working state, not just the button", async () => {
    script = () => {};
    const { container } = render(<TiffAssistant />);

    expect(container.querySelector(".tin.working")).toBeNull();
    await ask("why P8?");
    expect(container.querySelector(".tin.working")).not.toBeNull();
  });
});

describe("asking again mid-answer", () => {
  it("aborts the first stream before starting the second", async () => {
    script = () => {};
    render(<TiffAssistant />);

    await ask("why P8?");
    const first = asks[0].signal;
    expect(first?.aborted).toBe(false);

    await ask("and U4?");
    expect(first?.aborted).toBe(true);
    expect(asks).toHaveLength(2);
  });
});

describe("threads on this device", () => {
  it("stores under the v2 key and ignores whatever v1 left behind", async () => {
    localStorage.setItem(
      "heytiff.tiff.threads.v1",
      JSON.stringify([{ id: "old", title: "preview thread", updatedAt: 1, messages: [] }])
    );

    render(<TiffAssistant />);
    expect(screen.queryByText("preview thread")).not.toBeInTheDocument();

    await ask("why P8?");
    await waitFor(() => expect(stored()).toHaveLength(1));
    expect(stored()[0].messages[0].text).toBe("why P8?");
  });

  it("titles a thread from the question, capped", async () => {
    render(<TiffAssistant />);
    await ask("x".repeat(80));

    await waitFor(() => expect(stored()).toHaveLength(1));
    expect((stored()[0] as unknown as { title: string }).title).toHaveLength(53);
  });

  /* Resume matters more than the pitch for somebody who has asked before. */
  it("leads a returning user with their threads instead of the hero", () => {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify([{ id: "t-1", title: "R32 pressures", updatedAt: Date.now(), messages: [] }])
    );

    render(<TiffAssistant />);
    expect(screen.getByText("Pick up where you left off")).toBeInTheDocument();
    expect(screen.getByText("R32 pressures")).toBeInTheDocument();
    expect(screen.queryByText("What are we building today?")).not.toBeInTheDocument();
  });
});

/* ── arriving from a library row ─────────────────────────────────────────── */

describe("asked about a document", () => {
  const thread = (over: Record<string, unknown> = {}) => ({
    id: "t-1",
    title: "R32 pressures",
    updatedAt: Date.now(),
    messages: [],
    ...over,
  });

  it("opens with the document already in the box, answering from the library", () => {
    sessionStorage.setItem(ASK_KEY, "In “City Multi fault codes”, ");
    render(<TiffAssistant readyCount={3} />);

    const box = screen.getByLabelText("Ask Tiff") as HTMLInputElement;
    expect(box).toHaveValue("In “City Multi fault codes”, ");
    expect(box).toHaveFocus();
    expect(libraryMode()).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Your documents only, with the page it came from")).toBeInTheDocument();
  });

  /* The prefill is scaffolding. Sending it would spend a question nobody
     asked, on half a sentence. */
  it("sends nothing on its own", () => {
    sessionStorage.setItem(ASK_KEY, "In “City Multi fault codes”, ");
    render(<TiffAssistant readyCount={3} />);

    expect(asks).toHaveLength(0);
  });

  it("eats the note, so a refresh comes back to an empty box", () => {
    sessionStorage.setItem(ASK_KEY, "In “City Multi fault codes”, ");
    const first = render(<TiffAssistant readyCount={3} />);
    expect(sessionStorage.getItem(ASK_KEY)).toBeNull();

    first.unmount();
    render(<TiffAssistant readyCount={3} />);
    expect(screen.getByLabelText("Ask Tiff")).toHaveValue("");
  });

  /* A document was named, so the library HAS documents — but if the counts
     say otherwise the toggle stays where it is rather than being forced into
     a state it is disabled in. */
  it("leaves the toggle alone when there is nothing ready to search", () => {
    sessionStorage.setItem(ASK_KEY, "In “City Multi fault codes”, ");
    render(<TiffAssistant readyCount={0} />);

    const toggle = libraryMode();
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toBeDisabled();
    expect(screen.getByLabelText("Ask Tiff")).toHaveValue("In “City Multi fault codes”, ");
  });

  it("leaves the composer alone when no document sent anyone here", () => {
    localStorage.setItem(STORE_KEY, JSON.stringify([thread()]));
    render(<TiffAssistant readyCount={3} />);

    // empty box proves the handoff never fired; the switch sits on the
    // library because that is the stocked-library DEFAULT, not a handoff
    expect(screen.getByLabelText("Ask Tiff")).toHaveValue("");
    expect(libraryMode()).toHaveAttribute("aria-pressed", "true");
  });
});

/* ── renaming and dropping a conversation (brief §4A) ────────────────────── */

describe("managing a thread", () => {
  const seed = (threads: unknown[]) => localStorage.setItem(STORE_KEY, JSON.stringify(threads));

  const thread = (over: Record<string, unknown> = {}) => ({
    id: "t-1",
    title: "R32 pressures",
    updatedAt: 1_700_000_000_000,
    messages: [{ role: "user", text: "why P8?", at: 1_700_000_000_000 }],
    ...over,
  });

  const titles = () =>
    (JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]") as { title: string }[]).map(
      (t) => t.title
    );

  it("renames a thread from the list and keeps the new name", async () => {
    seed([thread()]);
    const user = userEvent.setup();
    render(<TiffAssistant />);

    await user.click(screen.getByRole("button", { name: /Rename “R32 pressures”/ }));
    const field = screen.getByLabelText("Chat title");
    expect(field).toHaveValue("R32 pressures");

    await user.clear(field);
    await user.type(field, "R32 pressures at 35°C");
    await user.click(screen.getByRole("button", { name: /Save name/ }));

    expect(titles()).toEqual(["R32 pressures at 35°C"]);
    expect(screen.getByText("R32 pressures at 35°C")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("commits on Enter, because it is a one-field question", async () => {
    seed([thread()]);
    const user = userEvent.setup();
    render(<TiffAssistant />);

    await user.click(screen.getByRole("button", { name: /Rename “R32 pressures”/ }));
    await user.clear(screen.getByLabelText("Chat title"));
    await user.type(screen.getByLabelText("Chat title"), "Warranty steps{Enter}");

    expect(titles()).toEqual(["Warranty steps"]);
  });

  it("caps the title and refuses an empty one", async () => {
    seed([thread()]);
    const user = userEvent.setup();
    render(<TiffAssistant />);

    await user.click(screen.getByRole("button", { name: /Rename “R32 pressures”/ }));
    const field = screen.getByLabelText("Chat title");
    expect(field).toHaveAttribute("maxLength", "60");

    await user.clear(field);
    expect(screen.getByRole("button", { name: /Save name/ })).toBeDisabled();

    await user.type(field, "z".repeat(70));
    expect((field as HTMLInputElement).value).toHaveLength(60);
  });

  it("leaves the thread as it was when the rename is cancelled", async () => {
    seed([thread()]);
    const user = userEvent.setup();
    render(<TiffAssistant />);

    await user.click(screen.getByRole("button", { name: /Rename “R32 pressures”/ }));
    await user.clear(screen.getByLabelText("Chat title"));
    await user.type(screen.getByLabelText("Chat title"), "not this");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(titles()).toEqual(["R32 pressures"]);
  });

  /* The family had the backdrop and the ✕ but no key — with the title field
     focused, the keyboard's own way out went nowhere (verified live). */
  it("closes the rename box on Escape, saving nothing", async () => {
    seed([thread()]);
    const user = userEvent.setup();
    render(<TiffAssistant />);

    await user.click(screen.getByRole("button", { name: /Rename “R32 pressures”/ }));
    await user.clear(screen.getByLabelText("Chat title"));
    await user.type(screen.getByLabelText("Chat title"), "not this");
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(titles()).toEqual(["R32 pressures"]);
  });

  it("closes the delete confirm on Escape, deleting nothing", async () => {
    seed([thread()]);
    const user = userEvent.setup();
    render(<TiffAssistant />);

    await user.click(screen.getByRole("button", { name: /Delete “R32 pressures”/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(titles()).toEqual(["R32 pressures"]);
  });

  it("names the thread in the confirm before it removes it", async () => {
    seed([thread(), thread({ id: "t-2", title: "U4 error", updatedAt: 1 })]);
    const user = userEvent.setup();
    render(<TiffAssistant />);

    await user.click(screen.getByRole("button", { name: /Delete “R32 pressures”/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Delete “R32 pressures”\?/)).toBeInTheDocument();
    expect(within(dialog).getByText(/no copy elsewhere and no undo/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: /Delete “R32 pressures”/ }));

    expect(titles()).toEqual(["U4 error"]);
    expect(screen.queryByText("R32 pressures")).not.toBeInTheDocument();
  });

  it("keeps the thread when the confirm is declined", async () => {
    seed([thread()]);
    const user = userEvent.setup();
    render(<TiffAssistant />);

    await user.click(screen.getByRole("button", { name: /Delete “R32 pressures”/ }));
    await user.click(screen.getByRole("button", { name: "Keep it" }));

    expect(titles()).toEqual(["R32 pressures"]);
  });

  /* Deleting the conversation you are reading has to put you somewhere, and
     the transcript of a thread that no longer exists is not somewhere. */
  it("returns to the landing when the open thread is the one deleted", async () => {
    const user = userEvent.setup();
    render(<TiffAssistant readyCount={2} />);
    await ask("why P8?");
    await waitFor(() => expect(stored()[0]?.messages).toHaveLength(2));

    await user.click(screen.getByRole("button", { name: /Delete “why P8\?”/ }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /^Delete “why P8\?”$/ })
    );

    expect(titles()).toEqual([]);
    expect(screen.queryByText("P8 is a piping temperature fault.")).not.toBeInTheDocument();
    // the last thread went with it, so this is a first-run landing again
    expect(screen.getByRole("heading", { name: "What are we working on?" })).toBeInTheDocument();
  });

  it("renames the open thread from its own header", async () => {
    const user = userEvent.setup();
    render(<TiffAssistant />);
    await ask("why P8?");
    await waitFor(() => expect(stored()).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: /Rename “why P8\?”/ }));
    await user.clear(screen.getByLabelText("Chat title"));
    await user.type(screen.getByLabelText("Chat title"), "P8 diagnosis{Enter}");

    expect(titles()).toEqual(["P8 diagnosis"]);
    // the header is showing the new name, and we are still in the thread
    expect(screen.getByText("P8 diagnosis")).toBeInTheDocument();
    expect(screen.getByText("P8 is a piping temperature fault.")).toBeInTheDocument();
  });

  it("opens the thread when the row itself is pressed, not its actions", async () => {
    seed([thread()]);
    const user = userEvent.setup();
    render(<TiffAssistant />);

    // the title itself, not one of the two icons beside it
    await user.click(screen.getByText("R32 pressures").closest("button") as HTMLElement);
    expect(screen.getByText("why P8?")).toBeInTheDocument();
  });
});

/* ── the way back out ────────────────────────────────────────────────────── */

describe("leaving a conversation", () => {
  const seed = (threads: unknown[]) => localStorage.setItem(STORE_KEY, JSON.stringify(threads));

  const thread = (over: Record<string, unknown> = {}) => ({
    id: "t-1",
    title: "R32 pressures",
    updatedAt: 1_700_000_000_000,
    messages: [{ role: "user", text: "why P8?", at: 1_700_000_000_000 }],
    ...over,
  });

  const back = () => screen.getByRole("button", { name: "Back to Tiff AI" });

  /* `history.back()` is stubbed for the whole block: jsdom's window is shared
     across tests, so a REAL traversal walks onto some earlier test's pushed
     entry and the echo popstate carries that entry's stale marker — a stack
     shape the app can never produce, because every on-screen close consumes
     its own entry before another can be pushed. The stub keeps each test's
     history inert; popstates are dispatched by hand where they are the point. */
  let backStub: jest.SpyInstance;
  beforeEach(() => {
    backStub = jest.spyOn(window.history, "back").mockImplementation(() => {});
  });
  afterEach(() => backStub.mockRestore());

  it("returns to the landing with the thread kept and the input untouched", async () => {
    seed([thread()]);
    const user = userEvent.setup();
    render(<TiffAssistant />);

    await user.click(screen.getByText("R32 pressures").closest("button") as HTMLElement);
    await user.type(screen.getByLabelText("Ask Tiff"), "half a question");
    await user.click(back());

    // landing again, thread still in the list, half-typed question still there
    expect(screen.getByText("Pick up where you left off")).toBeInTheDocument();
    expect(screen.getByText("R32 pressures")).toBeInTheDocument();
    expect(screen.getByLabelText("Ask Tiff")).toHaveValue("half a question");
    expect(screen.queryByRole("button", { name: "Back to Tiff AI" })).not.toBeInTheDocument();
  });

  /* Back is a navigation, not an undo: an answer cut off mid-stream is worth
     more in the thread than nothing — same rule as the error path. */
  it("keeps a half-written answer in the thread when back is pressed mid-stream", async () => {
    let push: (e: AskEvent) => void = () => {};
    script = (emit) => {
      push = emit;
    };
    const user = userEvent.setup();
    render(<TiffAssistant />);
    await ask("why P8?");
    await act(async () => push({ t: "delta", text: "P8 is a piping" }));

    await user.click(back());

    expect(screen.getByText("Pick up where you left off")).toBeInTheDocument();
    const messages = stored()[0]?.messages ?? [];
    expect(messages).toHaveLength(2);
    expect(messages[1].text).toBe("P8 is a piping");
  });

  /* The browser's own back button. Opening a thread pushes one same-URL
     history entry; popping it closes the chat — and the handler is idempotent,
     because on-screen closes consume the entry via history.back() AFTER the
     state has already been reset. */
  it("owns one history entry per open, and browser back closes the chat", async () => {
    const pushSpy = jest.spyOn(window.history, "pushState");
    seed([thread()]);
    const user = userEvent.setup();
    render(<TiffAssistant />);

    await user.click(screen.getByText("R32 pressures").closest("button") as HTMLElement);
    expect(pushSpy).toHaveBeenCalledWith({ tiffChat: "t-1" }, "");
    expect(pushSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });

    expect(screen.getByText("Pick up where you left off")).toBeInTheDocument();
    pushSpy.mockRestore();
  });

  it("consumes its history entry when the chat is closed on screen", async () => {
    seed([thread()]);
    const user = userEvent.setup();
    render(<TiffAssistant />);

    await user.click(screen.getByText("R32 pressures").closest("button") as HTMLElement);
    await user.click(back());
    expect(backStub).toHaveBeenCalledTimes(1);

    // the echo popstate that history.back() will fire finds nothing to undo
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });
    expect(screen.getByText("Pick up where you left off")).toBeInTheDocument();

    // and the next open/close cycle owns exactly one entry of its own
    await user.click(screen.getByText("R32 pressures").closest("button") as HTMLElement);
    await user.click(back());
    expect(backStub).toHaveBeenCalledTimes(2);
  });

  it("reopens the thread when forward walks back onto its entry", async () => {
    seed([thread()]);
    render(<TiffAssistant />);

    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: { tiffChat: "t-1" } }));
    });

    expect(screen.getByText("why P8?")).toBeInTheDocument();
  });

  it("sending the first question also owns a history entry", async () => {
    const pushSpy = jest.spyOn(window.history, "pushState");
    render(<TiffAssistant />);
    await ask("why P8?");

    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect((pushSpy.mock.calls[0][0] as { tiffChat?: string }).tiffChat).toBeTruthy();
    pushSpy.mockRestore();
  });
});

describe("the rail", () => {
  it("shows a live count per category and links into the filtered library", () => {
    render(
      <TiffAssistant readyCount={5} counts={{ install: 3, faults: 2, specs: 0, sops: 0, field: 0 }} canManage />
    );

    const card = screen.getByRole("link", { name: /Installation documents/ });
    expect(card).toHaveAttribute("href", "/dashboard/tiff/library?cat=install");
    expect(within(card).getByText("3 documents")).toBeInTheDocument();
    expect(within(screen.getByRole("link", { name: /Manufacturer specs/ })).getByText("None yet")).toBeInTheDocument();
  });

  /* The foot of the rail once held "Open library" and "Add documents" pointing
     at the SAME url, then an Add tile, then a running total. All three are
     gone: uploading belongs to the library screen, and so does saying how big
     the library is. What is left is the categories and one way in. */
  it("offers one way into the library, and nothing else below the cards", () => {
    render(<TiffAssistant readyCount={5} counts={{ install: 5, faults: 0, specs: 0, sops: 0, field: 0 }} canManage />);

    expect(screen.getByRole("link", { name: /^Open/ })).toHaveAttribute(
      "href",
      "/dashboard/tiff/library"
    );
    expect(screen.queryByRole("link", { name: /Add document/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add document/i })).not.toBeInTheDocument();
    // the running total is the library's line, and the cards carry it per category
    expect(screen.queryByText(/documents? Tiff can read/)).not.toBeInTheDocument();
    expect(screen.queryByText("Nothing in the library yet")).not.toBeInTheDocument();
  });

  /* The rail is the same object for everybody now: `tiff_manage` gated the Add
     control, and `readyCount` fed the total, and neither is rendered here. */
  it("shows the same rail whether or not you can upload", () => {
    const { unmount } = render(<TiffAssistant readyCount={0} canManage />);
    const managerRail = document.querySelector(".tk-rail")!.textContent;
    unmount();

    render(<TiffAssistant readyCount={0} canManage={false} />);
    expect(document.querySelector(".tk-rail")!.textContent).toBe(managerRail);
    expect(screen.getByRole("link", { name: /^Open/ })).toBeInTheDocument();
  });
});

/* ── the landing ─────────────────────────────────────────────────────────── */

describe("the search-first landing", () => {
  it("opens on the box, not on an introduction", () => {
    render(<TiffAssistant readyCount={0} />);

    expect(screen.getByRole("heading", { name: "What are we working on?" })).toBeInTheDocument();
    expect(screen.getByLabelText("Ask Tiff")).toBeInTheDocument();
    // the v1 hero and its four cards are gone for good
    expect(screen.queryByText(/What are we building today/)).not.toBeInTheDocument();
    expect(screen.queryByText("DIAGNOSTICS")).not.toBeInTheDocument();
  });

  it("says how many documents it would be answering from, and names the switch", () => {
    render(<TiffAssistant readyCount={12} />);

    expect(screen.getByText(/answer from the 12 documents in it/)).toBeInTheDocument();
    // the words the subline points at are the words printed on the control
    expect(screen.getByText("your library")).toBeInTheDocument();
  });

  /* The four canned questions are gone. They were the same four on every visit,
     and two of them named a category this workspace might hold nothing in. */
  it("offers no canned questions under the box", () => {
    render(<TiffAssistant readyCount={3} />);

    expect(screen.queryByRole("button", { name: /R32 running pressures/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /fault code U4/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /VRF/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /warranty claim/i })).not.toBeInTheDocument();
  });
});

/* ── the rail during a search ────────────────────────────────────────────── */

/* The lines themselves are jsdom-invisible (every rect is 0×0, and the overlay
   hides below the stacked breakpoint anyway), and their choreography is proved
   on its own in lib/tiff/__tests__/research-viz.test.ts. What belongs here is
   the WIRING: that the rail's state comes from the ask flow's real events, and
   that every way out of a question takes it away again. */

describe("watching Tiff search", () => {
  const CARDS: Record<string, RegExp> = {
    install: /Installation documents/,
    faults: /Service documents/,
    specs: /Manufacturer specs/,
    sops: /Company SOPs/,
    field: /Field notes/,
  };

  const counts = { install: 3, faults: 7, specs: 2, sops: 1, field: 0 };

  const card = (key: keyof typeof CARDS) => screen.getByRole("link", { name: CARDS[key] });

  /** The state class the machine put on a shelf, or "" for none. */
  const state = (key: keyof typeof CARDS) =>
    card(key)
      .className.split(" ")
      .filter((c) => c !== "tk-rcat" && c !== "spot")
      .join(" ");

  const note = (key: keyof typeof CARDS) =>
    within(card(key)).getByText(/./, { selector: ".tk-rtx em" }).textContent;

  const TRACE: AskEvent = {
    t: "trace",
    categories: {
      install: { hits: 2, topDoc: "Install manual" },
      faults: { hits: 4, topDoc: "City Multi fault codes" },
      specs: { hits: 0, topDoc: null },
      sops: { hits: 0, topDoc: null },
      field: { hits: 0, topDoc: null },
    },
    winners: ["faults"],
    terms: ["P8", "piping temperature"],
  };

  /** Ask with Research on, and hand back the emitter so the stream can be
      driven one event at a time. */
  const research = async () => {
    let push: (e: AskEvent) => void = () => {};
    script = (emit) => {
      push = emit;
    };
    render(<TiffAssistant readyCount={13} counts={counts} />);
    const user = userEvent.setup();
    await user.click(libraryMode());
    await ask("why P8?");
    return { push: async (e: AskEvent) => act(async () => push(e)), user };
  };

  /* EVERY shelf, the empty ones included — retrieval covers the whole
     library, and the sweep converging on the winner is the page's story. A
     stocked-shelves-only gate shipped here once; with one stocked shelf it
     reduced the choreography to a single line straight to the answer, and
     the owner called it back. */
  it("sends a line to every shelf the moment the question goes out", async () => {
    await research();

    for (const key of Object.keys(CARDS) as (keyof typeof CARDS)[]) {
      expect(state(key)).toBe("searching");
      expect(note(key)).toBe("Searching…");
    }
  });

  it("leaves the rail alone for a general question", async () => {
    render(<TiffAssistant readyCount={13} counts={counts} />);
    await userEvent.setup().click(generalMode());
    await ask("why P8?");

    expect(state("faults")).toBe("");
    expect(note("faults")).toBe("7 documents");
  });


  it("lights the shelf the answer came from and reports what each one held", async () => {
    const { push } = await research();
    await push(TRACE);

    // the winner names the document the answer is being built out of — the
    // one the citation underneath is about to be checked against
    expect(state("faults")).toBe("winner");
    expect(note("faults")).toBe("City Multi fault codes");

    // searched, found something, not what the answer was built from: a count
    // and no title, or the rail becomes a second results list
    expect(state("install")).toBe("hit");
    expect(note("install")).toBe("Also matched");

    // searched, empty
    expect(state("specs")).toBe("dim");
    expect(note("specs")).toBe("—");
    expect(state("sops")).toBe("dim");
  });

  /* The trace was forwarded card by card from a hand-written list of four, so
     the fifth card sat at "Searching…" forever and could never win — even
     though the server, the reducer and the rail all knew about it. */
  it("reports the field-note category like every other one", async () => {
    const { push } = await research();
    await push({
      ...TRACE,
      categories: {
        install: { hits: 0, topDoc: null },
        faults: { hits: 0, topDoc: null },
        specs: { hits: 0, topDoc: null },
        sops: { hits: 0, topDoc: null },
        field: { hits: 3, topDoc: "Roof access at Westfield" },
      },
      winners: ["field"],
    } as AskEvent);

    expect(state("field")).toBe("winner");
    expect(note("field")).toBe("Roof access at Westfield");
  });

  it("holds that while the answer is written", async () => {
    const { push } = await research();
    await push(TRACE);
    await push({ t: "delta", text: "Check the liquid line thermistor." });

    expect(await screen.findByText(/liquid line thermistor/)).toBeInTheDocument();
    expect(state("faults")).toBe("winner");
    expect(state("specs")).toBe("dim");
  });

  it("keeps the winner lit and gives every other shelf its count back", async () => {
    const { push } = await research();
    await push(TRACE);
    await push({ t: "delta", text: "Check the liquid line thermistor." });
    await push({ t: "done" });

    expect(state("faults")).toBe("winner");
    expect(note("faults")).toBe("City Multi fault codes");
    expect(state("install")).toBe("");
    expect(note("install")).toBe("3 documents");
    expect(state("specs")).toBe("");
  });

  /* The banner above the answer says the library had nothing. A rail still
     mid-search underneath it would be arguing with it. */
  it("puts every shelf back on a miss", async () => {
    const { push } = await research();
    await push({ t: "miss" });

    for (const key of Object.keys(CARDS) as (keyof typeof CARDS)[]) {
      expect(state(key)).toBe("");
    }
    expect(note("faults")).toBe("7 documents");
  });

  it("clears the rail when the answer fails", async () => {
    const { push } = await research();
    await push(TRACE);
    await push({ t: "err", message: "Tiff couldn't answer that just now." });

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(state("faults")).toBe("");
  });

  it("starts the search over for the next question", async () => {
    const { push } = await research();
    await push(TRACE);
    await push({ t: "delta", text: "Check the thermistor." });
    await push({ t: "done" });
    expect(state("faults")).toBe("winner");

    await ask("and U4?");
    expect(state("faults")).toBe("searching");
    expect(state("specs")).toBe("searching");
  });

  it("drops it when the conversation is put down", async () => {
    const { push, user } = await research();
    await push(TRACE);
    await push({ t: "done" });

    await user.click(screen.getByRole("button", { name: /New chat/ }));
    expect(state("faults")).toBe("");
  });

  /* jsdom has no matchMedia at all, so the overlay stays hidden for every test
     above — which is what the stacked breakpoint would do anyway. This one
     hands it a wide screen, because the one thing the overlay's own tests
     cannot prove is that THIS screen gives it a stage, a composer and four
     cards to measure between. Coordinates remain 0×0 and unasserted. */
  it("hands the line overlay every endpoint it needs", async () => {
    window.matchMedia = ((media: string) =>
      ({
        media,
        matches: true,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;

    try {
      const { push } = await research();
      const svg = document.querySelector("svg.tk-lines");
      expect(svg).not.toBeNull();
      expect(svg!.querySelectorAll("path.tk-line.draw")).toHaveLength(5);
      expect(svg!.querySelectorAll("path.tk-line.pulse")).toHaveLength(5);

      await push(TRACE);
      expect(document.querySelectorAll("path.tk-line.lit")).toHaveLength(1);
      expect(document.querySelector('path.tk-line.lit')).toHaveAttribute("data-cat", "faults");
    } finally {
      delete (window as { matchMedia?: unknown }).matchMedia;
    }
  });
});
