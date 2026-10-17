import { act, fireEvent, render, screen, within } from "@testing-library/react";
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
  const { container } = render(<TiffPanel job="j" onChanged={jest.fn()} onStatus={onStatus} confirm={<p>Core hole: not known yet</p>} />);
  await act(async () => {});
  expect(onStatus).toHaveBeenLastCalledWith({ on: false, spentUsd: null });
  expect(container).toBeEmptyDOMElement();
  expect(screen.queryByText("Core hole: not known yet")).toBeNull();
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

it("runs the conversation down the column, what's to confirm at its foot, then the reply box", async () => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => respond(thread));
  render(<TiffPanel job="j" onChanged={jest.fn()} confirm={<p>Core hole: not known yet</p>} />);
  const said = await screen.findByText("A 12.5 kW ducted, priced from your book.");
  const confirm = screen.getByText("Core hole: not known yet");
  const question = screen.getByText("Single or three phase?");
  const box = screen.getByLabelText("Message Tiff");
  /* her question and the page's list, under one heading */
  const list = screen.getByRole("region", { name: "To confirm" });
  expect(list).toContainElement(confirm);
  expect(list).toContainElement(question);
  const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  expect(before(said, question)).toBe(true);
  expect(before(question, confirm)).toBe(true);
  expect(before(confirm, box)).toBe(true);
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
  expect(screen.getByRole("button", { name: /Three phase/ })).toHaveTextContent("+$519.96");
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
  /* what she did, folded to one line once she's done; every step on Show all */
  expect(screen.queryByText("Added a kit: Ducted, 12 parts")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Worked through it.*1 step.*Show all/ }));
  expect(screen.getByText("Added a kit: Ducted, 12 parts")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Hide/ })).toHaveAttribute("aria-expanded", "true");
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
  expect(box).toHaveAttribute("placeholder", "Reply…");
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
  const three = await screen.findByRole("button", { name: /Three phase/ });
  expect(three).toHaveTextContent("+$519.96");
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
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  });
  expect(posted).toContainEqual({ job: "j", message: "Make it three phase" });
  expect(await screen.findByText("Working on the quote")).toBeInTheDocument();
  /* the send waits while she works: one turn at a time */
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
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
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  });
  await act(async () => {});
  expect(screen.getAllByText("Single or three phase?")).toHaveLength(1);
  expect(screen.getAllByText("A 12.5 kW ducted, priced from your book.")).toHaveLength(1);
});

it("says why when she can't take the message", async () => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (_u: string, init?: { body?: string }) =>
    init?.body ? respond({ ok: false, reason: "Tiff is still working on the last one." }) : respond({ ...thread, events: [] })
  );
  render(<TiffPanel job="j" onChanged={jest.fn()} />);
  fireEvent.change(await screen.findByLabelText("Message Tiff"), { target: { value: "And another" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
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
  expect(screen.getByLabelText("Message Tiff")).toHaveAttribute("placeholder", "Tell Tiff about the job…");
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

it("shows the job, written out, at the top: what changed since her last one, and what's settled struck through", async () => {
  const wrote = (id: number, writeUp: Record<string, string[]>) => ({ id, turnId: "t1", kind: "tool", author: "tiff", body: { name: "write_up", label: "Wrote the job out", said: "the job, written out", ok: true, detail: { writeUp } }, at: "2026-10-10T00:00:00Z" });
  const first = { read: ["Luke: two ducted systems"], visits: ["Rough-in: 2 people, 3.5 days, 55 h"], unpriced: ["The sandstone core: not in your book"] };
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () =>
    respond({ ...thread, events: [...thread.events, wrote(90, first), wrote(91, { ...first, visits: ["Rough-in: 2 people, 3.5 days, 57 h"], unpriced: [] })] })
  );
  render(
    <TiffPanel job="j" onChanged={jest.fn()} />
  );
  const job = within(await screen.findByRole("region", { name: "The job" }));
  expect(job.getByText("Changed", { selector: "header em" })).toBeInTheDocument();
  expect(job.getByText("Luke: two ducted systems")).toBeInTheDocument();
  expect(job.getByText("Rough-in: 2 people, 3.5 days, 57 h").closest("li")).toHaveClass("changed");
  expect(job.getByText("Rough-in: 2 people, 3.5 days, 55 h").closest("li")).toHaveClass("gone");
  expect(job.getByText("The sandstone core: not in your book").closest("li")).toHaveClass("gone");
});

/* Isaac, 2026-10-11: "however I gave you the answers I should be able to do the same" */
it("numbers her questions as her message does, says what the quote has, and ticks off what his own words answered", async () => {
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
  render(
    <TiffPanel job="j" onChanged={jest.fn()} />
  );
  const board = await screen.findByText("How far is the switchboard from the outdoor unit?");
  /* numbered from her asking: the answered one keeps its 1 */
  expect(board.querySelector(".qt-qn")).toHaveTextContent("2");
  expect(screen.getByText("I've put 15 m")).toBeInTheDocument();
  /* a figure to type has nothing to tap; a few-answer one has its answers */
  expect(screen.getByRole("button", { name: /2 lengths/ })).toBeInTheDocument();
  const done = within(screen.getByRole("list", { name: "Answered" }));
  expect(done.getByText("Pipe run, indoor to outdoor: 14 m")).toBeInTheDocument();
  expect(done.getByText("From your message")).toBeInTheDocument();
  expect(screen.queryByText("How long is the pipe run, indoor to outdoor?")).toBeNull();
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
  const fold = screen.getByRole("button", { name: /Worked through it.*2 steps.*Show all/ });
  expect(answer.closest(".qt-msg")).toHaveTextContent(/^Tiff/);
  fireEvent.click(fold);
  const note = screen.getByText("PEA-M100HAA is the one. Checking specs and outdoor pairing.");
  expect(note.closest(".qt-msg")).toBeNull();
  expect(note.closest(".qt-fold")).toContainElement(screen.getByText("Searched your book: PEA"));
});

