"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { auDayOf, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { logWord, type Sm8WriteMode } from "@/lib/integrations/sm8-write-plan";
import type { RecentSm8Write } from "@/lib/integrations/sm8-writes";
import { setServiceM8WriteModeAction } from "@/app/actions/integrations";

/* SENDING FILES TO SERVICEM8 — the owner's switch for the first thing
   HeyTiff writes back, on the connection it governs.

   THREE SETTINGS, AND OFF IS WHERE EVERY BUSINESS STARTS. Trial run lets
   the office press Send to ServiceM8 on a job and see each send checked and
   listed here, with nothing reaching ServiceM8: the way to watch it work on
   a live account before it touches one. On asks ServiceM8 for the one
   permission it needs, at the next reconnect, and until that is given the
   card says so rather than pretending.

   THE LIST IS WHAT WAS DONE TO THEIR SERVICEM8, latest first, in the state's
   colour — including what didn't go and why. A write path whose owner
   can't see what it wrote is asking to be trusted. */

/** Null on a deployment that can't write (SM8_WRITES unset): the card isn't
    drawn at all there, because a setting that can't be set is a roadmap. */
export type Sm8WritesView = {
  mode: Sm8WriteMode;
  /** The grant carries the write permission. */
  granted: boolean;
  /** Files sent in the last 30 days; null when it couldn't be counted. */
  sentLately: number | null;
  recent: RecentSm8Write[];
};

const MODES: { id: Sm8WriteMode; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "trial", label: "Trial run" },
  { id: "live", label: "On" },
];

/** The setting as a sentence, with the one figure worth having. */
function modeLine(mode: Sm8WriteMode, sentLately: number | null): string {
  if (mode === "off") return "Off. Nothing HeyTiff does changes your ServiceM8.";
  if (mode === "trial") {
    return "Trial run. The office can press Send to ServiceM8 on a job, and each send is checked and listed here. Nothing reaches ServiceM8.";
  }
  const lately =
    sentLately && sentLately > 0 ? ` ${sentLately} in the last 30 days.` : "";
  return `On. Files sent from a job's Documents tab are added to the same job in ServiceM8.${lately}`;
}

/** "Job 2380, Isaac Smith, Wed 23 Sept" — an AU day, not a relative time, so
    the server and the browser write the same words (see MirrorCard). */
function facts(w: RecentSm8Write): string {
  const day = fmtAuWeekdayDayMonth(auDayOf(w.at));
  return [w.jobNumber ? `Job ${w.jobNumber}` : null, w.by, day].filter(Boolean).join(", ");
}

export function Sm8WritesCard({ view }: { view: Sm8WritesView }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const choose = (mode: Sm8WriteMode) => {
    if (mode === view.mode || busy) return;
    setError(null);
    start(async () => {
      const res = await setServiceM8WriteModeAction(mode);
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  };

  return (
    <div className="int-grp">
      <div className="c2h">
        <div style={{ minWidth: 0 }}>
          <b>Sending files to ServiceM8</b>
          <em>{modeLine(view.mode, view.sentLately)}</em>
        </div>
      </div>

      <div className="wb2-ckseg int-wmode" role="radiogroup" aria-label="Sending files to ServiceM8">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={view.mode === m.id}
            className={view.mode === m.id ? "on" : undefined}
            disabled={busy}
            onClick={() => choose(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      {error && <div className="int-note bad">{error}</div>}

      {view.mode === "live" && !view.granted && (
        <div className="int-consent">
          <Icon name="alert" size={15} />
          <p>
            ServiceM8 hasn&apos;t given HeyTiff permission to add files yet, so nothing can go. Reconnect
            ServiceM8 above and approve it on ServiceM8&apos;s screen.
          </p>
        </div>
      )}

      {view.recent.length > 0 && (
        <ul className="int-scopes int-writes">
          {view.recent.map((w) => {
            const word = logWord(w.status, w.attempts);
            return (
              <li key={w.id}>
                <div className="int-scopehead">
                  <b className="int-wname">{w.name}</b>
                  <span className={word.tone ? `int-tag ${word.tone}` : "int-tag"}>{word.word}</span>
                </div>
                <p>{w.error && w.status !== "sent" ? `${facts(w)}. ${w.error}` : facts(w)}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
