import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { NoteScopeProvider } from "@/components/notes/note-context";
import { TiffPanel } from "../tiff-panel";


/* Tiff on the quote, the page's main column (slice 5.1; the chat-first page,
   Isaac, 2026-10-13): off until her model is chosen; then her thread, what's
   To confirm with each answer priced at its foot, and the box to reply to
   her. */

const thread = {
  ok: true,
  on: true,
  working: false,
  spentUsd: 0.71,
  me: "u-isaac",
  names: { "u-luke": "Luke Bennett" },
  events: [
    { id: 1, turnId: "t1", kind: "message", author: "u-luke", at: "", body: { text: "Ducted for the whole house" } },
    { id: 2, turnId: "t1", kind: "tool", author: "tiff", at: "", body: { name: "add_kit", label: "Added a kit", ok: true, said: "Ducted, 12 parts" } },
    { id: 3, turnId: "t1", kind: "question", author: "tiff", at: "", body: { question: "Single or three phase?", answers: [{ label: "Single phase" }, { label: "Three phase" }] } },
    { id: 4, turnId: "t1", kind: "reply", author: "tiff", at: "", body: { text: "A 12.5 kW ducted, priced from your book." } },
    { id: 5, turnId: null, kind: "milestone", author: "u-isaac", at: "", body: { text: "Option 1 accepted" } },
  ],
  questions: { 3: { deltas: [0, 51996], answered: null } },
};

let posted: Record<string, unknown>[] = [];
const respond = (body: unknown) => ({ json: async () => body });

beforeEach(() => {
  posted = [];
});

/* with her off there is no conversation: the page lays the line items out
   in its place, and lists what's to confirm in its rail */
it("has nothing of its own while Tiff is off, and tells the page so", async () => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => respond({ ok: true, on: false, events: [] }));
  const onStatus = jest.fn();
  const { container } = render(<TiffPanel job="j" onChanged={jest.fn()} onStatus={onStatus} />);
  await act(async () => {});
  expect(onStatus).toHaveBeenLastCalledWith({ on: false, spentUsd: null });
  expect(container).toBeEmptyDOMElement();
  expect(screen.queryByText("Core hole: not known yet")).toBeNull();
});

/* THE QUOTE'S OWN TAB (Isaac, 21 November 2026, "Build all three" to
   https://claude.ai/artifact/EAB8Y8FsbnPbcuBXKDhT93): the page holds the
   faces there, so her questions are answered in the talk itself, each a
   group of answers to tap */
it("on the quote's own tab, puts her open questions in the talk as groups of answers to tap", async () => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (_url: string, init?: { body?: string }) => {
    if (init?.body) posted.push(JSON.parse(init.body));
    return respond(thread);
  });
  render(<TiffPanel job="j" onChanged={jest.fn()} />);
  const asks = within(await screen.findByRole("region", { name: "Tiff's questions" }));
  expect(asks.getByText("Single or three phase?")).toBeInTheDocument();
  const taps = asks.getAllByRole("button").filter((b) => b.classList.contains("qx-answer"));
  expect(taps.map((b) => b.textContent)).toEqual(["Single phase", "Three phase+$520"]);
  /* buttons, the likely one blue, as the phone has them (Isaac, 24 November 2026) */
  const [likely, other] = taps;
  expect(likely).toHaveClass("pt-btn--main", "pt-btn--44", "qx-answer");
  expect(other).toHaveClass("pt-btn--second", "qx-answer");
  /* her words come first, the questions under them, then the box */
  const said = screen.getByText("A 12.5 kW ducted, priced from your book.");
  expect((said.compareDocumentPosition(asks.getByText("Single or three phase?")) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
  await act(async () => {
    fireEvent.click(asks.getByRole("button", { name: /^Three phase/ }));
  });
  expect(posted).toContainEqual({ job: "j", op: "answer", event: 3, answer: 1 });
});

/* ONE AT A TIME (Isaac, 26 November 2026, "B"): the one answered a ticked
   line with Change, the one you're on the card under it, the rest to come */
const three = {
  ...thread,
  events: [
    ...thread.events.slice(0, 3),
    { id: 6, turnId: "t1", kind: "question", author: "tiff", at: "", body: { question: "Roof or ground?", topic: "Outdoor", answers: [{ label: "Roof" }, { label: "Ground" }] } },
    { id: 7, turnId: "t1", kind: "question", author: "tiff", at: "", body: { question: "How long is the pipe run?", put: "10 m", answers: [] } },
    thread.events[3]!,
  ],
  questions: { 3: { deltas: [0, 51996], answered: null }, 6: { deltas: [0, 0], answered: null }, 7: { deltas: [], answered: null } },
};

