/* A fuel docket, on its way from My expenses to the vehicle it went into.

   ONE PURCHASE, ONE RECORD. A tank of diesel had two doors that knew nothing
   about each other: Log fuel on My vehicle, which writes the vehicle log the
   tax export reads (litres, the odometer, the vehicle, the docket's ABN), and
   Scan a receipt on My expenses, whose Fuel category wrote a claim with none
   of that and no link to any log. The tax screen counts every live fuel log
   AND every claim that carries no log, so the same tank filed both ways was
   deducted twice — and on a personal card, paid twice.

   The expenses screen keeps its door: a docket in somebody's hand at the end
   of a job is exactly what that screen is for. What changes is where it
   lands. Choosing Fuel there hands the figures Tiff just read, and the photo
   itself, to Log fuel — which is one press, nothing retyped, and one record
   at the end of it.

   SESSION STORAGE, READ ONCE, for the same reasons as the library's ask
   handoff: it is a note left on the way to the next screen, not a thing to
   live in a URL or survive a refresh. */

export const FUEL_HANDOFF_KEY = "heytiff.fleet.fuel.v1";

export type FuelHandoff = {
  /** Dollars, as the form had them — the modal parses what it is given. */
  cost: string;
  gst: string;
  abn: string;
  /** The servo, from the docket's supplier line. */
  station: string;
  /** The docket's own date, not today's. */
  purchasedOn: string;
  /** Whose money — the answer the expenses form already asked for. */
  paidWith: "own" | "company";
  /** The stored docket, already uploaded as the log's own paper. */
  receiptDocumentId: string | null;
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function writeFuelHandoff(note: FuelHandoff): boolean {
  try {
    sessionStorage.setItem(FUEL_HANDOFF_KEY, JSON.stringify(note));
    return true;
  } catch {
    return false;
  }
}

/** Read the note and tear it up. Null when there wasn't one. */
export function consumeFuelHandoff(): FuelHandoff | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(FUEL_HANDOFF_KEY);
    sessionStorage.removeItem(FUEL_HANDOFF_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      cost: str(parsed.cost),
      gst: str(parsed.gst),
      abn: str(parsed.abn),
      station: str(parsed.station),
      purchasedOn: str(parsed.purchasedOn),
      paidWith: parsed.paidWith === "own" ? "own" : "company",
      receiptDocumentId: typeof parsed.receiptDocumentId === "string" ? parsed.receiptDocumentId : null,
    };
  } catch {
    return null;
  }
}
