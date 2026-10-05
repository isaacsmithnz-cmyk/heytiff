/**
 * @jest-environment node
 */
/* The two doors an invoice goes through: read (a PDF or a photo, nothing
   saved) and add (the lines the person looked over). Who gets in, what's
   refused before Tiff is asked, and what goes into the book. Tiff and the
   book are replaced at our own seams. */

const getSession = jest.fn();
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: () => getSession() } }));
let money = true;
jest.mock("@/lib/permissions-server", () => ({ can: async () => money }));

const SUPPLIERS = [{ key: "aad", name: "AAD", pricing: "net", file: "csv", format: "aad_csv", discountPct: 0, rules: [] }];
const importInvoiceRows = jest.fn(async (_org: string, _s: unknown, _from: string, rows: unknown[]) => ({ read: rows.length, added: rows.length, changed: 0, gone: 0 }));
jest.mock("@/lib/quotes/price-book-server", () => ({
  readSuppliers: async () => SUPPLIERS,
  importInvoiceRows: (org: string, s: unknown, from: string, rows: unknown[]) => importInvoiceRows(org, s, from, rows),
}));

const readInvoice = jest.fn(async () => ({ ok: true, read: { supplier: "", invoiceNo: "", invoiceDate: null, lines: [], skipped: [] } }));
jest.mock("@/lib/quotes/invoice-read-server", () => ({
  isInvoiceMedia: (t: string) => ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"].includes(t),
  readInvoice: (...a: unknown[]) => readInvoice(...(a as [])),
}));

let pages = 2;
jest.mock("@/lib/tiff/extract", () => ({ openPdf: async () => ({ numPages: pages, destroy: async () => {} }) }));

import { POST as readPost } from "../invoice-read/route";
import { POST as addPost } from "../invoice-lines/route";
import { todayInSydney } from "@/lib/quotes/price-book";

const fileForm = (file: File, supplier = "aad") => {
  const form = new FormData();
  form.set("supplier", supplier);
  form.set("file", file);
  return new Request("http://localhost/api/quoting/invoice-read", { method: "POST", body: form });
};
const pdf = (name = "INV-1.pdf") => new File(["%PDF-1.7"], name, { type: "application/pdf" });
const add = (body: unknown) =>
  new Request("http://localhost/api/quoting/invoice-lines", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  getSession.mockResolvedValue({ orgId: "org-1", user: { sub: "u1" } });
  money = true;
  pages = 2;
  process.env.ANTHROPIC_API_KEY = "test";
  readInvoice.mockClear();
  importInvoiceRows.mockClear();
});

describe("reading an invoice", () => {
  it("is for money access only", async () => {
    money = false;
    expect((await readPost(fileForm(pdf()))).status).toBe(403);
    expect((await addPost(add({ supplier: "aad", lines: [{ code: "X", cents: 1 }] }))).status).toBe(403);
    expect(readInvoice).not.toHaveBeenCalled();
    expect(importInvoiceRows).not.toHaveBeenCalled();
  });

  it("reads a PDF or a photo of one for the business's supplier, and nothing else", async () => {
    expect((await readPost(fileForm(pdf()))).status).toBe(200);
    expect(readInvoice).toHaveBeenCalledWith("org-1", SUPPLIERS[0], expect.any(Buffer), "application/pdf");
    expect((await readPost(fileForm(new File(["x"], "a.jpg", { type: "image/jpeg" })))).status).toBe(200);
    expect(await (await readPost(fileForm(new File(["a,b"], "a.csv", { type: "text/csv" })))).json()).toEqual({
      ok: false,
      reason: "Tiff reads an invoice from a PDF, or a photo as JPEG, PNG or WebP.",
    });
    expect(await (await readPost(fileForm(pdf(), "reece"))).json()).toEqual({ ok: false, reason: "No such supplier." });
    expect(readInvoice).toHaveBeenCalledTimes(2);
  });

  it("refuses a PDF longer than an invoice before Tiff is asked", async () => {
    pages = 14;
    expect(await (await readPost(fileForm(pdf("statement.pdf")))).json()).toEqual({ ok: false, reason: "That's 14 pages. Tiff reads an invoice of up to 10." });
    expect(readInvoice).not.toHaveBeenCalled();
  });
});

describe("adding an invoice's lines", () => {
  it("adds what was looked over, priced on the invoice's date, the same code once", async () => {
    const res = await addPost(
      add({
        supplier: "aad",
        invoiceNo: "INV-55120",
        invoiceDate: "2026-09-29",
        fileName: "INV-55120.pdf",
        lines: [
          { code: "CMADJ", name: "Pipe clamp", cents: 115 },
          { code: "CMADJ", name: "Pipe clamp", cents: 110 },
          { code: "", name: "No code", cents: 500 },
          { code: "BAD", name: "Half a cent", cents: 10.5 },
          { code: "AST-09KMTC", name: "Fujitsu indoor", cents: 22200 },
        ],
      })
    );
    expect(await res.json()).toEqual({ ok: true, summary: { read: 2, added: 2, changed: 0, gone: 0 } });
    expect(importInvoiceRows).toHaveBeenCalledWith("org-1", SUPPLIERS[0], "INV-55120.pdf", [
      { code: "CMADJ", name: "Pipe clamp", cents: 110, pricedOn: "2026-09-29" },
      { code: "AST-09KMTC", name: "Fujitsu indoor", cents: 22200, pricedOn: "2026-09-29" },
    ]);
  });

  it("prices a line on today when the date is missing or after today", async () => {
    await addPost(add({ supplier: "aad", invoiceDate: "2099-01-01", lines: [{ code: "CMADJ", name: "Pipe clamp", cents: 115 }] }));
    expect(importInvoiceRows.mock.calls[0]![3]).toEqual([{ code: "CMADJ", name: "Pipe clamp", cents: 115, pricedOn: todayInSydney() }]);
    expect(importInvoiceRows.mock.calls[0]![2]).toBe("an invoice");
  });

  it("adds nothing when no line holds up", async () => {
    const res = await addPost(add({ supplier: "aad", lines: [{ code: "X", cents: 0 }] }));
    expect(res.status).toBe(400);
    expect(importInvoiceRows).not.toHaveBeenCalled();
  });
});
