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
  const { container } = render(<PriceBook suppliers={[acme]} onImported={onImported} />);
  const input = container.querySelector("input[type=file]") as HTMLInputElement;
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
  expect(screen.getByText("Acme price list in: 2 items read, no price changed, 2 new.")).toBeInTheDocument();
  expect(screen.queryByText("Which column is which in acme.xlsx?")).not.toBeInTheDocument();
  expect(onImported).toHaveBeenCalled();
});