it("asks one question at a time: answered, it's a line with Change, and the next is up", async () => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (_url: string, init?: { body?: string }) => {
    if (init?.body) {
      posted.push(JSON.parse(init.body));
      return respond({ ok: true });
    }
    return respond(three);
  });
  render(<TiffPanel job="j" onChanged={jest.fn()} />);
  const asks = within(await screen.findByRole("region", { name: "Tiff's questions" }));
  expect(asks.getByText("Question 1 of 3")).toBeInTheDocument();
  expect(asks.queryByText("Roof or ground?")).toBeNull();
  await act(async () => {
    fireEvent.click(asks.getByRole("button", { name: /^Three phase/ }));
  });
  expect(posted).toContainEqual({ job: "j", op: "answer", event: 3, answer: 1 });
  /* the next is up at once, while she works on the first */
  expect(asks.getByText("Question 2 of 3")).toBeInTheDocument();
  expect(asks.getByText("Roof or ground?")).toBeInTheDocument();
  expect(asks.getByText("Three phase").closest(".qx-done")).toBeInTheDocument();
  expect(asks.getByRole("button", { name: "Change your answer to: Single or three phase?" })).toBeInTheDocument();
});

it("sends your own answer to the question it's under, with the question, and gives way to her once the last is answered", async () => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (_url: string, init?: { body?: string }) => {
    if (init?.body) {
      posted.push(JSON.parse(init.body));
      return respond({ ok: true, turn: "t2" });
    }
    return respond({ ...three, questions: { ...three.questions, 3: { deltas: [0, 51996], answered: { label: "Three phase", typed: false } }, 6: { deltas: [0, 0], answered: { label: "Roof", typed: false } } } });
  });
  render(<TiffPanel job="j" onChanged={jest.fn()} />);
  const field = await screen.findByLabelText("Your own answer to: How long is the pipe run?");
  /* a question with nothing to tap is its field alone */
  expect(screen.getByText("Question 3 of 3")).toBeInTheDocument();
  fireEvent.change(field, { target: { value: "6, 12 and 14 m" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send your answer to Tiff" }));
  });
  expect(posted).toContainEqual({ job: "j", message: "How long is the pipe run? 6, 12 and 14 m" });
  /* the last answered, she works on them: the questions give way to her */
  expect(screen.queryByRole("region", { name: "Tiff's questions" })).toBeNull();
});

it("asks an answered one again from its Change, its answer marked, and Leave it as it is closes it", async () => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (_url: string, init?: { body?: string }) => {
    if (init?.body) {
      posted.push(JSON.parse(init.body));
      return respond({ ok: true, turn: "t2" });
    }
    return respond({ ...three, questions: { ...three.questions, 3: { deltas: [0, 51996], answered: { label: "Three phase", typed: false } } } });
  });
  render(<TiffPanel job="j" onChanged={jest.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Change your answer to: Single or three phase?" }));
  expect(screen.getByText("Changing question 1")).toBeInTheDocument();
  const yours = screen.getByRole("button", { name: /^Three phase/ });
  expect(yours).toHaveAttribute("aria-pressed", "true");
  expect(yours).toBeDisabled();
  /* one at a time: the open one waits while you change this */
  expect(screen.queryByText("Roof or ground?")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Leave it as it is" }));
  expect(screen.getByText("Roof or ground?")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Change your answer to: Single or three phase?" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Single phase" }));
  });
  /* a change goes to her, who changes the quote */
  expect(posted).toContainEqual({ job: "j", message: "Single or three phase? Single phase" });
});

