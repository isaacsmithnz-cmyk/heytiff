import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

/* Materials from the price book, and by voice (Isaac, 2026-10-03): the
   business's own items under the box, a code kept on the row, and a list
   said out loud ticked before anything is added. */

const said: { current: ((text: string, info: { capped: boolean }) => void) | null } = { current: null };
jest.mock("@/components/notes/dictation", () => {
  const actual = jest.requireActual("@/components/notes/dictation");
  return {
    ...actual,
    useDictation: (opts: { onTranscript: (t: string, i: { capped: boolean }) => void }) => {
      said.current = opts.onTranscript;
      return { recording: false, transcribing: false, interim: "", start: jest.fn(), stop: jest.fn(), cancel: jest.fn() };
    },
  };
});

import { NoteScopeProvider } from "@/components/notes/note-context";

import { JobMaterialsFace } from "../job-materials-face";

const BOOK: Record<string, { code: string; name: string; supplier: string; priceCents: number | null }[]> = {
  "pair coil": [{ code: "PC1438", name: "PAIRED COIL 1/4+3/8X20M", supplier: "AAD", priceCents: 15747 }],
  "pair coils": [{ code: "PC1438", name: "PAIRED COIL 1/4+3/8X20M", supplier: "AAD", priceCents: null }],
  "20 amp isolator": [{ code: "WPS120", name: "ISOLATOR 20A", supplier: "Rexel", priceCents: null }],
};
beforeEach(() => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string) => {
    const q = decodeURIComponent(new URL(url, "http://x").searchParams.get("q") ?? "").toLowerCase();
    return { json: async () => ({ ok: true, hits: BOOK[q] ?? [] }) };
  });
});

const face = (onAdd = jest.fn()) => {
  render(
    <NoteScopeProvider voiceEnabled>
      <JobMaterialsFace loading={false} sm8={[]} items={[]} timezone={null} manage ready onTick={jest.fn()} onRemove={jest.fn()} onAdd={onAdd} />
    </NoteScopeProvider>
  );
  return onAdd;
};

it("shows the business's own items in a white menu as a material is typed, and keeps the picked one's code", async () => {
  const onAdd = face();
  fireEvent.change(screen.getByLabelText("Add a material"), { target: { value: "pair coil" } });
  const option = await screen.findByRole("option", { name: /PAIRED COIL 1\/4\+3\/8X20M/ });
  expect(screen.getByText("$157.47")).toBeInTheDocument();
  /* the Menu's own white panel, and the field keeps the typing */
  expect(option.closest(".pt-menu")).not.toBeNull();
  expect(screen.getByLabelText("Add a material")).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(option);
  fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "7 m" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(onAdd).toHaveBeenCalledWith({ kind: "material", name: "PAIRED COIL 1/4+3/8X20M", qty: "7 m", sub: "PC1438, AAD" });
});

it("a list said out loud opens as a dialog of rows matched to the price book, and nothing goes on until they're ticked", async () => {
  const onAdd = face();
  await act(async () => said.current!("two pair coils, a 20 amp isolator and a rooftop stand", { capped: false }));
  const dialog = await screen.findByRole("dialog", { name: "From what you said" });
  expect(dialog).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  expect(screen.getByText('"Rooftop stand", not in your price book')).toBeInTheDocument();
  expect(onAdd).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Add Rooftop stand" }));
  fireEvent.click(screen.getByRole("button", { name: "Add 2 to the list" }));
  await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(2));
  expect(onAdd).toHaveBeenNthCalledWith(1, { kind: "material", name: "PAIRED COIL 1/4+3/8X20M", qty: "2", sub: "PC1438, AAD" });
  expect(onAdd).toHaveBeenNthCalledWith(2, { kind: "material", name: "ISOLATOR 20A", qty: "1", sub: "WPS120, Rexel" });
  expect(screen.queryByText("From what you said")).toBeNull();
});

