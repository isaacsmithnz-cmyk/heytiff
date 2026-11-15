import { dayName } from "./job-tracker";
import { QUOTE_WORDS, type QuoteRowInput } from "@/lib/integrations/sm8-quote-plan";

/* THE INVOICE BUILDER BEHIND PRICE (the job page plan's build 10, on the
   invoice mock of 3 November 2026, boards Svc* and InvLines, acted out on
   3221 and 1725; Isaac, 14 November 2026: "Build all as recommended, I'll
   change anything I'm not happy with after"). What New invoice offers to put
   on the job in ServiceM8, worked out from what the job already knows:

     labour     the hours on site, a line a day, at the business's own
                charge-out rate (Quoting): who was there and for how long
     materials  what was said used on the job (the wrap-up's list,
                job_materials_used), each priced from the price book at
                cost and sold at the business's markup on materials

   A JOB PRICED ALREADY INVOICES THAT PRICE. An accepted quote's lines went
   to ServiceM8 when it was accepted, and a service call carries the service
   it was booked as (3221's "Annual Maintenance Service 3hrs"), so the hours
   are in them: only what was used beyond them is offered.

   NO MADE-UP FIGURES (Isaac, 2026-10-04). With no charge-out rate or no
   markup on materials set, nothing is priced and the builder says what to
   set; a thing the book has no price for is offered unpriced, and can't be
   sent until it is.

   ONCE. A line an earlier press put on the job stands as "On the job in
   ServiceM8" and is never offered again; its key is the day or the thing,
   so the same day twice is the same line. ServiceM8 makes the invoice
   itself from the job's lines, and sends it. Pure. */

export type InvoiceLine = {
  /** the day or the thing: "labour:2026-11-11", "used:rexel|ABC123|m" */
  key: string;
  kind: "labour" | "material";
  /** "Labour, Tue 11 Nov", or the book's name */
  name: string;
  /** "Isaac 3.5 h, Luke 3.5 h", "2 m, Tue 11 Nov" */
  detail: string;
  qty: number;
  /** "h", "m", or null for a count */
  unit: string | null;
  /** ex GST; null where the book has no price */
  unitSellCents: number | null;
  unitCostCents: number | null;
  /** an earlier press put it on the job in ServiceM8 */
  sent: boolean;
};

export type InvoiceDraft =
  | {
      ok: true;
      lines: InvoiceLine[];
      /** what it was built from: the days on site, and how many things used */
      from: { days: string[]; used: number };
      /** the job has an accepted quote, already on the job in ServiceM8 */
      quoted: boolean;
      /** ServiceM8 has sent the job's invoice already: it's sent again from there */
      invoiced: boolean;
      jobNumber: string | null;
    }
  | { ok: false; why: string };

/** Hours to the quarter, as a day is charged. */
const quarter = (h: number) => Math.round(h * 4) / 4;
const hoursWord = (h: number) => `${quarter(h)} h`;
const first = (name: string) => name.trim().split(/\s+/)[0] || name.trim();

/** What a used thing is known by: its supplier, code (else name) and unit. */
export const usedKey = (u: { supplier: string | null; code: string | null; name: string; unit: string | null }) =>
  `used:${(u.supplier ?? "").toLowerCase()}|${(u.code ?? u.name).toLowerCase()}|${u.unit ?? ""}`;