it("opens Settle over the talk from the panel's button: one question large, Skip for now, Previous and Back to the chat", async () => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (_url: string, init?: { body?: string }) => {
    if (init?.body) {
      posted.push(JSON.parse(init.body));
      return respond({ ok: true });
    }
    return respond(three);
  });
  const { rerender } = render(<TiffPanel job="j" onChanged={jest.fn()} settle={0} />);
  await screen.findByRole("region", { name: "Tiff's questions" });
  expect(screen.queryByRole("region", { name: "Questions to settle" })).toBeNull();
  rerender(<TiffPanel job="j" onChanged={jest.fn()} settle={1} />);
  const settle = within(screen.getByRole("region", { name: "Questions to settle" }));
  expect(settle.getByText("1 of 3")).toBeInTheDocument();
  expect(screen.getByLabelText("Message Tiff").closest(".qc-comp")).not.toBeVisible();
  fireEvent.click(settle.getByRole("button", { name: "Skip for now" }));
  expect(settle.getByText("Roof or ground?")).toBeInTheDocument();
  expect(settle.getByText("2 of 3")).toBeInTheDocument();
  await act(async () => {
    fireEvent.click(settle.getByRole("button", { name: "Roof" }));
  });
  expect(posted).toContainEqual({ job: "j", op: "answer", event: 6, answer: 0 });
  /* settled under it, and Previous asks it again */
  expect(within(settle.getByRole("heading", { name: "Settled" }).parentElement!).getByText("Roof")).toBeInTheDocument();
  fireEvent.click(settle.getByRole("button", { name: "Previous" }));
  expect(settle.getByText("Changing question 2")).toBeInTheDocument();
  fireEvent.click(settle.getByRole("button", { name: "Back to the chat" }));
  expect(screen.queryByRole("region", { name: "Questions to settle" })).toBeNull();
  expect(screen.getByLabelText("Message Tiff")).toBeVisible();
});

it("leaves out her numbered repeat of the questions she asks under it", async () => {
  const listed = { ...three, events: three.events.map((e) => (e.kind === "reply" ? { ...e, body: { text: "Three things to check.\n\n1. Single or three phase?\n2. Roof or ground?" } } : e)) };
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => respond(listed));
  render(<TiffPanel job="j" onChanged={jest.fn()} />);
  expect(await screen.findByText("Three things to check.")).toBeInTheDocument();
  expect(document.querySelector(".qc-says ol")).toBeNull();
});

it("draws none once all are answered", async () => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => respond({ ...three, questions: { 3: { deltas: [], answered: { label: "Three phase", typed: false } }, 6: { deltas: [], answered: { label: "Roof", typed: false } }, 7: { deltas: [], answered: { label: "14 m", typed: true } } } }));
  render(<TiffPanel job="j" onChanged={jest.fn()} />);
  await screen.findByText("A 12.5 kW ducted, priced from your book.");
  expect(screen.queryByRole("region", { name: "Tiff's questions" })).toBeNull();
});

it("reads as off when her thread can't be read, rather than leaving the page waiting", async () => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => {
    throw new Error("offline");
  });
  const onStatus = jest.fn();
  render(<TiffPanel job="j" onChanged={jest.fn()} onStatus={onStatus} />);
  await act(async () => {});
  expect(onStatus).toHaveBeenLastCalledWith({ on: false, spentUsd: null });
});

/* the first read lays the page out, and pricing her questions reads the
   book: the whole column, the line items too, waited on it. Her questions
   follow it, priced; until then whether one is answered isn't known, so none
   shows open */
it("tells the page she's on before her questions are priced, and shows none open until they are", async () => {
  let priced: (v: unknown) => void = () => undefined;
  (global as unknown as { fetch: unknown }).fetch = jest.fn((url: string) =>
    String(url).includes("questions=1")
      ? new Promise((done) => {
          priced = (v) => done(respond(v));
        })
      : Promise.resolve(respond({ ...thread, questions: undefined }))
  );
  const onStatus = jest.fn();
  const onOpen = jest.fn();
  render(<TiffPanel job="j" onChanged={jest.fn()} onStatus={onStatus} onOpen={onOpen} />);
  expect(await screen.findByText("A 12.5 kW ducted, priced from your book.")).toBeInTheDocument();
  expect(onStatus).toHaveBeenLastCalledWith({ on: true, spentUsd: 0.71 });
  expect(screen.queryByText("Single or three phase?")).toBeNull();
  expect(onOpen).toHaveBeenLastCalledWith(0);
  await act(async () => priced({ ...thread, events: [] }));
  expect(await screen.findByRole("button", { name: /Three phase/ })).toHaveTextContent("+$520");
  expect(onOpen).toHaveBeenLastCalledWith(1);
});

/* 2026-10-14: what she's cost went to a tech too; the route now sends it only
   to someone who sees money. Since 2026-10-13 the rail says it, so the page
   is told it, and the column never says it */
