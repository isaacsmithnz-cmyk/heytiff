import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";

/* PUSH TO A PERSON'S PHONES, through Expo's push service
   (https://docs.expo.dev/push-notifications/sending-notifications/): one
   POST to https://exp.host/--/api/v2/push/send with up to 100 messages,
   each `{to, title, body, data, sound, channelId, priority}`; a ticket per
   message comes back in order, and one whose `details.error` is
   DeviceNotRegistered means that phone is gone, so its row is deleted.

   The phones are mobile_push_devices' (docs/migrations/mobile_push_devices
   .sql), registered by the app once it may notify. Android needs the app's
   Firebase keys before Expo will hand it a token, so until those exist no
   phone registers and this sends nothing.

   NEVER IN THE WAY: a send is best effort, capped in time, and any failure
   is logged and swallowed, so a task is given whether or not a phone hears
   about it. */

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const SEND_TIMEOUT_MS = 3000;
const BATCH = 100;

export type PushMessage = {
  title: string;
  body?: string | null;
  /** The phone screen it opens, e.g. "/job?id=…"; the list without one. */
  path?: string | null;
};

type Ticket = { status: "ok" | "error"; id?: string; message?: string; details?: { error?: string } };

/** The Auth0 subjects behind some staff cards, in one workspace. */
async function subjectsOf(orgId: string, staffIds: readonly string[]): Promise<string[]> {
  if (!staffIds.length) return [];
  const { data } = await supabaseAdmin.from("staff_profiles").select("user_id").eq("org_id", orgId).in("id", [...staffIds]);
  return ((data ?? []) as { user_id: string | null }[]).map((r) => r.user_id).filter((s): s is string => !!s);
}

/** Send to every phone these people are signed in on, in this workspace. Returns how many Expo took. */
export async function pushToStaff(orgId: string, staffIds: readonly string[], message: PushMessage, fetcher: typeof fetch = fetch): Promise<number> {
  try {
    const subs = await subjectsOf(orgId, [...new Set(staffIds)]);
    if (!subs.length) return 0;
    const { data } = await supabaseAdmin.from("mobile_push_devices").select("token").eq("org_id", orgId).in("user_sub", subs);
    const tokens = ((data ?? []) as { token: string }[]).map((r) => r.token);
    if (!tokens.length) return 0;

    let taken = 0;
    for (let i = 0; i < tokens.length; i += BATCH) {
      const batch = tokens.slice(i, i + BATCH);
      const res = await fetcher(EXPO_PUSH_URL, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(
          batch.map((to) => ({
            to,
            title: message.title,
            ...(message.body ? { body: message.body } : {}),
            data: { path: message.path ?? "/notifications" },
            sound: "default",
            channelId: "heytiff",
            priority: "high",
          })),
        ),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (!res.ok) {
        console.error(`[push] Expo answered ${res.status} for org ${orgId}`);
        continue;
      }
      const tickets = ((await res.json().catch(() => null)) as { data?: Ticket[] } | null)?.data ?? [];
      const gone = batch.filter((_, k) => tickets[k]?.status === "error" && tickets[k]?.details?.error === "DeviceNotRegistered");
      if (gone.length) await supabaseAdmin.from("mobile_push_devices").delete().in("token", gone);
      taken += tickets.filter((t) => t.status === "ok").length;
    }
    return taken;
  } catch (err) {
    console.error(`[push] couldn't push for org ${orgId}: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}
