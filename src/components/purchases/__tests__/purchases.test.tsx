/* Add a purchase, on a docket already read (as Put away resumes it): tick
   lines, Add to job, the job, back on the lines with those stamped, Stock
   the rest, Where it went. And Team's list. */
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Purchase, PurchaseLine } from "@/lib/purchases/purchase";

const placePurchaseLines = jest.fn();
jest.mock("@/app/actions/purchases", () => ({
  addPurchase: jest.fn(),
  placePurchaseLines: (...a: unknown[]) => placePurchaseLines(...a),
  pricePurchaseLine: jest.fn(),
  recentJobsForPurchase: async () => [{ jobUuid: "j-3304", label: "3304, 88 Kirribilli Avenue" }],
}));
jest.mock("@/app/actions/workboard", () => ({ searchAllJobs: async () => [] }));
jest.mock("@/lib/documents/upload-client", () => ({ uploadFile: jest.fn() }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }), useSearchParams: () => new URLSearchParams() }));

import { AddPurchase } from "../add-purchase";
import { TeamPurchases } from "../team-purchases";
import { purchaseRow } from "@/lib/purchases/purchase-list-server";

jest.mock("@/lib/purchases/purchase-server", () => ({}));
jest.mock("@/lib/documents/query", () => ({}));
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

const line = (id: string, over: Partial<PurchaseLine>): PurchaseLine => ({
  id,
  position: 0,
  code: `C-${id}`,
  name: `Line ${id}`,
  qty: 1,
  cents: 1000,
  priceFrom: "docket",
  book: "same",
  bookBefore: 1000,
  bookAfter: 1000,
  wentTo: "open",
  jobUuid: null,
  jobLabel: null,
  ...over,
});

const reece = (lines: PurchaseLine[]): Purchase => ({
  id: "p1",
  supplierName: "Reece",
  supplierKey: "reece",
  invoiceNo: "7729 4410",
  invoiceDate: "2026-10-29",
  boughtBy: { id: "s1", name: "Leo Watanangura" },
  createdAt: "2026-10-29T05:12:00Z",
  skipped: [],
  documentId: "d1",
  lines,
});

const lines = [
  line("a", { name: "Ardent pair coil 3/8 x 5/8", cents: 27387, book: "up", bookBefore: 26840, bookAfter: 27387 }),
  line("b", { name: "Ardent pair coil 1/4 x 3/8", cents: 15233, priceFrom: "book", book: "from_book" }),
  line("c", { name: "Spring nut M10", code: "", cents: null, book: "none" }),
];

beforeEach(() => placePurchaseLines.mockReset());

it("ticks lines onto a job, comes back to them stamped, then stocks the rest", async () => {
  const user = userEvent.setup();
  render(<AddPurchase resume={reece(lines)} job={{ jobUuid: "j-1352", label: "1352, Holbrook" }} onClose={() => {}} />);
  const d = within(screen.getByRole("dialog"));
  expect(d.getByText("Reece, invoice 7729 4410, Thu 29 Oct. Bought by Leo Watanangura.")).toBeTruthy();
  expect(d.getByText("From the price book")).toBeTruthy();
  /* no price anywhere: asked for, and it can't be ticked */
  expect((d.getByRole("checkbox", { name: "Tick Spring nut M10" }) as HTMLInputElement).disabled).toBe(true);
  expect(d.getByRole("button", { name: "Stock all" })).toBeTruthy();

  await user.click(d.getByRole("checkbox", { name: "Tick Ardent pair coil 3/8 x 5/8" }));
  await user.click(d.getByRole("checkbox", { name: "Tick Ardent pair coil 1/4 x 3/8" }));
  placePurchaseLines.mockResolvedValueOnce({
    ok: true,
    purchase: reece([
      { ...lines[0], wentTo: "job", jobUuid: "j-1352", jobLabel: "1352, 9/6 Holbrook Avenue" },
      { ...lines[1], wentTo: "job", jobUuid: "j-1352", jobLabel: "1352, 9/6 Holbrook Avenue" },
      lines[2],
    ]),
  });
  await user.click(d.getByRole("button", { name: "Add to job" }));
  const which = within(screen.getByRole("dialog"));
  expect(which.getByText("Two lines, $426.20")).toBeTruthy();
  expect(which.getByText("This job")).toBeTruthy();
  await act(async () => {});
  expect(which.getByText("3304, 88 Kirribilli Avenue")).toBeTruthy();
  await user.click(which.getByRole("button", { name: "1352, Holbrook" }));
  expect(placePurchaseLines).toHaveBeenCalledWith("p1", ["a", "b"], { jobUuid: "j-1352" });

  const back = within(screen.getByRole("dialog"));
  expect(back.getAllByText("1352, 9/6 Holbrook Avenue")).toHaveLength(2);
  expect(back.getByText("Added to 1352, Holbrook")).toBeTruthy();
  /* the spring nuts still have no price, so there's nothing yet to stock */
  expect((back.getByRole("button", { name: "Stock the rest" }) as HTMLButtonElement).disabled).toBe(true);
});

it("says where it all went, and what the docket did to the book", () => {
  const done = reece([
    { ...lines[0], wentTo: "job", jobUuid: "j-1352", jobLabel: "1352, 9/6 Holbrook Avenue" },
    { ...lines[1], wentTo: "job", jobUuid: "j-1352", jobLabel: "1352, 9/6 Holbrook Avenue" },
    { ...lines[2], cents: 1890, wentTo: "stock" },
  ]);
  render(<AddPurchase resume={done} onClose={() => {}} />);
  const d = within(screen.getByRole("dialog", { name: "Where it went" }));
  expect(d.getByText("1352, 9/6 Holbrook Avenue")).toBeTruthy();
  expect(d.getByText("$426.20")).toBeTruthy();
  expect(d.getByText("Stock")).toBeTruthy();
  expect(d.getByText("Price up, $268.40 to $273.87")).toBeTruthy();
  expect(d.getByText("Same as the book, nothing changed")).toBeTruthy();
});

it("lists a purchase with where it went, its book and its figure; one still open says so", () => {
  const row = purchaseRow(reece([{ ...lines[0], wentTo: "job", jobUuid: "j", jobLabel: "1352, 9/6 Holbrook Avenue" }, lines[1]]));
  expect(row).toMatchObject({ wentTo: "1352, 9/6 Holbrook Avenue", wentNote: "One line still to put somewhere", open: 1, cents: 42620 });
  expect(row.book).toEqual({ text: "One price up", tone: "or" });
  render(<TeamPurchases data={{ rows: [row], open: null }} adding={false} onAdded={() => {}} />);
  expect(screen.getByRole("link", { name: "Reece" }).getAttribute("href")).toBe("/dashboard/team?view=purchases&purchase=p1");
  expect(screen.getByText("Invoice 7729 4410")).toBeTruthy();
  expect(screen.getByText("$426.20")).toBeTruthy();
});
