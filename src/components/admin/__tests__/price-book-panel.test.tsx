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
  /* a supplier is one quiet row; its uploads are inside it */
  expect(screen.queryByLabelText("Upload Acme price list")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^Acme/ }));
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
   parts from us come in". A new business has no suppliers: the one thing to
   do is add one, and naming one whose own files HeyTiff reads adds it as
   that (2026-10-05: one "Add supplier", not a button per supplier). */
it("starts a new business with no suppliers and the form to add one, offering the files HeyTiff reads", async () => {
  const posted: unknown[] = [];
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST" && url === "/api/quoting/suppliers") {
      posted.push(JSON.parse(String(init.body)));
      return { json: async () => ({ ok: true }) } as Response;
    }
    return { json: async () => ({ ok: true }) } as Response;
  }) as unknown as typeof fetch;
  const onImported = jest.fn();
  const { container } = render(<PriceBook suppliers={[]} onImported={onImported} />);
  expect(screen.queryByRole("list", { name: "Suppliers" })).toBeNull();
  /* the suppliers HeyTiff reads are offered as the name is typed */
  expect([...container.querySelectorAll("datalist option")].map((o) => o.getAttribute("value"))).toEqual(["AAD", "Reece", "Mitsubishi Electric"]);
  fireEvent.change(screen.getByLabelText("New supplier's name"), { target: { value: "reece" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Add supplier" }));
  });
  expect(posted).toEqual([{ builtIn: "reece" }]);
  expect(onImported).toHaveBeenCalled();
  expect(await screen.findByText("Reece added. Open it to upload its price list.")).toBeInTheDocument();

  /* any other supplier by its name */
  fireEvent.click(screen.getByRole("button", { name: "Add a supplier" }));
  fireEvent.change(screen.getByLabelText("New supplier's name"), { target: { value: "JH Sheetmetal" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Add supplier" }));
  });
  expect(posted[1]).toEqual({ name: "JH Sheetmetal" });
});

