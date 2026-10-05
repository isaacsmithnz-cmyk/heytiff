"use client";

import { useEffect, useState } from "react";
import { uprightFile } from "@/lib/images/upright";
import { MAX_INVOICE_BYTES } from "@/lib/quotes/invoice-read";
import { ruleWords, type KeptRule, type LettersRead } from "@/lib/quotes/code-letters";
import { withCleanup } from "@/lib/ui/with-cleanup";

/* A SUPPLIER'S CODE LETTERS, in its open row on Price book → Suppliers
   (Isaac, 2026-10-05: the Mitsubishi letters were read by hand, "not in the
   app upload").

   A maker's brochure or trade price book, a PDF or a photo of its legend,
   read by Tiff for the letters it explains in its model codes; each one
   shown with the document's own example, ticked; Keep puts the ticked ones
   in. From then on a unit priced through a code with the letter says what
   it means. What's kept can be taken out. */

const ROUTE = "/api/quoting/code-letters";

type ReadAnswer = { ok: true; read: LettersRead } | { ok: false; reason: string };
type RulesAnswer = { ok: true; rules: KeptRule[] } | { ok: false; reason: string };

const refusal = (a: { reason: string }) => a.reason;
/** The kept rules in an answer, when it holds them. */
const keptIn = (a: unknown): KeptRule[] | null => {
  const rules = a && typeof a === "object" ? (a as { ok?: unknown; rules?: unknown }).rules : null;
  return Array.isArray(rules) ? (rules as KeptRule[]) : null;
};
const rulesWord = (n: number) => `${n} rule${n === 1 ? "" : "s"}`;

export function CodeLetters({ supplierKey, supplierName }: { supplierKey: string; supplierName: string }) {
  const [rules, setRules] = useState<KeptRule[]>([]);
  const [reading, setReading] = useState<{ fileName: string; read: LettersRead } | null>(null);
  const [off, setOff] = useState<Set<number>>(() => new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => fetch(`${ROUTE}?supplier=${encodeURIComponent(supplierKey)}`))
      .then((r) => r.json() as Promise<unknown>)
      .then((a) => {
        const kept = keptIn(a);
        if (live && kept) setRules(kept);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [supplierKey]);

  const read = async (file: File) => {
    setBusy("read");
    setNote(null);
    setReading(null);
    await withCleanup(async () => {
      try {
        const sending = await uprightFile(file);
        if (sending.size > MAX_INVOICE_BYTES) {
          setNote({ tone: "bad", text: "That file is over 4 MB." });
          return;
        }
        const form = new FormData();
        form.set("supplier", supplierKey);
        form.set("file", sending);
        const a = (await (await fetch(ROUTE, { method: "POST", body: form })).json()) as ReadAnswer;
        if (!a.ok) {
          setNote({ tone: "bad", text: refusal(a) });
          return;
        }
        setOff(new Set());
        setReading({ fileName: file.name, read: a.read });
      } catch {
        setNote({ tone: "bad", text: "The document couldn't be sent. Try again." });
      }
    }, () => setBusy(null));
  };

  const keep = async () => {
    if (!reading) return;
    const ticked = reading.read.rules.filter((_, i) => !off.has(i));
    const body = JSON.stringify({ supplier: supplierKey, source: reading.fileName, rules: ticked });
    const done = `${supplierName}: ${rulesWord(ticked.length)} kept.`;
    setBusy("keep");
    setNote(null);
    await withCleanup(async () => {
      try {
        const a = (await (await fetch(ROUTE, { method: "PATCH", headers: { "content-type": "application/json" }, body })).json()) as RulesAnswer;
        if (!a.ok) {
          setNote({ tone: "bad", text: refusal(a) });
          return;
        }
        setRules(a.rules);
        setReading(null);
        setNote({ tone: "ok", text: done });
      } catch {
        setNote({ tone: "bad", text: "Those rules couldn't be sent. Try again." });
      }
    }, () => setBusy(null));
  };

  const takeOut = async (rule: KeptRule) => {
    setBusy(rule.id);
    setNote(null);
    await withCleanup(async () => {
      try {
        const a = (await (await fetch(`${ROUTE}?id=${rule.id}`, { method: "DELETE" })).json()) as { ok: boolean };
        if (a.ok) setRules((rs) => rs.filter((r) => r.id !== rule.id));
      } catch {
        setNote({ tone: "bad", text: "That rule couldn't be taken out. Try again." });
      }
    }, () => setBusy(null));
  };

  const toggle = (i: number) =>
    setOff((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const ticked = reading ? reading.read.rules.length - off.size : 0;
  return (
    <div className="pbl">
      <h3 className="qs-h">What the letters in its codes mean</h3>
      {note && <div className={`int-note ${note.tone}`}>{note.text}</div>}
      {rules.length > 0 && (
        <ul className="qs-list" aria-label={`${supplierName} code letters`}>
          {rules.map((r) => (
            <li key={r.id} className="pbl-rule">
              <span className="qs-item">
                {`${ruleWords(r)}: ${r.meaning}`}
                <em>{`${r.example.with} has it, ${r.example.without} doesn't${r.source ? `; from ${r.source}` : ""}`}</em>
              </span>
              <button type="button" className="pbtn ghost sm" disabled={busy !== null} onClick={() => void takeOut(r)}>
                Take out
              </button>
            </li>
          ))}
        </ul>
      )}
      {reading ? (
        <div className="qs-match pbi-review">
          <h3 className="qs-h">{reading.read.maker ? `${reading.fileName}, from ${reading.read.maker}` : reading.fileName}</h3>
          {reading.read.rules.length === 0 ? (
            <p className="qs-sub">No letters explained in it.</p>
          ) : (
            <div className="pbi-wrap">
              <table className="pbi">
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="sr-only">Keep</span>
                    </th>
                    <th scope="col">Letter</th>
                    <th scope="col">Means</th>
                    <th scope="col">The document&apos;s example</th>
                  </tr>
                </thead>
                <tbody>
                  {reading.read.rules.map((r, i) => (
                    <tr key={`${r.family}|${r.letter}|${r.example.with}`}>
                      <td>
                        <input type="checkbox" checked={!off.has(i)} disabled={busy !== null} onChange={() => toggle(i)} aria-label={`Keep ${ruleWords(r)}`} />
                      </td>
                      <td className="pbi-code">{ruleWords(r)}</td>
                      <td>{r.meaning}</td>
                      <td>{`${r.example.with}, without it ${r.example.without}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {reading.read.skipped.length > 0 && <p className="qs-sub">{`Not taken: ${reading.read.skipped.map((s) => `${s.said}, ${s.why}`).join("; ")}.`}</p>}
          <div className="wb2-jqacts">
            <button type="button" className="pbtn ghost" disabled={busy !== null} onClick={() => setReading(null)}>
              Cancel
            </button>
            {reading.read.rules.length > 0 && (
              <button type="button" className="pbtn primary" disabled={busy !== null || ticked === 0} onClick={() => void keep()}>
                {busy === "keep" ? "Keeping" : `Keep ${rulesWord(ticked)}`}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="pbs-acts">
          <label className="pbtn ghost sm qs-upload" aria-disabled={busy !== null}>
            {busy === "read" ? "Reading the document" : "Read code letters"}
            <input
              type="file"
              className="qs-file"
              aria-label={`Read ${supplierName}'s code letters from a document`}
              accept=".pdf,application/pdf,.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
              disabled={busy !== null}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void read(f);
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}