it("tells the page what she cost only when the route sends it, and never says it itself", async () => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => respond(thread));
  const onStatus = jest.fn();
  const { unmount } = render(<TiffPanel job="j" onChanged={jest.fn()} onStatus={onStatus} />);
  expect(await screen.findByText("A 12.5 kW ducted, priced from your book.")).toBeInTheDocument();
  expect(onStatus).toHaveBeenLastCalledWith({ on: true, spentUsd: 0.71 });
  expect(screen.queryByText(/on this quote/)).toBeNull();
  unmount();

  const { spentUsd: _, ...noSpend } = thread;
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => respond(noSpend));
  render(<TiffPanel job="j" onChanged={jest.fn()} onStatus={onStatus} />);
  expect(await screen.findByText("A 12.5 kW ducted, priced from your book.")).toBeInTheDocument();
  expect(onStatus).toHaveBeenLastCalledWith({ on: true, spentUsd: null });
});

it("shows her thread, who said what and what she did, her words under her name", async () => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => respond(thread));
  const onOpen = jest.fn();
  render(<TiffPanel job="j" onChanged={jest.fn()} onOpen={onOpen} />);
  const said = await screen.findByText("A 12.5 kW ducted, priced from your book.");
  expect(said.closest(".qt-msg")).toHaveTextContent(/^Tiff/);
  /* her open question counts on the progress line's To confirm */
  expect(onOpen).toHaveBeenLastCalledWith(1);
  expect(screen.getByText("Ducted for the whole house")).toBeInTheDocument();
  expect(screen.getByText("Luke Bennett")).toBeInTheDocument();
  /* what she did, folded to one line once she's done; every step when it's opened */
  expect(screen.queryByText("Added a kit: Ducted, 12 parts")).toBeNull();
  const fold = screen.getByRole("button", { name: "Worked through it 1 step" });
  expect(fold).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(fold);
  expect(screen.getByText("Added a kit: Ducted, 12 parts")).toBeInTheDocument();
  expect(fold).toHaveAttribute("aria-expanded", "true");
  /* the quote's history in her thread */
  expect(screen.getByText("Option 1 accepted by you")).toBeInTheDocument();
  /* law 26: state is a word, not a pill; her working mark already moves */
  expect(screen.queryByText("Ready")).toBeNull();
});

/* Isaac, 2026-10-13: "the chat reply button can just be gray similar to
   what it looks like in Claude" */
it("sends on Enter, never on Shift+Enter or mid-word in an input method", async () => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (_u: string, init?: { body?: string }) => {
    if (init?.body) {
      posted.push(JSON.parse(init.body));
      return respond({ ok: true, turn: "t2" });
    }
    return respond(thread);
  });
  render(<TiffPanel job="j" onChanged={jest.fn()} />);
  const box = await screen.findByLabelText("Message Tiff");
  /* each question has its own answer: the box is for the rest */
  expect(box).toHaveAttribute("placeholder", "Reply to Tiff");
  fireEvent.change(box, { target: { value: "Three phase" } });
  await act(async () => {
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
  });
  expect(posted).toEqual([]);
  await act(async () => {
    fireEvent.keyDown(box, { key: "Enter" });
  });
  expect(posted).toEqual([{ job: "j", message: "Three phase" }]);
});

it("takes the keys in the reply box when the job card opened it to start the quote", async () => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => respond({ ...thread, events: [] }));
  render(<TiffPanel job="j" onChanged={jest.fn()} start />);
  expect(await screen.findByLabelText("Message Tiff")).toHaveFocus();
});

it("prices each answer, and a tap makes it with no call to her", async () => {
  const onChanged = jest.fn();
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (_u: string, init?: { body?: string }) => {
    if (init?.body) {
      posted.push(JSON.parse(init.body));
      return respond({ ok: true });
    }
    return respond(thread);
  });
  render(<TiffPanel job="j" onChanged={onChanged} />);
  await screen.findByText("A 12.5 kW ducted, priced from your book.");
  const three = await screen.findByRole("button", { name: /Three phase/ });
  expect(three).toHaveTextContent("+$520");
  expect(screen.getByRole("button", { name: "Single phase" })).toBeInTheDocument();
  await act(async () => {
    fireEvent.click(three);
  });
  expect(posted).toContainEqual({ job: "j", op: "answer", event: 3, answer: 1 });
  expect(onChanged).toHaveBeenCalled();
});

