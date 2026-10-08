import { act, fireEvent, render, screen } from "@testing-library/react";
import { TiffPanel } from "../tiff-panel";

/* Tiff's panel on the quote (slice 5.1): off until her model is chosen;
   then her thread, her Unknowns with each answer priced, and the box to
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
    <TiffPanel job="j" onChanged={jest.fn()}>
      <p>To check</p>
    </TiffPanel>
  );
  expect(await screen.findByText("To check")).toBeInTheDocument();
  expect(screen.queryByLabelText("Message Tiff")).toBeNull();
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
  /* her open question counts on the progress line's Unknowns */
  expect(onOpen).toHaveBeenLastCalledWith(1);
  expect(screen.getByText("Ducted for the whole house")).toBeInTheDocument();
  expect(screen.getByText("Luke Bennett")).toBeInTheDocument();
  expect(screen.getByText("Added a kit: Ducted, 12 parts")).toBeInTheDocument();
  expect(screen.getByText("$0.71 on this quote")).toBeInTheDocument();
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