it("doesn't offer a supplier the business already has, and keeps the list to one row each", () => {
  global.fetch = jest.fn(async () => ({ json: async () => ({ ok: true }) })) as unknown as typeof fetch;
  const { container } = render(
    <PriceBook suppliers={[{ ...acme, key: "aad", name: "AAD", format: "aad_csv", file: "csv", importedAt: "2026-09-29T00:00:00Z", itemCount: 3579 }]} onImported={jest.fn()} />
  );
  /* one row, no buttons but the row itself and Add a supplier */
  const buttons = screen.getAllByRole("button").map((b) => b.textContent);
  expect(buttons).toHaveLength(2);
  expect(buttons[0]).toMatch(/^AADNet prices3,579 items, prices from 29 Sept? 2026None yet$/);
  expect(buttons[1]).toBe("Add a supplier");
  fireEvent.click(screen.getByRole("button", { name: "Add a supplier" }));
  expect([...container.querySelectorAll("datalist option")].map((o) => o.getAttribute("value"))).toEqual(["Reece", "Mitsubishi Electric"]);
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
  fireEvent.click(screen.getByRole("button", { name: /^Mitsubishi Electric/ }));
  /* a list-price supplier's discount sits in its open row */
  expect(screen.getByRole("heading", { name: "Discount" })).toBeInTheDocument();
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

/* Isaac, 2026-10-05: the price book takes in invoices — the invoice itself,
   a PDF or a photo, as well as a spreadsheet of them. Tiff reads it; the
   person sees every line and what it does to the book before any goes in. */
it("reads an invoice PDF, shows each line against the book, and adds the lot on one press", async () => {
  const posts: { url: string; body: FormData | string }[] = [];
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    posts.push({ url, body: init!.body as FormData | string });
    if (url === "/api/quoting/invoice-read") {
      return {
        json: async () => ({
          ok: true,
          read: {
            supplier: "Reece Australia Pty Ltd",
            invoiceNo: "7781203",
            invoiceDate: "2026-09-29",
            lines: [
              { code: "PC1412", name: "Pair coil 1/4 1/2 15m", qty: 2, cents: 11850, now: 12400, after: 11850 },
              { code: "CMADJ", name: "Pipe clamp", qty: 20, cents: 115, now: null, after: 115 },
              { code: "PC1438", name: "Pair coil 1/4 3/8 15m", qty: 1, cents: 9900, now: 9500, after: 9500 },
            ],
            skipped: [{ name: "Freight", why: "not a product" }],
          },
        }),
      } as Response;
    }
    return { json: async () => ({ ok: true, summary: { read: 3, added: 1, changed: 1, gone: 0 } }) } as Response;
  }) as unknown as typeof fetch;
  const onImported = jest.fn();
  const aad = { ...acme, key: "aad", name: "AAD", format: "aad_csv" as const, file: "csv" as const };
  const reece = { ...acme, key: "reece", name: "Reece", format: "reece_csv" as const, file: "csv" as const };
  render(<PriceBook suppliers={[aad, reece]} onImported={onImported} />);
  fireEvent.click(screen.getByRole("button", { name: /^AAD/ }));
  const input = screen.getByLabelText("Add AAD invoices");
  expect(input.getAttribute("accept")).toContain("application/pdf");
  expect(input.getAttribute("accept")).toContain("image/jpeg");
  await act(async () => {
    fireEvent.change(input, { target: { files: [new File(["%PDF"], "INV-7781203.pdf", { type: "application/pdf" })] } });
  });

  expect(posts[0]!.url).toBe("/api/quoting/invoice-read");
  expect((posts[0]!.body as FormData).get("supplier")).toBe("aad");
  expect(screen.getByRole("heading", { name: /^Invoice 7781203 from Reece Australia Pty Ltd, 29 Sept? 2026$/ })).toBeInTheDocument();
  /* the invoice is another supplier's: said, not refused */
  expect(screen.getByText("This invoice names Reece, not AAD.")).toBeInTheDocument();
  const rows = screen.getAllByRole("row").slice(1).map((r) => [...r.querySelectorAll("td")].map((td) => td.textContent));
  expect(rows).toEqual([
    ["PC1412", "Pair coil 1/4 1/2 15m", "2", "$118.50", "Was $124.00"],
    ["CMADJ", "Pipe clamp", "20", "$1.15", "New"],
    ["PC1438", "Pair coil 1/4 3/8 15m", "1", "$99.00", "Keeps $95.00, a newer price"],
  ]);
  expect(screen.getByText("Not taken: Freight, not a product.")).toBeInTheDocument();
  /* nothing has gone in yet */
  expect(onImported).not.toHaveBeenCalled();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Add 3 prices" }));
  });
  expect(posts[1]!.url).toBe("/api/quoting/invoice-lines");
  expect(JSON.parse(posts[1]!.body as string)).toEqual({
    supplier: "aad",
    invoiceNo: "7781203",
    invoiceDate: "2026-09-29",
    fileName: "INV-7781203.pdf",
    lines: [
      { code: "PC1412", name: "Pair coil 1/4 1/2 15m", cents: 11850 },
      { code: "CMADJ", name: "Pipe clamp", cents: 115 },
      { code: "PC1438", name: "Pair coil 1/4 3/8 15m", cents: 9900 },
    ],
  });
  expect(screen.getByText("AAD invoice 7781203 in: 3 items read, 1 price changed, 1 new.")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(onImported).toHaveBeenCalled();
});

it("cancels an invoice read without adding anything, and says what went wrong reading one", async () => {
  global.fetch = jest.fn(async () => ({ json: async () => ({ ok: false, reason: "That's 14 pages. Tiff reads an invoice of up to 10." }) })) as unknown as typeof fetch;
  render(<PriceBook suppliers={[acme]} onImported={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /^Acme/ }));
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Add Acme invoices"), { target: { files: [new File(["%PDF"], "statement.pdf", { type: "application/pdf" })] } });
  });
  expect(screen.getByText("That's 14 pages. Tiff reads an invoice of up to 10.")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();

  global.fetch = jest.fn(async () => ({
    json: async () => ({ ok: true, read: { supplier: "", invoiceNo: "", invoiceDate: null, lines: [{ code: "AC-100", name: "Bracket", qty: 4, cents: 1000, now: null, after: 1000 }], skipped: [] } }),
  })) as unknown as typeof fetch;
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Add Acme invoices"), { target: { files: [new File(["jpeg"], "invoice.jpg", { type: "image/jpeg" })] } });
  });
  /* a photo goes as a photo, read off the disk first; with no number on it
     the file names it */
  expect(await screen.findByRole("heading", { name: "invoice.jpg" })).toBeInTheDocument();
  const sent = ((global.fetch as jest.Mock).mock.calls[0]![1] as RequestInit).body as FormData;
  expect((sent.get("file") as File).type).toBe("image/jpeg");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it("doesn't send an invoice file over 4 MB, which the host would refuse", async () => {
  global.fetch = jest.fn() as unknown as typeof fetch;
  render(<PriceBook suppliers={[acme]} onImported={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /^Acme/ }));
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Add Acme invoices"), {
      target: { files: [new File([new Uint8Array(5 * 1024 * 1024)], "scan.pdf", { type: "application/pdf" })] },
    });
  });
  expect(screen.getByText("That file is over 4 MB.")).toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
});