it("sends a message and shows her working", async () => {
  let working = false;
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (_u: string, init?: { body?: string }) => {
    if (init?.body) {
      posted.push(JSON.parse(init.body));
      working = true;
      return respond({ ok: true, turn: "t2" });
    }
    return respond({ ...thread, working, events: [] });
  });
  render(<TiffPanel job="j" onChanged={jest.fn()} />);
  const box = await screen.findByLabelText("Message Tiff");
  fireEvent.change(box, { target: { value: "Make it three phase" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send to Tiff" }));
  });
  expect(posted).toContainEqual({ job: "j", message: "Make it three phase" });
  expect(await screen.findByText("Reading the job")).toBeInTheDocument();
  /* about how long is left, a first turn being the long one */
  const bar = screen.getByRole("progressbar", { name: "Reading the job" });
  expect(bar).toHaveAttribute("aria-valuetext", "about 1 min 40 left");
  expect(screen.getByText("about 1 min 40 left")).toBeInTheDocument();
  /* the send waits while she works: one turn at a time */
  expect(screen.getByRole("button", { name: "Send to Tiff" })).toBeDisabled();
});

/* Isaac, 11 November 2026: "Tiff doesn't automatically bring you to where
   she's working. Sometimes you have to scroll down" */
it("stays at her newest as the thread grows, unless you've scrolled back to read", async () => {
  const seen: ResizeObserverCallback[] = [];
  const Was = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    constructor(cb: ResizeObserverCallback) {
      seen.push(cb);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  try {
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => respond(thread));
    render(<TiffPanel job="j" onChanged={jest.fn()} />);
    const said = await screen.findByText("A 12.5 kW ducted, priced from your book.");
    const el = said.closest(".qc-thread") as HTMLElement;
    let top = 0;
    let height = 1000;
    Object.defineProperty(el, "scrollTop", { configurable: true, get: () => top, set: (v: number) => void (top = v) });
    Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => height });
    Object.defineProperty(el, "clientHeight", { configurable: true, get: () => 300 });
    const grow = (to: number) => {
      height = to;
      act(() => seen.forEach((cb) => cb([], {} as ResizeObserver)));
    };
    /* her working line, her questions, the box growing as you talk */
    grow(1000);
    expect(top).toBe(1000);
    grow(1400);
    expect(top).toBe(1400);
    /* you scroll back to read: left where you are */
    fireEvent.wheel(el);
    top = 200;
    fireEvent.scroll(el);
    grow(1600);
    expect(top).toBe(200);
    /* back at the foot: followed again */
    top = 1600 - 300;
    fireEvent.scroll(el);
    grow(1800);
    expect(top).toBe(1800);
  } finally {
    globalThis.ResizeObserver = Was;
  }
});

it("gives a change no bar until a few seconds in, a quick answer being over by then", async () => {
  const finished = { id: 1, turnId: "t1", kind: "usage", author: "tiff", at: "2026-11-01T00:00:00.000Z", body: { usd: 0.1, rounds: 1, models: [] } };
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => respond({ ...thread, working: true, events: [finished] }));
  render(<TiffPanel job="j" onChanged={jest.fn()} />);
  expect(await screen.findByText("Working on the quote")).toBeInTheDocument();
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
});

/* Isaac's production test, 2026-10-12: two reads from the same point (the
   poll, a read after an answer, coming back to the tab) both brought the same
   events, and questions 4 and 5 showed twice */
it("shows each event once when two reads bring the same ones", async () => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (_u: string, init?: { body?: string }) =>
    init?.body ? respond({ ok: true, turn: "t2" }) : respond(thread)
  );
  render(<TiffPanel job="j" onChanged={jest.fn()} />);
  expect(await screen.findByText("A 12.5 kW ducted, priced from your book.")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Message Tiff"), { target: { value: "Carry on" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send to Tiff" }));
  });
  await act(async () => {});
  expect(screen.getAllByText("A 12.5 kW ducted, priced from your book.")).toHaveLength(1);
  expect(screen.getAllByText("Single or three phase?")).toHaveLength(1);
});

it("says why when she can't take the message", async () => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (_u: string, init?: { body?: string }) =>
    init?.body ? respond({ ok: false, reason: "Tiff is still working on the last one." }) : respond({ ...thread, events: [] })
  );
  render(<TiffPanel job="j" onChanged={jest.fn()} />);
  fireEvent.change(await screen.findByLabelText("Message Tiff"), { target: { value: "And another" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send to Tiff" }));
  });
  expect(screen.getByText("Tiff is still working on the last one.")).toBeInTheDocument();
  expect(screen.getByText("Ready when you are.")).toBeInTheDocument();
});