it("the arrows and Enter pick from the price book without leaving the field", async () => {
  const onAdd = face();
  const field = screen.getByLabelText("Add a material");
  fireEvent.change(field, { target: { value: "20 amp isolator" } });
  await screen.findByRole("option", { name: /ISOLATOR 20A/ });
  fireEvent.keyDown(field, { key: "ArrowDown" });
  expect(screen.getByRole("option", { name: /ISOLATOR 20A/ })).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(field, { key: "Enter" });
  expect(field).toHaveValue("ISOLATOR 20A");
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(onAdd).toHaveBeenCalledWith({ kind: "material", name: "ISOLATOR 20A", qty: "", sub: "WPS120, Rexel" });
});

it("Escape puts the price book away and leaves what was typed", async () => {
  face();
  const field = screen.getByLabelText("Add a material");
  fireEvent.change(field, { target: { value: "pair coil" } });
  await screen.findByRole("listbox");
  fireEvent.keyDown(field, { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(field).toHaveValue("pair coil");
});

it("no microphone where the workspace has voice off", () => {
  render(<JobMaterialsFace loading={false} sm8={[]} items={[]} timezone={null} manage ready onTick={jest.fn()} onRemove={jest.fn()} onAdd={jest.fn()} />);
  expect(screen.queryByRole("button", { name: "Say the materials" })).toBeNull();
  expect(screen.getByLabelText("Add a material")).toBeInTheDocument();
});

it("the microphone is the one icon-only button, and the To do kind is gone", () => {
  face();
  expect(screen.getByRole("button", { name: "Say the materials" })).toHaveClass("cv-rnd");
  expect(screen.queryByRole("button", { name: "To do" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Material" })).toBeNull();
});

/* The quote's units on a job with no pick list (Isaac, 15 November 2026,
   "Yes, add them"): 2798, 3209, 3446 and 3516 showed no units once the
   Overview's Equipment block went. */
const UNIT = { key: "u", title: "Ducted unit 14 kW", detail: "PEA-M140HAA", qty: 1, group: "unit" as const, when: null, word: { tone: "look" as const, word: "To order" } };
const CONTROL = { key: "c", title: "Zone controller", detail: "ZONEIQ-8", qty: 1, group: "control" as const, when: null, word: { tone: "good" as const, word: "In stock" } };
const DUCT = { key: "d", title: "Ductwork, suggested", detail: "200 flex x 6", qty: 1, group: "duct" as const, when: null, word: null };

it("lists the quote's units and controls the list doesn't have, with Stock's word, and ticking one adds it ticked", () => {
  const onAdd = jest.fn();
  render(<JobMaterialsFace loading={false} sm8={[]} items={[]} timezone={null} manage ready onTick={jest.fn()} onRemove={jest.fn()} onAdd={onAdd} stock={[UNIT, CONTROL, DUCT]} />);
  expect(screen.getByRole("heading", { name: "Units" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Controls and zoning" })).toBeInTheDocument();
  expect(screen.getByText("To order")).toBeInTheDocument();
  expect(screen.getByText("In stock")).toBeInTheDocument();
  expect(screen.queryByText("Ductwork, suggested")).toBeNull();
  fireEvent.click(screen.getByLabelText("Loaded: Ducted unit 14 kW"));
  expect(onAdd).toHaveBeenCalledWith({ kind: "material", name: "Ducted unit 14 kW", qty: "1", sub: "PEA-M140HAA", picked: true });
});

it("a unit already on the list isn't listed twice", () => {
  const item = { id: "p1", name: "Ducted indoor", sub: "PEA-M140HAA", qty: "1", kind: "material" as const, picked: false, pickedAt: null, pickedBy: null, addedBy: null, designId: null, addedAt: "2026-11-01T00:00:00Z" };
  render(<JobMaterialsFace loading={false} sm8={[]} items={[item]} timezone={null} manage ready onTick={jest.fn()} onRemove={jest.fn()} onAdd={jest.fn()} stock={[UNIT]} />);
  expect(screen.getByText("Ducted indoor")).toBeInTheDocument();
  expect(screen.queryByText("Ducted unit 14 kW")).toBeNull();
  expect(screen.getAllByText("To order")).toHaveLength(1);
});
