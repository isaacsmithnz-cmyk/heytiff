"use client";

import { useState } from "react";
import { fileOldCodeNotes, readOldCodeNotes } from "@/app/actions/site-notes";
import { Button } from "@/components/parts/button";
import { TextArea } from "@/components/parts/field";
import { Tray } from "@/components/parts/tabs";
import { Tick } from "@/components/parts/tick";
import { unitWords } from "@/lib/sites/site-key";
import { SITE_NOTE_MAX, type OldCodeNote } from "@/lib/sites/site-notes";
import { jobPageHref } from "@/lib/shell/links";
import "./site-notes.css";

/* OLD NOTES WITH CODES, A LIST TO TICK (Isaac, 14 November 2026, call 15).

   One row a note (rule 39): the tick, the words to file in bold, the note as
   it was written when only part of it is filed, then its job, its address,
   who wrote it and when. A unit's job chooses the whole building or the unit.
   Change words opens them to edit before filing. Nothing is filed until it's
   ticked and File ticked notes is pressed; each lands as an Access note on
   its job's site, written by whoever wrote the old note, on its day. */

type Pick = { words: string; whole: boolean; ticked: boolean; editing: boolean };

const DIDNT_FILE = { filed: 0, error: "Those didn't file. Try again." };

export function OldCodeNotes({ initial }: { initial: OldCodeNote[] }) {
  const [notes, setNotes] = useState(initial);
  const [picks, setPicks] = useState<Record<string, Pick>>(() =>
    Object.fromEntries(initial.map((n) => [n.uuid, { words: n.words, whole: true, ticked: false, editing: false }])),
  );
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = (uuid: string, change: Partial<Pick>) => setPicks((p) => ({ ...p, [uuid]: { ...p[uuid]!, ...change } }));
  const ticked = notes.filter((n) => picks[n.uuid]?.ticked);

  const file = async () => {
    if (ticked.length === 0) return;
    setBusy(true);
    setError(null);
    setSaid(null);
    const done = await fileOldCodeNotes(ticked.map((n) => ({ uuid: n.uuid, words: picks[n.uuid]!.words, whole: picks[n.uuid]!.whole }))).catch(() => DIDNT_FILE);
    const fresh = done.filed > 0 ? await readOldCodeNotes().catch(() => null) : null;
    if (fresh) {
      setNotes(fresh);
      setPicks((p) => Object.fromEntries(fresh.map((n) => [n.uuid, p[n.uuid] && !p[n.uuid]!.ticked ? p[n.uuid]! : { words: n.words, whole: true, ticked: false, editing: false }])));
    }
    if (done.filed > 0) setSaid(done.filed === 1 ? "1 note filed as an Access note on its site" : `${done.filed} notes filed as Access notes on their sites`);
    setError(done.error);
    setBusy(false);
  };

  return (
    <div className="stn-old">
      <header className="stn-oldhead">
        <div className="stn-words">
          <h1>Old notes with codes</h1>
          <p className="stn-quiet">
            {notes.length === 1 ? "1 ServiceM8 job note names" : `${notes.length} ServiceM8 job notes name`} a lockbox, gate, key or code
          </p>
        </div>
        <Button kind="main" size={36} onClick={() => void file()} disabled={busy || ticked.length === 0} aria-busy={busy || undefined}>
          {ticked.length === 1 ? "File 1 ticked note" : `File ${ticked.length} ticked notes`}
        </Button>
      </header>
      {said && <p className="stn-said">{said}</p>}
      {error && <p className="stn-err">{error}</p>}
      {notes.length === 0 ? (
        <p className="stn-quiet">Every old note with a code is filed.</p>
      ) : (
        <ul className="stn-rows stn-oldrows">
          {notes.map((n) => {
            const p = picks[n.uuid]!;
            const part = p.words.trim() !== n.note.trim();
            return (
              <li key={n.uuid} className="stn-row stn-oldrow">
                <Tick
                  label={<span className="stn-sr">File this note</span>}
                  checked={p.ticked}
                  onChange={(on) => set(n.uuid, { ticked: on })}
                  disabled={busy}
                />
                <div className="stn-words stn-oldwords">
                  {p.editing ? (
                    <TextArea
                      aria-label="Words to file"
                      className="stn-area"
                      rows={2}
                      maxLength={SITE_NOTE_MAX}
                      value={p.words}
                      onChange={(e) => set(n.uuid, { words: e.target.value })}
                      disabled={busy}
                    />
                  ) : (
                    <p className="stn-name stn-keep">{p.words}</p>
                  )}
                  {part && <p className="stn-more">{n.note}</p>}
                  <p className="stn-meta">
                    Job {n.job.number ?? ""} at {n.job.address}. {[n.by, n.when].filter(Boolean).join(", ")}
                  </p>
                </div>
                <div className="stn-doors">
                  {n.unit && (
                    <Tray
                      ariaLabel="For"
                      value={p.whole ? "building" : "unit"}
                      onChange={(v) => set(n.uuid, { whole: v === "building" })}
                      options={[
                        { value: "building", label: "Whole building" },
                        { value: "unit", label: unitWords(n.unit) },
                      ]}
                      disabled={busy}
                    />
                  )}
                  <Button kind="quiet" size={32} onClick={() => set(n.uuid, { editing: !p.editing })} disabled={busy}>
                    {p.editing ? "Keep words" : "Change words"}
                  </Button>
                  <Button kind="quiet" size={32} href={jobPageHref(n.job.uuid)}>
                    Open job
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