it("reads the job: every source listed to untick, and only the ticked ones sent", async () => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: { body?: string }) => {
    if (init?.body) {
      posted.push(JSON.parse(init.body));
      return respond({ ok: true, turn: "t1" });
    }
    if (String(url).includes("sources=1"))
      return respond({
        ok: true,
        left: 2,
        sources: [
          { id: "description", label: "The job's description", text: "Ducted upstairs and down" },
          { id: "note:n1", label: "Note, 6 Oct 2026, Luke Bennett", text: "Six floor grilles 350 x 150. Core hole through sandstone." },
          { id: "note:n2", label: "Note, 7 Oct 2026, Luke Bennett", text: "Invoice the deposit" },
        ],
      });
    return respond({ ...thread, events: [], names: { "u-isaac": "Isaac Smith" } });
  });
  render(<TiffPanel job="j" onChanged={jest.fn()} />);
  expect(await screen.findByText("Hi Isaac")).toBeInTheDocument();
  expect(screen.getByLabelText("Message Tiff")).toHaveAttribute("placeholder", "Tell Tiff what to quote");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Read the job" }));
  });
  expect(screen.getByText("Note, 6 Oct 2026, Luke Bennett")).toBeInTheDocument();
  expect(screen.getByText("2 older notes left out: the job's notes are longer than she reads.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: /Invoice the deposit/ }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Read it" }));
  });
  expect(posted).toContainEqual({ job: "j", message: "", sources: ["description", "note:n1"] });
});

it("tells the page her plan while she works on it, and nothing once she's done (5.2)", async () => {
  const plan = { name: "plan_parts", label: "Planned the quote", ok: true, said: "2 parts", detail: { option: 0, parts: [{ system: "Downstairs", group: "Units", detail: "PEA-M125HAA" }, { system: "", group: "Labour" }] } };
  const working = { ...thread, working: true, events: [{ id: 9, turnId: "t2", kind: "tool", author: "tiff", at: "", body: plan }] };
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => respond(working));
  const onPlan = jest.fn();
  render(
    <TiffPanel job="j" onChanged={jest.fn()} onPlan={onPlan} />
  );
  await screen.findByText("Planned the quote: 2 parts");
  expect(onPlan).toHaveBeenLastCalledWith({ option: 0, parts: [{ system: "Downstairs", group: "Units", detail: "PEA-M125HAA" }, { system: "", group: "Labour", detail: "" }] });
});

it("shows a researched price with its page, and Use it puts it on the line (12.2)", async () => {
  const research = { lineId: "l1", priceCents: 130000, per: "a hole", summary: "$400 to $800 a hole; $1,300 for sandstone.", source: { url: "https://quoteyard.com.au/coring", title: "The Quote Yard" } };
  const withResearch = { ...thread, events: [{ id: 7, turnId: "t1", kind: "tool", author: "tiff", at: "", body: { name: "research_price", label: "Researched a price", ok: true, said: "$1300.00 a hole", detail: { research } } }] };
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (_u: string, init?: { body?: string }) => {
    if (init?.body) {
      posted.push(JSON.parse(init.body));
      return respond({ ok: true });
    }
    return respond(withResearch);
  });
  const onChanged = jest.fn();
  render(
    <TiffPanel job="j" onChanged={onChanged} />
  );
  expect(await screen.findByText("$400 to $800 a hole; $1,300 for sandstone.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "The Quote Yard" })).toHaveAttribute("href", "https://quoteyard.com.au/coring");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Use $1,300" }));
  });
  /* the route reads the price back from the thread: only the event goes */
  expect(posted.at(-1)).toEqual({ job: "j", op: "use", event: 7 });
  expect(screen.getByText("On the line at $1,300 a hole")).toBeInTheDocument();
  expect(onChanged).toHaveBeenCalled();
});

