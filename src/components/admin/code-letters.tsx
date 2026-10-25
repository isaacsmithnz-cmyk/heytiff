"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/parts/button";
import { Fade } from "@/components/parts/fade";
import { Tick } from "@/components/parts/tick";
import { uprightFile } from "@/lib/images/upright";
import { MAX_INVOICE_BYTES } from "@/lib/quotes/invoice-read";
import { ruleWords, type KeptRule, type LettersRead } from "@/lib/quotes/code-letters";
import { withCleanup } from "@/lib/ui/with-cleanup";
import { FileButton, Oops, Said } from "./pb-bits";

/* A SUPPLIER'S CODE LETTERS, in its dialog on Price book › Suppliers
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
    <section aria-label="What the letters in its codes mean">
      <h3 className="st2-pb-sub">What the letters in its codes mean</h3>
      {note && (note.tone === "ok" ? <Said>{note.text}</Said> : <Oops>{note.text}</Oops>)}
      {rules.length > 0 && (
        <ul className="st2-pb-rows" aria-label={`${supplierName} code letters`}>
          {rules.map((r) => (
            <li key={r.id} className="st2-pb-grid st2-pb-lines">
              <span className="st2-pb-name">
                <span>{`${ruleWords(r)}: ${r.meaning}`}</span>
                <span className="st2-pb-line">
                  <Fade>{`${r.example.with} has it, ${r.example.without} doesn't${r.source ? `; from ${r.source}` : ""}`}</Fade>
                </span>
              </span>
              <Button kind="second" size={32} disabled={busy !== null} aria-label={`Take out ${ruleWords(r)}`} onClick={() => void takeOut(r)}>
                Take it out
              </Button>
            </li>
          ))}
        </ul>
      )}
      {reading ? (
        <>
          <h3 className="st2-pb-sub">{reading.read.maker ? `${reading.fileName}, from ${reading.read.maker}` : reading.fileName}</h3>
          {reading.read.rules.length === 0 ? (
            <p className="st2-pb-said">No letters explained in it.</p>
          ) : (
            <div className="st2-pb-ledgerwrap">
              <table className="st2-pb-ledger">
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
                        <Tick
                          label={<span className="sr-only">{`Keep ${ruleWords(r)}`}</span>}
                          checked={!off.has(i)}
                          disabled={busy !== null}
                          onChange={() => toggle(i)}
                        />
                      </td>
                      <td className="st2-pb-code">{ruleWords(r)}</td>
                      <td>{r.meaning}</td>
                      <td>{`${r.example.with}, without it ${r.example.without}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {reading.read.skipped.length > 0 && <p className="st2-pb-said">{`Not taken: ${reading.read.skipped.map((s) => `${s.said}, ${s.why}`).join("; ")}.`}</p>}
          <div className="st2-pb-foot">
            <Button kind="second" size={36} disabled={busy !== null} onClick={() => setReading(null)}>
              Cancel
            </Button>
            {reading.read.rules.length > 0 && (
              <Button kind="second" size={36} disabled={busy !== null || ticked === 0} onClick={() => void keep()}>
                {busy === "keep" ? "Keeping the rules" : `Keep ${rulesWord(ticked)}`}
              </Button>
            )}
          </div>
        </>
      ) : (
        <div className="st2-pb-acts">
          <FileButton
            words={busy === "read" ? "Reading the document" : "Read code letters"}
            label={`Read ${supplierName}'s code letters from a document`}
            accept=".pdf,application/pdf,.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            disabled={busy !== null}
            onFile={(f) => void read(f)}
          />
        </div>
      )}
    </section>
  );
}
