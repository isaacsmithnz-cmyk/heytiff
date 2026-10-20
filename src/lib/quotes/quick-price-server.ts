import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { bookProducts } from "./book-view-server";
import { buildSettingsOf, unsetWords } from "./build-settings";
import { zoneKitOf } from "./kits";
import { addLine } from "./lines-server";
import { packMakers, zoningFor } from "./lookups-server";
import { readOrgDay } from "./org-day-server";
import { dollars, makerOf, priceQuick, roughRange, zoneKitParts, type QuickPart } from "./quick-price";
import { readQuoteSettings } from "./settings-query";
import { linePricer } from "./session/tools-server";

/* THE QUICK PRICE, ON THE SERVER (./quick-price says what it is for). Read
   by Tiff's quick_price tool (lib/tiff/registry/reads), and the lines go on
   the job's quote from her answer's Add to quote. */

/** What a quick price hands the page under her answer: enough to put the
    same parts and hours on the job's quote, priced again there. */
export type QuickOffer = {
  jobUuid: string | null;
  title: string;
  parts: { name: string; code: string; qty: number; kind: "unit" | "material" }[];
  hours: number;
};

export type QuickInput = {
  title: string;
  parts: QuickPart[];
  hours: number;
  zoning?: { brand: string; zones: number; control: "temperature" | "on_off"; wifi: boolean } | null;
  jobUuid?: string | null;
};

export type QuickAnswer = { value: Record<string, unknown>; offer: QuickOffer | null };


/** A quick price as she reads it: the whole of it for a person who sees the
    business's prices; for anyone else, where the business allows it, a
    rough range to say to a customer and nothing it's made of. */
export async function quickPriceFor(orgId: string, seesPrices: boolean, input: QuickInput): Promise<QuickAnswer> {
  const [settings, day] = await Promise.all([readQuoteSettings(orgId), readOrgDay(orgId)]);
  if (!seesPrices && !settings.staffRoughPrice)
    return { value: { priced: false, say: "Rough prices are for the people who see the business's prices here. Send it to the office to price." }, offer: null };
  const built = buildSettingsOf(settings, day);
  if (!built.ok) return { value: { priced: false, say: seesPrices ? unsetWords(built.unset) : "The business hasn't set its prices up in Quoting yet." }, offer: null };

  const parts = [...input.parts];
  let kitNote: string | null = null;
  if (input.zoning?.brand && input.zoning.zones > 0) {
    const maker = makerOf(await packMakers(), input.zoning.brand);
    const z = maker ? await zoningFor(maker) : null;
    if (!z) kitNote = `No zoning data for ${input.zoning.brand}: price its parts by name.`;
    else {
      const kit = zoneKitOf(z, input.zoning.zones, input.zoning.control, input.zoning.wifi);
      parts.unshift(...zoneKitParts(kit));
      if (!kit.interface) kitNote = `${input.zoning.brand}'s interfaces don't take ${input.zoning.zones} zones.`;
    }
  }

  const supplier = input.jobUuid ? await linePricer(orgId, input.jobUuid).supplier() : null;
  const q = priceQuick(parts, input.hours, await bookProducts(orgId), built.settings, supplier);
  const offer: QuickOffer | null =
    q.lines.length > 0 || q.hours > 0
      ? {
          jobUuid: input.jobUuid ?? null,
          title: input.title.trim().slice(0, 80) || "Quick price",
          parts: q.lines.map((l) => ({ name: l.name, code: l.code, qty: l.qty, kind: l.kind })),
          hours: q.hours,
        }
      : null;
  const zoneHours = settings.taskHours.zone;
  const common = {
    priced: q.lines.length > 0 || q.hours > 0,
    missing_from_the_book: q.missing,
    ...(kitNote ? { kit: kitNote } : {}),
    ...(zoneHours != null ? { the_business_hours_a_zone: zoneHours } : {}),
    hours: q.hours,
  };
  if (seesPrices)
    return {
      value: {
        ...common,
        parts: q.lines.map((l) => ({ name: l.name, code: l.code, qty: l.qty, buy: dollars(l.buyCents), sell: dollars(l.sellCents) })),
        labour_sell: dollars(q.labourSellCents),
        ex_gst: dollars(q.exGstCents),
        inc_gst: dollars(q.incGstCents),
      },
      offer,
    };
  const r = roughRange(q.incGstCents);
  return {
    value: {
      ...common,
      parts: q.lines.map((l) => ({ name: l.name, qty: l.qty })),
      rough_inc_gst: `${dollars(r.lowCents)} to ${dollars(r.highCents)}`,
      say: "This is a rough price to say to the customer, inc GST, with a firm quote to follow. Never say what it's made of in dollars.",
    },
    offer,
  };
}

/** Put a quick price on the job's quote as an option of its own, so an
    option already sent or accepted never changes: the parts priced again
    from the book now, the hours at the business's rate. */
export async function addQuickToQuote(orgId: string, offer: QuickOffer, by: string): Promise<{ ok: true; option: number } | { ok: false; reason: string }> {
  const jobUuid = offer.jobUuid;
  if (!jobUuid) return { ok: false, reason: "Ask it on the job's own page to put it on the job's quote." };
  const { data } = await supabaseAdmin
    .from("quote_lines")
    .select("option_index")
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", jobUuid)
    .order("option_index", { ascending: false })
    .limit(1);
  const last = (data?.[0]?.option_index as number | undefined) ?? -1;
  const option = last + 1;
  const pricer = linePricer(orgId, jobUuid);
  const group = offer.title;
  const why = "A quick price Tiff worked out on site";
  for (const p of offer.parts.slice(0, 30)) {
    const row = await pricer.lineFor({ optionIndex: option, system: "", group, name: p.name, code: p.code, kind: p.kind, qty: p.qty, unit: "", source: "assumed", why });
    if (typeof row === "string") return { ok: false, reason: row };
    const added = await addLine(orgId, jobUuid, row, by, why);
    if (!added.ok) return { ok: false, reason: added.reason };
  }
  if (offer.hours > 0) {
    const row = await pricer.lineFor({ optionIndex: option, system: "", group, name: "Labour", code: null, kind: "labour", qty: offer.hours, unit: "h", source: "assumed", why });
    if (typeof row !== "string") {
      const added = await addLine(orgId, jobUuid, row, by, why);
      if (!added.ok) return { ok: false, reason: added.reason };
    }
  }
  return { ok: true, option };
}
