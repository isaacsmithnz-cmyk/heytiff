/* The one line the owner's ServiceM8 screen says about live updates from
   ServiceM8 (two-way phase 4, PR F) — pure.

   NOTHING WHILE THEY WORK (the spec's decision D2): sm8LiveUpdatesLine is
   null for `ok`, and for no health at all (the switch off, a reconcile
   still to have its go, a row that couldn't be read). Otherwise one
   sentence: what ServiceM8 did and what that means for the owner's
   changes. Only where a Reconnect is the fix — nothing subscribed, or one
   ServiceM8 turned off — does it say to press it (beside it on the
   connection card); a partial set or quiet pings are the nightly
   reconcile's to put right first. Records are named as the mirror's own
   list names them ("Job notes", "Schedule"), and a day as the overnight
   line writes one ("Sat 3 Oct").

   The syncs are untouched by live updates, so every line can say the one
   true thing that is still working: changes wait for the next sync. */

import { auDayOf, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { nameList } from "./outcome";
import { SM8_OBJECTS } from "./sm8-sync-plan";
import type { HookObjectName, Sm8HooksHealth } from "./sm8-hook-plan";

export const HOOK_WORDS = {
  none: "ServiceM8 isn't sending live updates, so changes wait for the next sync. Press Reconnect.",
  partial: "ServiceM8 isn't sending live updates for {list}, so those wait for the next sync.",
  deactivated: "ServiceM8 turned off live updates for {name} on {day}: {reason}. Press Reconnect.",
  deactivatedUndated: "ServiceM8 turned off live updates for {name}: {reason}. Press Reconnect.",
  quiet: "ServiceM8 hasn't sent a live update since {day}, so changes wait for the next sync.",
} as const;

/** The mirror's own name for a record kind, as the screen's list shows it. */
function labelOf(object: HookObjectName): string {
  return SM8_OBJECTS.find((s) => s.object === object)?.label ?? object;
}

/** ServiceM8's failure time: UTC ("Webhooks are different, as they use UTC
    timestamps", docs/webhooks-overview), written with or without a zone. */
function dayOfFailure(at: string | null): string {
  if (at === null) return "";
  const naive = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(at);
  const ms = Date.parse(naive ? `${at.replace(" ", "T")}Z` : at);
  return Number.isFinite(ms) ? fmtAuWeekdayDayMonth(auDayOf(new Date(ms))) : "";
}

function fill(words: string, values: Record<string, string>): string {
  return words.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m);
}

/** The line, or null for nothing. */
export function sm8LiveUpdatesLine(health: Sm8HooksHealth | null): string | null {
  if (health === null) return null;
  switch (health.state) {
    case "ok":
      return null;
    case "none":
      return HOOK_WORDS.none;
    case "partial": {
      const named = [...new Set([...health.missing, ...health.errors])];
      if (named.length === 0) return HOOK_WORDS.none;
      /* in the mirror's own order, as its list is */
      const ordered = SM8_OBJECTS.filter((s) => (named as string[]).includes(s.object)).map((s) => s.label);
      return fill(HOOK_WORDS.partial, { list: nameList(ordered) });
    }
    case "deactivated": {
      /* ServiceM8's own words, without a full stop of their own */
      const reason = health.reason.trim().replace(/[\s.]+$/, "");
      const day = dayOfFailure(health.at);
      return fill(day ? HOOK_WORDS.deactivated : HOOK_WORDS.deactivatedUndated, { name: labelOf(health.object), day, reason });
    }
    case "quiet":
      return fill(HOOK_WORDS.quiet, { day: fmtAuWeekdayDayMonth(auDayOf(new Date(health.since))) });
  }
}