export function invoiceDraft(input: {
  /** each person's days on the job, in minutes (job-money's count) */
  people: readonly { name: string; days: readonly { day: string; minutes: number }[] }[];
  /** what was said used, a row a day */
  used: readonly { day: string; supplier: string | null; code: string | null; name: string; qty: number; unit: string | null }[];
  /** the book's cost for a used thing, ex GST; null where it has none */
  costOf: (u: { supplier: string | null; code: string | null; unit: string | null }) => { costCents: number; name: string } | null;
  /** the business's own figures, or what it hasn't set */
  settings: { chargeOutCents: number | null; materialMarkupPct: number | null };
  /** the job's price is on it in ServiceM8 already (an accepted quote's
      lines, a booked service), with the codes it holds where HeyTiff
      built it; null where it has no lines yet */
  quote: { codes: readonly string[] } | null;
  /** the keys an earlier press sent */
  sent: ReadonlySet<string>;
  invoiced: boolean;
  jobNumber: string | null;
}): InvoiceDraft {
  const { settings } = input;
  const missing = [settings.chargeOutCents ? null : "a charge-out rate", settings.materialMarkupPct == null ? "a markup on materials" : null].filter(Boolean);
  if (missing.length > 0) return { ok: false, why: `Set ${missing.join(" and ")} in Quoting to price an invoice.` };
  const rate = settings.chargeOutCents!;
  const markup = settings.materialMarkupPct!;

  /* LABOUR, a line a day, unless the accepted quote holds the hours */
  /* each day, each person's minutes on it: a day may hold two stretches */
  const byDay = new Map<string, Map<string, number>>();
  for (const p of input.people)
    for (const d of p.days) {
      if (!(d.minutes > 0)) continue;
      const day = byDay.get(d.day) ?? new Map<string, number>();
      day.set(p.name, (day.get(p.name) ?? 0) + d.minutes);
      byDay.set(d.day, day);
    }
  const days = [...byDay.keys()].sort();
  const labour: InvoiceLine[] = input.quote
    ? []
    : days.map((day) => {
        const who = [...byDay.get(day)!.entries()];
        const hours = who.reduce((t, [, m]) => t + m / 60, 0);
        const key = `labour:${day}`;
        return {
          key,
          kind: "labour",
          name: `Labour, ${dayName(day)}`,
          detail: who.map(([name, m]) => `${first(name)} ${hoursWord(m / 60)}`).join(", "),
          qty: quarter(hours),
          unit: "h",
          unitSellCents: rate,
          unitCostCents: null,
          sent: input.sent.has(key),
        };
      });

  /* MATERIALS: each thing added up across its days, in the unit it was said in */
  const codes = new Set((input.quote?.codes ?? []).map((c) => c.trim().toUpperCase()).filter(Boolean));
  const things = new Map<string, { supplier: string | null; code: string | null; name: string; unit: string | null; qty: number; days: string[] }>();
  for (const u of input.used) {
    if (!(u.qty > 0)) continue;
    const key = usedKey(u);
    const t = things.get(key) ?? { supplier: u.supplier, code: u.code, name: u.name, unit: u.unit, qty: 0, days: [] };
    t.qty += u.qty;
    if (!t.days.includes(u.day)) t.days.push(u.day);
    things.set(key, t);
  }
  const materials: InvoiceLine[] = [...things.entries()]
    /* on a quoted job, what the quote already holds is the quote's */
    .filter(([, t]) => !(t.code && codes.has(t.code.trim().toUpperCase())))
    .map(([key, t]) => {
      const book = input.costOf(t);
      const qty = Math.round(t.qty * 1000) / 1000;
      return {
        key,
        kind: "material" as const,
        name: book?.name ?? t.name,
        detail: `${qty}${t.unit ? ` ${t.unit}` : " used"}, ${t.days.sort().map(dayName).join(", ")}`,
        qty,
        unit: t.unit,
        unitSellCents: book ? Math.round(book.costCents * (1 + markup / 100)) : null,
        unitCostCents: book ? book.costCents : null,
        sent: input.sent.has(key),
      };
    });

  return {
    ok: true,
    lines: [...labour, ...materials],
    from: { days, used: things.size },
    quoted: !!input.quote,
    invoiced: input.invoiced,
    jobNumber: input.jobNumber,
  };
}

/** A line's total ex GST; null where it has no price. */
export const lineCents = (l: Pick<InvoiceLine, "qty" | "unitSellCents">): number | null => (l.unitSellCents === null ? null : Math.round(l.unitSellCents * l.qty));

/** Whether a line can go: priced, and not on the job already. */
export const sendable = (l: Pick<InvoiceLine, "unitSellCents" | "sent">) => l.unitSellCents !== null && !l.sent;

/** "Built from Tue 11 Nov and Wed 12 Nov on site, and 3 things used". */
export function builtFromWords(from: { days: readonly string[]; used: number }, quoted: boolean): string {
  const on = from.days.length === 0 ? "no time on site recorded" : `${andList(from.days.map(dayName))} on site`;
  const used = from.used === 0 ? "nothing recorded as used" : `${from.used} ${from.used === 1 ? "thing" : "things"} used`;
  return quoted ? `The accepted quote, and ${used} beyond it` : `${on.charAt(0).toUpperCase()}${on.slice(1)}, and ${used}`;
}

function andList(xs: readonly string[]): string {
  return xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
}

/** A unit amount as ServiceM8 keeps it: dollars to four places. */
const amount = (cents: number) => (cents / 100).toFixed(4);
const quantityOf = (n: number) => String(Math.round(n * 10000) / 10000);

/** The rows one send queues: a line added to the job per line chosen, as an
    accepted variation's are (sm8-variation-plan's variationRows), sorted
    after the lines already on it. No job row, and no line taken off: the
    job's own lines stay, and ServiceM8 invoices them all. */
export function invoiceRows(lines: readonly InvoiceLine[], input: { taxRateUuid: string; after: number; rowKey: (lineKey: string) => string }): QuoteRowInput[] {
  return lines.filter(sendable).map((l, i) => {
    const price = amount(l.unitSellCents!);
    const name = l.kind === "labour" ? `${l.name}: ${l.detail}` : l.name;
    return {
      object: "jobmaterial" as const,
      op: "create" as const,
      uuid: null,
      fields: {
        name: name.slice(0, 200),
        quantity: quantityOf(l.qty),
        price,
        ...(l.unitCostCents != null ? { cost: amount(l.unitCostCents) } : {}),
        displayed_amount: price,
        displayed_amount_is_tax_inclusive: "0",
        tax_rate_uuid: input.taxRateUuid,
        sort_order: String(input.after + i + 1),
      },
      label: QUOTE_WORDS.label.invoiceAdd.replace("{name}", name.slice(0, 60)),
      key: input.rowKey(l.key),
    };
  });
}
