import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { TiffPanel } from "../tiff-panel";

/* Tiff's panel on the quote (slice 5.1): off until her model is chosen;
   then her thread, what's To confirm with each answer priced, and the box to
   message her. */

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

it("is only what the page gives it while Tiff is off", async () => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => respond({ ok: true, on: false, events: [] }));
  render(
    <TiffPanel job="j" onChanged={jest.fn()} confirm={<p>Core hole: not known yet</p>}>
      <p>Changes</p>
    </TiffPanel>
  );
  expect(await screen.findByRole("heading", { name: "To confirm" })).toBeInTheDocument();
  expect(screen.getByText("Core hole: not known yet")).toBeInTheDocument();
  expect(screen.getByText("Changes")).toBeInTheDocument();
  expect(screen.queryByLabelText("Message Tiff")).toBeNull();
});

it("puts what's to confirm first, the page's own next, and the conversation last, down to the message box", async () => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => respond(thread));
  render(
    <TiffPanel job="j" onChanged={jest.fn()} confirm={<p>Core hole: not known yet</p>}>
      <p>Changes</p>
    </TiffPanel>
  );
  const said = await screen.findByText("A 12.5 kW ducted, priced from your book.");
  const confirm = screen.getByText("Core hole: not known yet");
  const changes = screen.getByText("Changes");
  const box = screen.getByLabelText("Message Tiff");
  /* her question and the page's list, under one heading */
  expect(screen.getByRole("heading", { name: "To confirm" }).parentElement).toContainElement(confirm);
  const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  expect(before(confirm, changes)).toBe(true);
  expect(before(changes, said)).toBe(true);
  expect(before(said, box)).toBe(true);
});

it("shows her thread, who said what, what she did and what it cost", async () => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => respond(thread));
  const onOpen = jest.fn();
  render(
    <TiffPanel job="j" onChanged={jest.fn()} onOpen={onOpen}>
      {null}
    </TiffPanel>
  );
  expect(await screen.findByText("A 12.5 kW ducted, priced from your book.")).toBeInTheDocument();
  /* her open question counts on the progress line's To confirm */
  expect(onOpen).toHaveBeenLastCalledWith(1);
  expect(screen.getByText("Ducted for the whole house")).toBeInTheDocument();
  expect(screen.getByText("Luke Bennett")).toBeInTheDocument();
  expect(screen.getByText("Added a kit: Ducted, 12 parts")).toBeInTheDocument();
  expect(screen.getByText("$0.71 on this quote")).toBeInTheDocument();
  /* the quote's history in her thread */
  expect(screen.getByText("Option 1 accepted by you")).toBeInTheDocument();
  expect(screen.getByText("Ready")).toBeInTheDocument();
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
  render(<TiffPanel job="j" onChanged={onChanged}>{null}</TiffPanel>);
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
  render(<TiffPanel job="j" onChanged={jest.fn()}>{null}</TiffPanel>);
  const box = await screen.findByLabelText("Message Tiff");
  fireEvent.change(box, { target: { value: "Make it three phase" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  });
  expect(posted).toContainEqual({ job: "j", message: "Make it three phase" });
  expect(await screen.findByText("Working on the quote")).toBeInTheDocument();
  expect(screen.getByText("Working")).toBeInTheDocument();
});

/* Isaac's production test, 2026-10-12: two reads from the same point (the
   poll, a read after an answer, coming back to the tab) both brought the same
   events, and questions 4 and 5 showed twice */
it("shows each event once when two reads bring the same ones", async () => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (_u: string, init?: { body?: string }) =>
    init?.body ? respond({ ok: true, turn: "t2" }) : respond(thread)
  );
  render(<TiffPanel job="j" onChanged={jest.fn()}>{null}</TiffPanel>);
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
  render(<TiffPanel job="j" onChanged={jest.fn()}>{null}</TiffPanel>);
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
  render(<TiffPanel job="j" onChanged={jest.fn()}>{null}</TiffPanel>);
  expect(await screen.findByText("Hi Isaac")).toBeInTheDocument();
  expect(screen.getByLabelText("Message Tiff")).toHaveAttribute("placeholder", "Tell Tiff about the job");
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
    <TiffPanel job="j" onChanged={jest.fn()} onPlan={onPlan}>
      {null}
    </TiffPanel>
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
    <TiffPanel job="j" onChanged={onChanged}>
      {null}
    </TiffPanel>
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
    <TiffPanel job="j" onChanged={jest.fn()}>
      {null}
    </TiffPanel>
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
    <TiffPanel job="j" onChanged={jest.fn()}>
      {null}
    </TiffPanel>
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
