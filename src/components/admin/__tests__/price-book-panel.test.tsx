/* A price list in a layout HeyTiff doesn't know: its first rows are shown,
   a person picks the code and price columns, and the file is read again
   with them. */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { PriceBook } from "../price-book-panel";
import type { SupplierView } from "@/lib/quotes/price-book-server";

const acme: SupplierView = {
  key: "acme",
  name: "Acme",
  pricing: "net",
  file: "xlsx",
  format: "headed",
  discountPct: 0,
  rules: [],
  columns: null,
  fileName: null,
  importedAt: null,
  itemCount: null,
};

it("asks which column is which, then reads the file with the columns chosen", async () => {
  const sent: FormData[] = [];
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const form = init.body as FormData;
      sent.push(form);
      return {
        json: async () =>
          form.get("columns")
            ? { ok: true, summary: { read: 2, added: 2, changed: 0, gone: 0 }, conflicts: [], skipped: 0 }
            : {
                ok: false,
                needsColumns: true,
                reason: "Which column is which?",
                preview: { letters: ["A", "B", "C"], rows: [["Part No", "Product", "Trade"], ["AC-100", "Bracket", 10]] },
              },
      } as Response;
    }
    return { json: async () => ({ ok: true, categories: [] }) } as Response;
  }) as unknown as typeof fetch;

  const onImported = jest.fn();
  render(<PriceBook suppliers={[acme]} onImported={onImported} />);
  const input = screen.getByLabelText("Upload Acme price list");
  const file = new File(["x"], "acme.xlsx");
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });

  expect(screen.getByText("Which column is which in acme.xlsx?")).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "Bracket" })).toBeInTheDocument();
  const read = screen.getByRole("button", { name: "Read the file" });
  expect(read).toBeDisabled();

  fireEvent.change(screen.getByRole("combobox", { name: "Code" }), { target: { value: "A" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Price ex GST" }), { target: { value: "C" } });
  expect(read).toBeEnabled();
  await act(async () => {
    fireEvent.click(read);
  });

  expect(JSON.parse(String(sent[1]!.get("columns")))).toEqual({ code: "A", price: "C" });
  expect(sent[1]!.get("pricing")).toBe("net");
  expect(sent[1]!.get("kind")).toBe("list");
  expect(screen.getByText("Acme price list in: 2 items read, no price changed, 2 new.")).toBeInTheDocument();
  expect(screen.queryByText("Which column is which in acme.xlsx?")).not.toBeInTheDocument();
  expect(onImported).toHaveBeenCalled();
});

/* Isaac, 2026-10-04: "test the engine on a new org… ensure no hard coded
   parts from us come in". A new business has no suppliers; the ones whose
   own files HeyTiff reads are offered, a press each. */
it("starts a new business with no suppliers, offering the files HeyTiff reads", async () => {
  const posted: unknown[] = [];
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST" && url === "/api/quoting/suppliers") {
      posted.push(JSON.parse(String(init.body)));
      return { json: async () => ({ ok: true }) } as Response;
    }
    return { json: async () => ({ ok: true, categories: [] }) } as Response;
  }) as unknown as typeof fetch;
  const onImported = jest.fn();
  render(<PriceBook suppliers={[]} onImported={onImported} />);
  expect(screen.queryByText("No price list yet")).toBeNull();
  for (const name of ["Add AAD", "Add Reece", "Add Mitsubishi Electric"]) expect(screen.getByRole("button", { name })).toBeEnabled();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Add Reece" }));
  });
  expect(posted).toEqual([{ builtIn: "reece" }]);
  expect(onImported).toHaveBeenCalled();
  expect(await screen.findByText("Reece added. Upload its price list.")).toBeInTheDocument();
});

it("doesn't offer a supplier the business already has", () => {
  global.fetch = jest.fn(async () => ({ json: async () => ({ ok: true, categories: [] }) })) as unknown as typeof fetch;
  render(<PriceBook suppliers={[{ ...acme, key: "aad", name: "AAD", format: "aad_csv", file: "csv" }]} onImported={jest.fn()} />);
  expect(screen.queryByRole("button", { name: "Add AAD" })).toBeNull();
  expect(screen.getByRole("button", { name: "Add Reece" })).toBeInTheDocument();
});

/* Isaac, 2026-10-05: invoices are the same supplier's prices, not another
   supplier — "Mitsubishi as a supplier can be one header". */
it("takes a supplier's invoices under the supplier, asking no discount for what was paid", async () => {
  const sent: FormData[] = [];
  global.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
    const form = init!.body as FormData;
    sent.push(form);
    return {
      json: async () =>
        form.get("columns")
          ? { ok: true, summary: { read: 93, added: 43, changed: 50, gone: 0 }, conflicts: [], skipped: 0 }
          : { ok: false, needsColumns: true, reason: "Which column is which?", preview: { letters: ["A", "B"], rows: [["Item", "Paid"], ["PEFY-P32VMX-E1", 871.52]] } },
    } as Response;
  }) as unknown as typeof fetch;
  render(<PriceBook suppliers={[{ ...acme, name: "Mitsubishi Electric", pricing: "list_less", discountPct: 30 }]} onImported={jest.fn()} />);
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Add Mitsubishi Electric invoices"), { target: { files: [new File(["x"], "invoices.xlsx")] } });
  });
  expect(sent[0]!.get("kind")).toBe("invoices");
  expect(screen.queryByRole("combobox", { name: "The prices are" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox", { name: "Code" }), { target: { value: "A" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Price ex GST" }), { target: { value: "B" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Read the file" }));
  });
  expect(sent[1]!.get("kind")).toBe("invoices");
  expect(screen.getByText("Mitsubishi Electric invoices in: 93 items read, 50 prices changed, 43 new.")).toBeInTheDocument();
});
