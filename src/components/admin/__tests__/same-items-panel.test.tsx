/* One part at two suppliers on the Quoting page: each proposed pair with
   both prices, the cheaper marked, and an answer that takes it off the
   list and counts a confirmation. */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SameItemsPanel } from "../same-items-panel";

const proposal = {
  a: { supplierKey: "aad", code: "PC1412", name: "PAIRED COIL 1/4+1/2X20M", supplierName: "AAD", netCents: 19100, uom: null },
  b: { supplierKey: "reece", code: "9800006-1", name: 'ARDENT PR CU 1/4" X 1/2" R410A 20M (COIL)', supplierName: "Reece", netCents: 19438, uom: "COIL" },
  why: "size",
  shared: ["1/4", "1/2", "20 m"],
};

it("shows a pair with both prices, and a confirmation takes it off the list", async () => {
  const posted: unknown[] = [];
  global.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted.push(JSON.parse(String(init.body)));
      return { json: async () => ({ ok: true }) } as Response;
    }
    return { json: async () => ({ ok: true, proposals: [proposal], confirmed: 2 }) } as Response;
  }) as unknown as typeof fetch;

  render(<SameItemsPanel />);
  expect(await screen.findByText("2 confirmed, 1 to check. A confirmed pair is one item priced at both suppliers.")).toBeInTheDocument();
  expect(screen.getByText("$191.00")).toHaveClass("ok");
  expect(screen.getByText("$194.38")).not.toHaveClass("ok");
  expect(screen.getByText("1/4, 1/2, 20 m")).toBeInTheDocument();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Same item" }));
  });
  expect(posted).toEqual([{ a: "aad|PC1412", b: "reece|9800006-1", decision: "confirmed" }]);
  expect(screen.getByText("3 confirmed, 0 to check. A confirmed pair is one item priced at both suppliers.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Same item" })).not.toBeInTheDocument();
});
