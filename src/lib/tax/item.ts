import { CATEGORY_LABEL } from "@/lib/expenses/claim";

/* One line of substantiation, and what a set of them adds up to — pure.

   Kept apart from query.ts because that module opens a Supabase client the
   moment it is imported, and both the CSV builder and the screen need only the
   SHAPE. Splitting them means the export can be tested without a database, and
   more to the point without anyone being tempted to point a test at the real
   one. */

export type TaxSource = "fuel" | "expense";

export const TAX_CATEGORIES = ["fuel", "materials", "tools", "travel", "meals", "other"] as const;
export type TaxCategory = (typeof TAX_CATEGORIES)[number];

/* Fuel is the only category this track adds; the rest are the expense-claim
   categories, spread from their own module so the two screens can never drift
   into calling the same thing by two names. */
export const TAX_CATEGORY_LABEL: Record<TaxCategory, string> = {
  fuel: "Fuel",
  ...CATEGORY_LABEL,
};

export type TaxItem = {
  id: string;
  source: TaxSource;
  /** ISO. For fuel this is the date on the docket; for a claim, the date the
      money was spent — never the date either was entered. */
  date: string;
  supplier: string | null;
  /** Eleven digits, unformatted. */
  abn: string | null;
  category: TaxCategory;
  description: string;
  /** GST-inclusive, in dollars. */
  amount: number;
  /** Null where the receipt showed none — never a calculated eleventh. */
  gst: number | null;
  staffName: string | null;
  /** Fuel only: which vehicle it went into. */
  vehicle: string | null;
  /** Short-lived signed link to the stored receipt, when one was asked for. */
  receiptUrl: string | null;
  receiptIsImage: boolean;
  hasReceipt: boolean;
  /* A claim nobody has approved yet. It is real money already spent, so it
     belongs in the year — but an accountant reading a total wants to know
     which part of it the business has actually accepted. */
  provisional: boolean;
};

export type CategoryTotal = { category: TaxCategory; amount: number; gst: number; count: number };

export type TaxTotals = {
  amount: number;
  gst: number;
  count: number;
  /** How many line items have the document behind them. The one number on
      this screen that says whether the year would survive being asked. */
  withReceipt: number;
  provisionalAmount: number;
  byCategory: CategoryTotal[];
};

export type TaxYear = { fy: number; items: TaxItem[]; totals: TaxTotals };

export function totalsFor(items: TaxItem[]): TaxTotals {
  const byCategory = new Map<TaxCategory, CategoryTotal>();
  let amount = 0;
  let gst = 0;
  let withReceipt = 0;
  let provisionalAmount = 0;

  for (const i of items) {
    amount += i.amount;
    // A missing GST contributes NOTHING rather than being treated as zero on a
    // GST-inclusive amount — the difference between "no tax line on the
    // docket" and "this purchase was GST-free", which are not the same claim.
    gst += i.gst ?? 0;
    if (i.hasReceipt) withReceipt += 1;
    if (i.provisional) provisionalAmount += i.amount;

    const row = byCategory.get(i.category) ?? { category: i.category, amount: 0, gst: 0, count: 0 };
    row.amount += i.amount;
    row.gst += i.gst ?? 0;
    row.count += 1;
    byCategory.set(i.category, row);
  }

  // Rounded ONCE, at the end: rounding each addend first is how a column of
  // cents stops matching the total printed under it.
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    amount: round(amount),
    gst: round(gst),
    count: items.length,
    withReceipt,
    provisionalAmount: round(provisionalAmount),
    byCategory: TAX_CATEGORIES.filter((c) => byCategory.has(c)).map((c) => {
      const row = byCategory.get(c) as CategoryTotal;
      return { ...row, amount: round(row.amount), gst: round(row.gst) };
    }),
  };
}

export function asTaxCategory(value: unknown): TaxCategory {
  return (TAX_CATEGORIES as readonly string[]).includes(value as string)
    ? (value as TaxCategory)
    : "other";
}
