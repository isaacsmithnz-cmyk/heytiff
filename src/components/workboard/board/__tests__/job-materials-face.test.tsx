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
  render(<JobMaterialsFace loading={false} sm8={[]} items={[]} timezone={null} manage ready onTick={jest.fn()} onRemove={jest.fn()} onAdd={onAdd} />);
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

it("the microphone is the one icon-only button, and the To do kind is gone", () => {
  face();
  expect(screen.getByRole("button", { name: "Say the materials" })).toHaveClass("pt-btn--icon");
  expect(screen.queryByRole("button", { name: "To do" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Material" })).toBeNull();
});
