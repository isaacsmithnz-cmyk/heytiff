"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { realtimeTicket, type RealtimeTicket } from "@/app/actions/realtime";
import type { RecordRef } from "@/lib/records/ref";

/* WHO ELSE HAS THIS RECORD OPEN, and word when they change it.

   Each record has its own private Realtime channel, `record:<org>:<kind>:
   <id>`, that only its own workspace may hear or speak on (the policy in
   docs/migrations/realtime_records.sql reads the ticket the server signs,
   app/actions/realtime). A card that joins it says who it is (presence),
   hears who else is there, and hears "changed" when one of them writes to
   it, so the diary can read itself again instead of waiting for a reload.

   OFF UNTIL THE DEPLOYMENT TURNS IT ON (`NEXT_PUBLIC_LIVE_RECORDS=1`, after
   the migration): until then this asks for nothing and says nobody else is
   here. One socket for the page, opened when the first card joins. */

export type Present = { id: string; name: string };

/* Read where it is asked, not when the module loads: Next writes the value
   in at build either way, and a test can say which. */
const live = () => process.env.NEXT_PUBLIC_LIVE_RECORDS === "1";
const NOBODY: readonly Present[] = [];

/** The ticket, asked for once and again when it is close to running out. */
let ticket: Promise<RealtimeTicket | null> | null = null;
let ticketEnds = 0;
function currentTicket(): Promise<RealtimeTicket | null> {
  if (!ticket || Date.now() > ticketEnds - 5 * 60_000) {
    ticket = realtimeTicket()
      .then((t) => {
        ticketEnds = t?.expiresAt ?? 0;
        return t;
      })
      .catch(() => {
        ticket = null;
        return null;
      });
  }
  return ticket;
}

/** Drop the ticket, so the next card asks for a fresh one: switching
    workspace calls it, so one workspace's ticket never opens another's. */
export function forgetLiveTicket() {
  ticket = null;
  ticketEnds = 0;
}

/** The page's one client, with the ticket as its token. */
let client: Promise<SupabaseClient> | null = null;
function liveClient(): Promise<SupabaseClient> {
  client ??= import("@supabase/supabase-js").then(({ createClient }) =>
    createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      accessToken: async () => (await currentTicket())?.token ?? null,
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  );
  return client;
}

/** Who else is in a presence state: each person once, never me. */
export function othersIn(state: Record<string, readonly { id?: string; name?: string }[]>, me: string): Present[] {
  const out: Present[] = [];
  for (const [key, metas] of Object.entries(state)) {
    const meta = metas[0];
    if (key === me || !meta?.name) continue;
    out.push({ id: key, name: meta.name });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** "Dane has this open too", for the card's band. */
export function hereSaid(others: readonly Present[]): string | null {
  const names = others.map((o) => o.name);
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} has this open too`;
  if (names.length === 2) return `${names[0]} and ${names[1]} have this open too`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more have this open too`;
}

/** What was last heard on the record's channel, and how many times: a
    card reacts when the count moves. */
export type Heard = { what: string; n: number } | null;

export function useRecordPresence(ref: RecordRef | null): {
  others: readonly Present[];
  heard: Heard;
  announce: (what: string) => void;
} {
  const [others, setOthers] = useState<readonly Present[]>(NOBODY);
  const [heard, setHeard] = useState<Heard>(null);
  const channel = useRef<RealtimeChannel | null>(null);
  const kind = ref?.kind ?? null;
  const id = ref?.id ?? null;

  useEffect(() => {
    if (!live() || !kind || !id) return;
    let gone = false;
    let joined: { ch: RealtimeChannel; sb: SupabaseClient } | null = null;
    void (async () => {
      const t = await currentTicket();
      if (!t || gone) return;
      const sb = await liveClient();
      if (gone) return;
      await sb.realtime.setAuth(t.token);
      if (gone) return;
      const ch = sb.channel(`record:${t.orgId}:${kind}:${id}`, {
        config: { private: true, presence: { key: t.me.id }, broadcast: { self: false } },
      });
      ch.on("presence", { event: "sync" }, () => {
        if (!gone) setOthers(othersIn(ch.presenceState() as Record<string, { id?: string; name?: string }[]>, t.me.id));
      })
        .on("broadcast", { event: "changed" }, ({ payload }) => {
          const what = (payload as { what?: unknown } | undefined)?.what;
          if (typeof what === "string" && !gone) setHeard((h) => ({ what, n: (h?.n ?? 0) + 1 }));
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") void ch.track({ id: t.me.id, name: t.me.name });
        });
      joined = { ch, sb };
      channel.current = ch;
    })();
    return () => {
      gone = true;
      channel.current = null;
      setOthers(NOBODY);
      if (joined) {
        void joined.ch.untrack();
        void joined.sb.removeChannel(joined.ch);
      }
    };
  }, [kind, id]);

  const announce = useCallback((what: string) => {
    void channel.current?.send({ type: "broadcast", event: "changed", payload: { what } });
  }, []);

  return { others, heard, announce };
}