/* Isaac, 2026-10-11: "however I gave you the answers I should be able to do the same" */
it("asks her questions in the talk, says what the quote has, and ticks off what his own words answered", async () => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () =>
    respond({
      ...thread,
      events: [
        { id: 1, turnId: "t1", kind: "message", author: "u-isaac", at: "", body: { text: "Quote 3343" } },
        { id: 2, turnId: "t1", kind: "question", author: "tiff", at: "", body: { question: "How long is the pipe run, indoor to outdoor?", topic: "Pipe run, indoor to outdoor", put: "10 m", answers: [] } },
        { id: 3, turnId: "t1", kind: "question", author: "tiff", at: "", body: { question: "How far is the switchboard from the outdoor unit?", put: "15 m", answers: [] } },
        { id: 4, turnId: "t1", kind: "question", author: "tiff", at: "", body: { question: "Does the pipe need cover up the rear wall?", answers: [{ label: "No cover" }, { label: "2 lengths" }] } },
        { id: 5, turnId: "t2", kind: "message", author: "u-isaac", at: "", body: { text: "Pipe run is 14 m" } },
        { id: 6, turnId: "t2", kind: "tool", author: "tiff", at: "", body: { name: "settle", label: "Ticked off", ok: true, said: "14 m", detail: { settled: [{ question: 2, answer: "14 m" }] } } },
      ],
      questions: { 2: { deltas: [], answered: { index: -1, label: "14 m", by: "tiff", typed: true } }, 3: { deltas: [], answered: null }, 4: { deltas: [0, 4120], answered: null } },
    })
  );
  render(<TiffPanel job="j" onChanged={jest.fn()} />);
  const asks = within(await screen.findByRole("region", { name: "Tiff's questions" }));
  /* the one his own words answered is a ticked line, by its topic */
  expect(asks.getByText("Pipe run, indoor to outdoor")).toBeInTheDocument();
  expect(asks.getByText("14 m").closest(".qx-done")).toBeInTheDocument();
  /* the one he's on: a figure to type has nothing to tap, only its field */
  expect(asks.getByText("Question 2 of 3")).toBeInTheDocument();
  expect(asks.getByText("How far is the switchboard from the outdoor unit?")).toBeInTheDocument();
  expect(asks.getByText("On the quote now: 15 m")).toBeInTheDocument();
  expect(asks.queryAllByRole("button").filter((b) => b.classList.contains("qx-answer"))).toHaveLength(0);
  /* the third waits its turn */
  expect(asks.queryByRole("button", { name: /2 lengths/ })).toBeNull();
});

/* Isaac, 2026-10-17, option A of the working-notes mocks: the notes she
   writes on the way to her tools ("PEA-M100HAA is the one. Checking specs and
   outdoor pairing.") fold in with her steps, and only her answer stands as a
   message; while she works, the run stays open */
it("folds her working notes in with her steps, open while she works", async () => {
  const run = (working: boolean) => ({
    ...thread,
    working,
    events: [
      { id: 1, turnId: "t1", kind: "message", author: "u-isaac", at: "", body: { text: "Quote the underfloor ducted" } },
      { id: 2, turnId: "t1", kind: "tool", author: "tiff", at: "", body: { name: "search_book", label: "Searched your book", ok: true, said: "PEA" } },
      { id: 3, turnId: "t1", kind: "reply", author: "tiff", at: "", body: { text: "PEA-M100HAA is the one. Checking specs and outdoor pairing.", working: true } },
      { id: 4, turnId: "t1", kind: "tool", author: "tiff", at: "", body: { name: "pairing_check", label: "Checked the pairing", ok: true, said: "PUZ-M100VKA: connects" } },
      ...(working ? [] : [{ id: 5, turnId: "t1", kind: "reply", author: "tiff", at: "", body: { text: "A 10 kW PEA-M100HAA under the floor." } }]),
    ],
    questions: {},
  });
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => respond(run(true)));
  const live = render(<TiffPanel job="j" onChanged={jest.fn()} />);
  /* working: every step and her note in view, no fold */
  expect(await screen.findByText("Checked the pairing: PUZ-M100VKA: connects")).toBeInTheDocument();
  expect(screen.getByText("PEA-M100HAA is the one. Checking specs and outdoor pairing.")).toHaveClass("note");
  expect(screen.queryByRole("button", { name: /Worked through it/ })).toBeNull();
  live.unmount();

  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => respond(run(false)));
  render(<TiffPanel job="j" onChanged={jest.fn()} />);
  const answer = await screen.findByText("A 10 kW PEA-M100HAA under the floor.");
  /* done: one line, her answer the only message under her name */
  expect(screen.queryByText("PEA-M100HAA is the one. Checking specs and outdoor pairing.")).toBeNull();
  const fold = screen.getByRole("button", { name: /Worked through it.*2 steps/ });
  expect(answer.closest(".qt-msg")).toHaveTextContent(/^Tiff/);
  fireEvent.click(fold);
  const note = screen.getByText("PEA-M100HAA is the one. Checking specs and outdoor pairing.");
  expect(note.closest(".qt-msg")).toBeNull();
  expect(note.closest(".qt-fold")).toContainElement(screen.getByText("Searched your book: PEA"));
  expect(fold).toHaveAttribute("aria-expanded", "true");
});

/* layout C (Isaac, 18 October), Q6: the reply box at the conversation's
   foot, the microphone on its own and a blue Send that carries its word */
/* every Tiff box is Conversations' box (Isaac, 20 October 2026: "the input
   section should be identical throughout the software"; 25 October, walking:
   the quote's was the one with Send in words) */
