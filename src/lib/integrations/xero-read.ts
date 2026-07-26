/* Reading FROM Xero — server only, and the first thing in HeyTiff that spends
   the grant rather than just creating it.

   THREE RULES, all inherited from src/lib/integrations/xero.ts:

   1. A FRESH CLIENT PER CALL. XeroClient carries its token set on the instance,
      so a shared one is a cross-request token leak waiting to happen.
   2. NOTHING FROM XERO IS FORWARDED VERBATIM. Every failure becomes one of our
      own sentences; an upstream body can name the tenant, the client id, or the
      reason a token was refused, and none of that belongs on a screen.
   3. RESPONSES ARE SHAPED AT THE BOUNDARY (xero-shape.ts), so a generated model
      with a home address and bank accounts on it never reaches a component.

   ONE MORE, SPECIFIC TO READING: a 401 here means the grant died between
   `xeroAccess()` handing us a token and us using it — revoked from Xero's own
   Connected Apps screen, most likely. That is exactly `needs_reauth`, so we say
   so, and the next render of the integrations screen tells the owner to
   reconnect instead of showing an empty payroll as though it were the truth.

   EVERY CALL IS USER-INITIATED. There are no background jobs here on purpose:
   Xero allows 60 calls/minute/tenant and 1,000/day on the starter tier, and a
   poller is how you spend that on nobody's behalf. */

import { XeroClient } from "xero-node";
import { xeroConfig } from "./xero";
import { markNeedsReauth, xeroAccess, type XeroAccess } from "./store";
import {
  shapeCalendars,
  shapeEmployees,
  type XeroEmployee,
  type XeroPayCalendar,
} from "./xero-shape";

/** Every read answers with this: the caller gets data, or a sentence it can
    show, and never has to catch anything. */
export type ReadResult<T> = { ok: true; data: T } | { ok: false; error: string };

const NOT_CONNECTED = "Xero isn't connected.";
const UNAVAILABLE = "Xero didn't answer. Try again in a moment.";
const REAUTH = "The Xero connection needs reconnecting.";

/** Xero returns AU payroll employees 100 at a time. Ten pages is a thousand
    employees — far past any trade business, and a hard stop so a paging bug
    upstream can't turn one screen into an unbounded spend of the daily quota. */
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

function client(access: XeroAccess): XeroClient | null {
  const cfg = xeroConfig();
  if (!cfg) return null;
  const xero = new XeroClient({
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    redirectUris: [cfg.redirectUri],
    // Reads never redirect anyone, so no scopes/state are needed here — the
    // token already carries what was consented to.
    scopes: [],
  });
  // The access token is enough for the API surface; setTokenSet would throw on
  // a missing access_token, which xeroAccess() has already guaranteed.
  xero.setTokenSet({ access_token: access.accessToken });
  return xero;
}

/** True when the failure is Xero telling us the grant is gone. */
function isAuthFailure(err: unknown): boolean {
  const status = (err as { response?: { status?: unknown } })?.response?.status;
  return status === 401 || status === 403;
}

/** The shared body of every read: resolve a usable token, build a client, run
    the call, and turn every failure into one of our sentences. */
async function read<T>(
  orgId: string,
  run: (xero: XeroClient, tenantId: string) => Promise<T>
): Promise<ReadResult<T>> {
  const access = await xeroAccess(orgId);
  // Null already means "not connected, or the grant is dead" — xeroAccess has
  // marked the row itself in the cases it can diagnose.
  if (!access) return { ok: false, error: NOT_CONNECTED };

  const xero = client(access);
  if (!xero) return { ok: false, error: NOT_CONNECTED };

  try {
    return { ok: true, data: await run(xero, access.tenantId) };
  } catch (err) {
    if (isAuthFailure(err)) {
      await markNeedsReauth(orgId, "Xero refused the connection. Reconnect Xero.");
      return { ok: false, error: REAUTH };
    }
    // No console.error with the response body: the point of a generic message
    // is defeated if the detail lands in a log line instead.
    return { ok: false, error: UNAVAILABLE };
  }
}

/** Everyone on the connected organisation's AU payroll.

    Terminated employees are INCLUDED: someone who left is still the right
    answer for "who was this link pointing at?", and the linking screen wants to
    say "no longer in Xero" rather than have the row vanish. */
export async function listPayrollEmployees(orgId: string): Promise<ReadResult<XeroEmployee[]>> {
  return read(orgId, async (xero, tenantId) => {
    const all: XeroEmployee[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await xero.payrollAUApi.getEmployees(tenantId, undefined, undefined, undefined, page);
      const batch = shapeEmployees(res.body?.employees);
      all.push(...batch);
      // A short page is the last page. Shaping can drop rows, so the raw length
      // is what decides — using the shaped count would stop early on one junk
      // record and silently hide everyone after it.
      if ((res.body?.employees?.length ?? 0) < PAGE_SIZE) break;
    }
    return all;
  });
}

/** The organisation's pay calendars — weekly, fortnightly, whatever they run.
    Advisory only: this is compared against `pay_settings`, never written into
    it. */
export async function listPayCalendars(orgId: string): Promise<ReadResult<XeroPayCalendar[]>> {
  return read(orgId, async (xero, tenantId) => {
    const res = await xero.payrollAUApi.getPayrollCalendars(tenantId);
    return shapeCalendars(res.body?.payrollCalendars);
  });
}

/** How many employees the grant can see. The cheapest possible proof that the
    connection actually works — one call, one number, no data held. */
export async function countPayrollEmployees(orgId: string): Promise<ReadResult<number>> {
  const result = await listPayrollEmployees(orgId);
  return result.ok ? { ok: true, data: result.data.length } : result;
}
