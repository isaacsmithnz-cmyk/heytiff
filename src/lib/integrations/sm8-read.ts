/* Reading from ServiceM8 on behalf of an org — the thin layer between
   sm8-store's tokens and anything that renders. xero-read.ts's sibling, and
   the same three-sentence posture: every failure a screen can see is one of
   OUR sentences, never an upstream body.

   PR 1 owns exactly one read — the vendor proof-of-life on the connection
   screen. The paginated object reader the sync engine needs arrives with the
   mirror tables in PR 2, so this file grows alongside its features rather
   than ahead of them.

   NO SESSION HERE — callers establish the right to ask (the page behind its
   owner gate today, the cron behind CRON_SECRET next PR) and hand in a bare
   orgId. */

import { fetchSm8Vendor, sm8Config, type Sm8Vendor } from "./sm8";
import { markSm8NeedsReauth, sm8Access } from "./sm8-store";
import type { ReadResult } from "./xero-read";

const NOT_CONNECTED = "ServiceM8 isn't connected for this workspace.";
const UNAVAILABLE = "ServiceM8 couldn't be reached just now. Try again shortly.";
const REAUTH = "The ServiceM8 connection needs reconnecting.";

/** One live read of the account identity. Doubles as the health check: a
    connection revoked from ServiceM8's own side still has a row and
    unexpired-looking tokens here, and this is what notices — the 401 marks
    the row needs_reauth, so the next render says "reconnect". */
export async function readSm8Vendor(orgId: string): Promise<ReadResult<Sm8Vendor>> {
  if (!sm8Config()) return { ok: false, error: NOT_CONNECTED };

  const access = await sm8Access(orgId);
  if (!access) return { ok: false, error: NOT_CONNECTED };

  const result = await fetchSm8Vendor(access.accessToken);
  if (result.ok) return { ok: true, data: result.vendor };

  if (result.unauthorized) {
    await markSm8NeedsReauth(orgId, "ServiceM8 no longer accepts this connection. Reconnect ServiceM8.");
    return { ok: false, error: REAUTH };
  }
  return { ok: false, error: UNAVAILABLE };
}