it("ends the conversation with the reply box: the microphone, then Tiff's round blue ↑, as every box has", async () => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => respond(thread));
  /* where this deployment hears, the box has its microphone */
  render(
    <NoteScopeProvider voiceEnabled>
      <TiffPanel job="j" onChanged={jest.fn()} />
    </NoteScopeProvider>
  );
  const box = await screen.findByLabelText("Message Tiff");
  const send = screen.getByRole("button", { name: "Send to Tiff" });
  expect(send).toHaveClass("cv-rnd", "cv-rnd--main");
  expect(send).toBeDisabled();
  const mic = screen.getByRole("button", { name: "Speak instead of typing" });
  expect(mic).toHaveClass("cv-rnd");
  expect(mic).toHaveTextContent("");
  const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  expect(before(box, mic)).toBe(true);
  expect(before(mic, send)).toBe(true);
  fireEvent.change(box, { target: { value: "Three phase" } });
  expect(send).toBeEnabled();
});

it("names her and when she said it over her words, and asks her open question under them", async () => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () =>
    respond({ ...thread, events: thread.events.map((e) => (e.id === 4 ? { ...e, at: "2026-10-17T11:24:00Z" } : e)) })
  );
  render(<TiffPanel job="j" onChanged={jest.fn()} />);
  const said = await screen.findByText("A 12.5 kW ducted, priced from your book.");
  expect(said.closest(".qt-msg")!.querySelector("time")).toHaveAttribute("dateTime", "2026-10-17T11:24:00Z");
  expect(await screen.findByText("Single or three phase?")).toBeInTheDocument();
});


/* One fold a turn (Isaac, 21 October 2026: "there seems to be still quite a
   big list"): a question she asked on the way split one turn's working into
   "45 steps, 1 step, 1 step…". */
it("folds a turn's working into one row, past the questions she asked on the way", async () => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () =>
    respond({
      ...thread,
      working: false,
      events: [
        { id: 1, turnId: "t1", kind: "message", author: "u-isaac", at: "", body: { text: "Quote the ducted" } },
        { id: 2, turnId: "t1", kind: "tool", author: "tiff", at: "", body: { name: "search_book", label: "Searched your book", ok: true } },
        { id: 3, turnId: "t1", kind: "question", author: "tiff", at: "", body: { text: "How long is the pipe run?" } },
        { id: 4, turnId: "t1", kind: "tool", author: "tiff", at: "", body: { name: "pairing_check", label: "Checked the pairing", ok: true } },
        { id: 5, turnId: "t1", kind: "tool", author: "tiff", at: "", body: { name: "build_labour", label: "Worked out the labour", ok: true } },
        { id: 6, turnId: "t1", kind: "reply", author: "tiff", at: "", body: { text: "A 10 kW ducted." } },
      ],
      questions: {},
    }),
  );
  render(<TiffPanel job="j" onChanged={jest.fn()} />);
  expect(await screen.findByText("A 10 kW ducted.")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /^Worked through it/ })).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Worked through it 3 steps" })).toBeInTheDocument();
});

/* Price them: the page's words go once, what's in the box stays, and the
   rail only clears when she has them */
describe("words the page says for the person", () => {
  const mount = (answer: unknown) => {
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async (_u: string, init?: { method?: string; body?: string }) => {
      if (init?.method !== "POST") return respond(thread);
      posted.push(JSON.parse(init.body ?? "{}"));
      return respond(answer);
    });
    const onSaid = jest.fn();
    const say = { id: 1, text: "Price what's been added: A pump." };
    const view = render(<TiffPanel job="j" onChanged={jest.fn()} say={say} onSaid={onSaid} />);
    return { onSaid, say, view };
  };

  it("sends them once and tells the page", async () => {
    const { onSaid, say, view } = mount({ ok: true });
    await act(async () => {});
    await act(async () => {});
    view.rerender(<TiffPanel job="j" onChanged={jest.fn()} say={say} onSaid={onSaid} />);
    await act(async () => {});
    expect(posted.filter((p) => p.message === say.text)).toHaveLength(1);
    expect(onSaid).toHaveBeenCalledTimes(1);
  });

  it("doesn't tell the page when she can't take them", async () => {
    const { onSaid } = mount({ ok: false, reason: "Tiff is working on this quote." });
    await act(async () => {});
    await act(async () => {});
    expect(onSaid).not.toHaveBeenCalled();
    expect(await screen.findByText("Tiff is working on this quote.")).toBeInTheDocument();
  });
});
