"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { fmtAud } from "@/lib/workboard/project-money";
import type { CompareColumn, CompareView } from "@/lib/quotes/compare-server";

/* COMPARE ON A UNIT LINE (slice 10.2, the mock-up of 8 October): the unit on
   the quote, shaded, beside the book's units of its type and size, each
   with its outdoor; what each sells for and the difference, what it is off
   the maker's data pack, how it was paired, and Use on option N. The box
   at its foot takes what to compare it with in the person's own words: a
   model, or a brand and a size, is found in the book at once; anything
   needing judgement goes to Tiff, and her pick appears here when she's
   added it. */

const ROUTE = "/api/workboard/quote-compare";
/** How often the card looks for Tiff's pick, ms, and for how long. */
const WAIT_MS = 3000;
const WAIT_FOR_MS = 120_000;

const money = (c: number | null) => (c == null ? "–" : fmtAud(c));
const diff = (c: number | null) => (c == null ? "" : c === 0 ? "Same" : `${c > 0 ? "+" : "−"}${fmtAud(Math.abs(c))}`);

export function CompareCard({ job, lineId, onClose, onChanged }: { job: string; lineId: string; onClose: () => void; onChanged: () => void }) {
  const [view, setView] = useState<CompareView | null>(null);
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [waitingSince, setWaitingSince] = useState<number | null>(null);

  const read = async () => {
    const r = await fetch(`${ROUTE}?job=${encodeURIComponent(job)}&line=${encodeURIComponent(lineId)}`).catch(() => null);
    const v = r ? ((await r.json().catch(() => null)) as CompareView | null) : null;
    setView(v ?? { ok: false, reason: "The compare couldn't be read. Try again." });
    return v;
  };
  useEffect(() => {
    let live = true;
    fetch(`${ROUTE}?job=${encodeURIComponent(job)}&line=${encodeURIComponent(lineId)}`)
      .then((r) => r.json() as Promise<CompareView>)
      .then((v) => live && setView(v))
      .catch(() => live && setView({ ok: false, reason: "The compare couldn't be read. Try again." }));
    return () => {
      live = false;
    };
  }, [job, lineId]);

  /* Tiff's pick, looked for until it lands or the wait is up */
  const look = useEffectEvent(async () => {
    const before = view?.ok ? view.columns.length : 0;
    const v = await read();
    if ((v?.ok && v.columns.length > before) || (waitingSince != null && Date.now() - waitingSince > WAIT_FOR_MS)) setWaitingSince(null);
  });
  useEffect(() => {
    if (waitingSince == null) return;
    const t = setInterval(() => void look(), WAIT_MS);
    return () => clearInterval(t);
  }, [waitingSince]);

  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    setNote(null);
    const r = await fetch(ROUTE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job, line: lineId, ...body }) }).catch(() => null);
    const a = r ? ((await r.json().catch(() => null)) as { ok: boolean; reason?: string; toTiff?: boolean } | null) : null;
    setBusy(false);
    return a ?? { ok: false, reason: "That didn't go through. Try again." };
  };

  const compare = async () => {
    const a = await post({ ask });
    if (!a.ok) return setNote(a.reason ?? "That didn't go through. Try again.");
    setAsk("");
    if (a.toTiff) {
      setNote("Tiff is picking from your book: it shows here when she's added it.");
      setWaitingSince(Date.now());
    }
    void read();
  };

  const put = async (c: CompareColumn) => {
    const a = await post({ use: c.indoor.code });
    if (!a.ok) return setNote(a.reason ?? "That didn't go through. Try again.");
    onChanged();
    void read();
  };

  if (!view) return null;
  if (!view.ok)
    return (
      <section className="ql-cmpw" aria-label="Compare">
        <p className="wb2-sherr">{view.reason}</p>
        <div className="ql-ask">
          <button type="button" className="pbtn ghost sm" onClick={onClose}>
            Close
          </button>
        </div>
      </section>
    );

  const cols = view.columns;
  const row = (label: string, cell: (c: CompareColumn) => string | null) => (
    <tr>
      <td>{label}</td>
      {cols.map((c, i) => {
        const v = cell(c);
        const cls = [c.current ? "on" : "", v == null ? "np" : ""].filter(Boolean).join(" ");
        return (
          <td key={i} className={cls === "" ? undefined : cls}>
            {v ?? "No data pack"}
          </td>
        );
      })}
    </tr>
  );
  const n = view.line.option + 1;

  return (
    <section className="ql-cmpw" aria-label="Compare">
      <div className="ql-cmpw-h">
        <b>{`${view.line.system || "This unit"} on option ${n}, side by side`}</b>
      </div>
      <div className="ql-cmpx">
        <table className="ql-cmp">
          <thead>
            <tr>
              <th />
              {cols.map((c, i) => (
                <th key={i} className={c.current ? "on" : undefined}>
                  {c.indoor.name}
                  <small>{[c.indoor.code, c.outdoor?.code].filter(Boolean).join(", ")}</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {row("Units, sell", (c) => money(c.sellCents))}
            {row("Difference", (c) => diff(c.diffCents))}
            {row("Cooling", (c) => c.cooling)}
            {row("Indoor", (c) => c.indoorSpec)}
            {row("Outdoor", (c) => (c.outdoor ? c.outdoorSpec : "None in your book"))}
            {row("Pipe", (c) => c.pipe)}
            {row("Paired by", (c) => c.pairedBy)}
            <tr>
              <td />
              {cols.map((c, i) => (
                <td key={i} className={c.current ? "on" : undefined}>
                  {c.current ? (
                    <span className="ql-chosen">{`On option ${n}`}</span>
                  ) : (
                    <button type="button" className="pbtn ghost sm" disabled={busy} onClick={() => void put(c)}>
                      {`Use on option ${n}`}
                    </button>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {note && <p className="ql-cmpnote">{note}</p>}
      <div className="ql-ask">
        <input
          className="wb2-fi"
          value={ask}
          placeholder="What to compare it with"
          aria-label="What to compare it with"
          onChange={(e) => setAsk(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && ask.trim()) void compare();
          }}
        />
        <button type="button" className="pbtn primary sm" disabled={busy || !ask.trim()} onClick={() => void compare()}>
          Compare
        </button>
        <button type="button" className="pbtn ghost sm" onClick={onClose}>
          Close
        </button>
      </div>
    </section>
  );
}
