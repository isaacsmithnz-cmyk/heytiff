"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { markFieldNoteReviewed, removeFieldNote } from "@/app/actions/kb-review";
import type { FieldNoteRow } from "@/lib/tiff/field-notes";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";

/* The curation queue. Entries are ALREADY LIVE — the copy says so, because a
   queue that looks like an approval gate teaches admins the wrong model of
   what ignoring it does. Two verbs per row and nothing else: agree, or take
   it down. */

export function KbQueue({ entries }: { entries: FieldNoteRow[] }) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState<Set<string>>(new Set());

  const run = (id: string, fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) return setError(res.error ?? "That didn't work.");
      setGone((g) => new Set(g).add(id));
    });

  const waiting = entries.filter((e) => !gone.has(e.id));

  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg adm-stg">
          <div className="v2head" style={{ marginBottom: 24 }}>
            <div>
              <Link href="/dashboard/admin" className="int-back">
                <Icon name="chevL" size={15} />
                Admin
              </Link>
              <h1 style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.03em", margin: "10px 0 0" }}>
                Field-learned knowledge
              </h1>
              <p className="int-lede" style={{ margin: "6px 0 0" }}>
                These are live in the knowledge base now — spoken on the job, ticked by whoever
                said them. Agree, or take one down.
              </p>
            </div>
          </div>

          {error && <div className="int-note bad">{error}</div>}

          {waiting.length === 0 ? (
            <div className="ro-empty">
              <span className="ei">
                <Icon name="check" size={20} />
              </span>
              <b>Nothing waiting</b>
              <em>New entries the crew teaches Tiff will queue here for a look-over.</em>
            </div>
          ) : (
            <div className="adm-card">
              {waiting.map((e) => (
                <div className="wb2-kbqrow" key={e.id}>
                  <div className="wb2-kbqhead">
                    <b>{e.title}</b>
                    <span className="wb2-chip">
                      {e.authorName ?? "someone"} · {fmtAuWeekdayDayMonth(e.createdAt.slice(0, 10))}
                    </span>
                  </div>
                  {e.heading && <em className="wb2-capsaid">{e.heading}</em>}
                  <p className="wb2-kbqbody">{e.body}</p>
                  <div className="wb2-noteact">
                    <button
                      className="pbtn sm"
                      disabled={busy}
                      onClick={() => run(e.id, () => markFieldNoteReviewed(e.id))}
                    >
                      <Icon name="check" size={14} />
                      Looks right
                    </button>
                    <button
                      className="pbtn ghost sm"
                      disabled={busy}
                      title="Take it out of the knowledge base"
                      onClick={() => run(e.id, () => removeFieldNote(e.id))}
                    >
                      Take it down
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
