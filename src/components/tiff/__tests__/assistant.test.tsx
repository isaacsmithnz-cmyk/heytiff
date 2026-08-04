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

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
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

  it("renders bullets as a real list, not as characters", async () => {
    script = (emit) => {
      emit({ t: "delta", text: "Check:\n- the thermistor\n- the harness" });
      emit({ t: "done" });
    };
    render(<TiffAssistant readyCount={3} counts={{ install: 3, faults: 0, specs: 0, sops: 0 }} />);
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

/* ── research: a choice, made visible before and after ───────────────────── */

describe("the research toggle", () => {
  it("is disabled with an explanation when the library is empty", () => {
    render(<TiffAssistant readyCount={0} />);
    const toggle = screen.getByRole("button", { name: /research/i });

    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute("title", "Upload documents to the library first");
    expect(screen.getByText("General knowledge")).toBeInTheDocument();
  });

  it("flips the hint and the pressed state, and asks the library", async () => {
    const user = userEvent.setup();
    render(<TiffAssistant readyCount={4} counts={{ install: 4, faults: 0, specs: 0, sops: 0 }} />);

    const toggle = screen.getByRole("button", { name: /research/i });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Digging through the library")).toBeInTheDocument();

    await ask("why P8?");
    expect(asks[0]).toMatchObject({ research: true });
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
    render(<TiffAssistant readyCount={2} counts={{ install: 0, faults: 2, specs: 0, sops: 0 }} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /research/i }));
    await ask("why P8?");
    return user;
  };

  it("renders a numbered chip per cited document, with its page", async () => {
    await renderResearched([src(), src({ n: 2, chunkId: "c-2", docId: "d-2", title: "Install manual", pageFrom: 12, pageTo: 14 })]);

    expect(await screen.findByRole("button", { name: /Source 1: City Multi fault codes, p.41/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Source 2: Install manual, p.12–14/ })).toBeInTheDocument();
  });

  it("opens the excerpt in a peek panel", async () => {
    const user = await renderResearched();
    await user.click(await screen.findByRole("button", { name: /Source 1/ }));

    const peek = screen.getByRole("dialog");
    expect(within(peek).getByText(/abnormal piping temperature/)).toBeInTheDocument();
    expect(within(peek).getByText(/Fault code library/)).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: /research/i }));
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
    await user.click(screen.getByRole("button", { name: /research/i }));
    await ask("why P8?");

    expect(await screen.findByText(/Ask a manager to add the manual/)).toBeInTheDocument();
  });
});

describe("after a general answer", () => {
  it("offers to go and look in the library, and re-asks with research on", async () => {
    render(<TiffAssistant readyCount={5} />);
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

describe("the rail", () => {
  it("shows a live count per shelf and links into the filtered library", () => {
    render(
      <TiffAssistant readyCount={5} counts={{ install: 3, faults: 2, specs: 0, sops: 0 }} canManage />
    );

    const card = screen.getByRole("link", { name: /Install procedures/ });
    expect(card).toHaveAttribute("href", "/dashboard/tiff/knowledge?cat=install");
    expect(within(card).getByText("3 documents")).toBeInTheDocument();
    expect(within(screen.getByRole("link", { name: /Manufacturer specs/ })).getByText("—")).toBeInTheDocument();

    expect(screen.getByText("5 documents Tiff can read")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add documents" })).toBeInTheDocument();
  });

  it("keeps the upload offer away from someone who can't upload", () => {
    render(<TiffAssistant readyCount={0} canManage={false} />);

    expect(screen.getByText("Nothing in the library yet")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add documents" })).not.toBeInTheDocument();
  });
});
