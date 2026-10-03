"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { resetTemplate, saveTemplate, type TemplateResult } from "@/app/actions/templates";
import { PAYMENT_PRESET_KEYS, type PaymentPreset } from "@/lib/quotes/payment";
import {
  EMAIL_FILLS,
  MAX_HEADING,
  MAX_LINE,
  MAX_MESSAGE,
  MAX_NOTES,
  MAX_SUBJECT,
  noteKeyFor,
  templateProblems,
  type DocumentsEmail,
  type PaymentTerms,
  type QuoteNote,
  type TemplateSetting,
} from "@/lib/templates/settings";
import type { ChecklistSeed } from "@/lib/workboard/stages";

/* THE BUSINESS'S OWN TEMPLATES, CHANGED WHERE THEY ARE READ — each editor
   sits beside its document on the template's page. Save sends the whole
   template; the server reads it back through the same normaliser every
   quote, project and email reads it with, and the page redraws from what
   was stored. "Back to the standard wording" deletes the business's copy.

   Only the owner sees the editors; everyone else reads the same panel as
   words. Plain functions sit outside the components: React Compiler 1.0
   can't lower a computed key or a counter on a captured variable. */

const FAILED: TemplateResult = { ok: false, error: "Couldn't save it. Try again." };

/** Save and reset for one template, and the line that says how it went. */
function useTemplate(key: TemplateSetting) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const done = (res: TemplateResult, word: string) => {
    setBusy(false);
    if (!res.ok) return setNote({ text: res.error, bad: true });
    setNote({ text: word, bad: false });
    router.refresh();
  };
  const save = (value: unknown) => {
    const problems = templateProblems(key, value);
    if (problems.length > 0) return setNote({ text: problems[0], bad: true });
    setBusy(true);
    setNote(null);
    void saveTemplate(key, value)
      .catch(() => FAILED)
      .then((res) => done(res, "Saved."));
  };
  const reset = () => {
    setBusy(true);
    setNote(null);
    void resetTemplate(key)
      .catch(() => FAILED)
      .then((res) => done(res, "Back to the standard wording."));
  };
  return { busy, note, save, reset, setNote };
}

function Foot({
  busy,
  note,
  dirty,
  changed,
  onSave,
  onReset,
}: {
  busy: boolean;
  note: { text: string; bad: boolean } | null;
  dirty: boolean;
  changed: boolean;
  onSave: () => void;
  onReset: () => void;
}) {
  return (
    <>
      {note && <p className={note.bad ? "sw-state bad" : "tpl-quiet"}>{note.text}</p>}
      <div className="tpl-acts">
        <button type="button" className="pbtn" disabled={busy || !dirty} onClick={onSave}>
          Save
        </button>
        {changed && (
          <button type="button" className="pbtn ghost" disabled={busy} onClick={onReset}>
            Back to the standard wording
          </button>
        )}
      </div>
    </>
  );
}

/* ── the quote's notes ─────────────────────────────────────────────────── */

const linesOf = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

const swap = <T,>(xs: readonly T[], i: number, next: T): T[] => xs.map((x, j) => (j === i ? next : x));

export function QuoteNotesEditor({ notes, changed }: { notes: QuoteNote[]; changed: boolean }) {
  const t = useTemplate("quote_notes");
  const [list, setList] = useState(notes);
  const [open, setOpen] = useState<number | null>(null);
  const dirty = JSON.stringify(list) !== JSON.stringify(notes);

  const add = () => {
    const key = noteKeyFor("note", list.map((n) => n.key));
    setList([...list, { key, heading: "", lines: [], always: false }]);
    setOpen(list.length);
  };

  return (
    <div className="tpl-card">
      <h2>Notes</h2>
      <p className="tpl-quiet">Tiff adds the ones a job needs. A ticked note goes on every quote.</p>
      <div className="tpl-rows">
        {list.map((n, i) =>
          open === i ? (
            <div key={n.key} className="tpl-edit">
              <label className="tpl-field">
                Heading
                <input className="wb2-fi" value={n.heading} maxLength={MAX_HEADING} onChange={(e) => setList(swap(list, i, { ...n, heading: e.target.value }))} />
              </label>
              <label className="tpl-field">
                The words, a line each
                <textarea
                  className="wb2-fi"
                  rows={4}
                  value={n.lines.join("\n")}
                  maxLength={MAX_LINE * 6}
                  onChange={(e) => setList(swap(list, i, { ...n, lines: e.target.value.split("\n") }))}
                />
              </label>
              <div className="tpl-acts">
                <button type="button" className="pbtn ghost sm" onClick={() => {
                    setList(swap(list, i, { ...n, lines: linesOf(n.lines.join("\n")) }));
                    setOpen(null);
                  }}>
                  Done
                </button>
                <button type="button" className="pbtn ghost sm" onClick={() => {
                    setList(list.filter((_, j) => j !== i));
                    setOpen(null);
                  }}>
                  {`Remove ${n.heading || "this note"}`}
                </button>
              </div>
            </div>
          ) : (
            <div key={n.key} className="tpl-row">
              <input
                type="checkbox"
                aria-label={`${n.heading} on every quote`}
                checked={n.always}
                onChange={(e) => setList(swap(list, i, { ...n, always: e.target.checked }))}
              />
              <span>
                <b>{n.heading || "New note"}</b>
                <em>{n.lines.join(" ")}</em>
              </span>
              <button type="button" className="tpl-link" onClick={() => setOpen(i)} aria-label={`Edit ${n.heading}`}>
                Edit
              </button>
            </div>
          )
        )}
      </div>
      {list.length < MAX_NOTES && (
        <button type="button" className="pbtn ghost sm tpl-start" onClick={add}>
          Add a note
        </button>
      )}
      <Foot
        busy={t.busy}
        note={t.note}
        dirty={dirty}
        changed={changed}
        onSave={() => t.save(list.map((n) => ({ ...n, lines: linesOf(n.lines.join("\n")) })))}
        onReset={t.reset}
      />
    </div>
  );
}

/* ── the payment terms ─────────────────────────────────────────────────── */

const withStages = (terms: PaymentTerms, k: PaymentPreset, stages: PaymentTerms[PaymentPreset]["stages"]): PaymentTerms => ({
  ...terms,
  ...Object.fromEntries([[k, { ...terms[k], stages }]]),
});

export function PaymentTermsEditor({ terms, changed }: { terms: PaymentTerms; changed: boolean }) {
  const t = useTemplate("payment_terms");
  const [all, setAll] = useState(terms);
  const [k, setK] = useState<PaymentPreset>("domestic_small");
  const stages = all[k].stages;
  const set = (next: typeof stages) => setAll(withStages(all, k, next));
  const dirty = JSON.stringify(all) !== JSON.stringify(terms);

  return (
    <div className="tpl-card">
      <h2>Payment terms</h2>
      <div className="wb2-jqseg" role="radiogroup" aria-label="Which kind of job">
        {PAYMENT_PRESET_KEYS.map((p) => (
          <button key={p} type="button" role="radio" aria-checked={k === p} className={k === p ? "on" : undefined} onClick={() => setK(p)}>
            {all[p].label}
          </button>
        ))}
      </div>
      <div className="tpl-rows">
        {stages.map((s, i) => (
          <div key={i} className="tpl-row">
            <input
              className="wb2-fi"
              aria-label={`Stage ${i + 1}`}
              value={s.when}
              maxLength={MAX_HEADING}
              onChange={(e) => set(swap(stages, i, { ...s, when: e.target.value }))}
            />
            {k !== "commercial" && (
              <input
                className="wb2-fi tpl-pct"
                inputMode="numeric"
                aria-label={`Stage ${i + 1} percent`}
                value={s.percent === null ? "" : String(s.percent)}
                onChange={(e) => set(swap(stages, i, { ...s, percent: e.target.value.trim() === "" ? null : Number(e.target.value.replace(/[^0-9]/g, "")) }))}
              />
            )}
            <button type="button" className="tpl-link" aria-label={`Remove stage ${i + 1}`} onClick={() => set(stages.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        ))}
      </div>
      {stages.length < 8 && (
        <button type="button" className="pbtn ghost sm tpl-start" onClick={() => set([...stages, { when: "", percent: k === "commercial" ? null : 0 }])}>
          Add a stage
        </button>
      )}
      <p className="tpl-quiet">A home job&apos;s stages add up to 100%, with a deposit of no more than 10%.</p>
      <Foot busy={t.busy} note={t.note} dirty={dirty} changed={changed} onSave={() => t.save(all)} onReset={t.reset} />
    </div>
  );
}

/* ── the project checklist (and its Handover section) ──────────────────── */

const sectionsOf = (items: readonly ChecklistSeed[]) => [...new Set(items.map((i) => i.section))];

export function ChecklistEditor({ items, changed, only }: { items: ChecklistSeed[]; changed: boolean; only?: string }) {
  const t = useTemplate("project_checklist");
  const [list, setList] = useState(items);
  const [adding, setAdding] = useState<Record<string, string>>({});
  const dirty = JSON.stringify(list) !== JSON.stringify(items);
  const sections = only ? [only] : sectionsOf(list);

  const addTo = (section: string) => {
    const label = (adding[section] ?? "").trim();
    if (!label) return;
    /* after the section's last item, so the order stays the stage order */
    const last = list.map((i) => i.section).lastIndexOf(section);
    const at = last === -1 ? list.length : last + 1;
    setList([...list.slice(0, at), { section, label }, ...list.slice(at)]);
    setAdding(Object.fromEntries([...Object.entries(adding).filter(([s]) => s !== section), [section, ""]]));
  };

  return (
    <div className="tpl-card">
      <h2>{only ? `${only} checks` : "The checklist"}</h2>
      <p className="tpl-quiet">
        {only
          ? "Every new project starts with these, and they print on the handover sheet. Each project's own list can still be changed on the project."
          : "Every new project starts with these. Each project's own list can still be changed on the project."}
      </p>
      {sections.map((section) => (
        <div key={section} className="tpl-rows">
          {!only && (
            <div className="tpl-row">
              <span>
                <b>{section}</b>
              </span>
            </div>
          )}
          {list.map((item, i) =>
            item.section === section ? (
              <div key={`${i}-${item.label}`} className="tpl-row">
                <span>{item.label}</span>
                <button type="button" className="tpl-link" aria-label={`Remove ${item.label}`} onClick={() => setList(list.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </div>
            ) : null
          )}
          <div className="tpl-row">
            <input
              className="wb2-fi"
              aria-label={`Add to ${section}`}
              placeholder="Add a check"
              maxLength={MAX_LINE}
              value={adding[section] ?? ""}
              onChange={(e) => setAdding(Object.fromEntries([...Object.entries(adding).filter(([s]) => s !== section), [section, e.target.value]]))}
              onKeyDown={(e) => {
                if (e.key === "Enter") addTo(section);
              }}
            />
            <button type="button" className="tpl-link" onClick={() => addTo(section)}>
              Add
            </button>
          </div>
        </div>
      ))}
      <Foot busy={t.busy} note={t.note} dirty={dirty} changed={changed} onSave={() => t.save(list)} onReset={t.reset} />
    </div>
  );
}

/* ── the documents email ───────────────────────────────────────────────── */

export function EmailEditor({ email, changed }: { email: DocumentsEmail; changed: boolean }) {
  const t = useTemplate("documents_email");
  const [subject, setSubject] = useState(email.subject);
  const [message, setMessage] = useState(email.message);
  const dirty = subject !== email.subject || message !== email.message;

  return (
    <div className="tpl-card">
      <h2>What it starts as</h2>
      <p className="tpl-quiet">Whoever sends it can still change it on the job card before it goes. Words in brackets are filled in from the job.</p>
      <label className="tpl-field">
        Subject
        <input className="wb2-fi" value={subject} maxLength={MAX_SUBJECT} onChange={(e) => setSubject(e.target.value)} />
      </label>
      <label className="tpl-field">
        Message
        <textarea className="wb2-fi" rows={8} value={message} maxLength={MAX_MESSAGE} onChange={(e) => setMessage(e.target.value)} />
      </label>
      <div className="tpl-fills">
        <span className="tpl-quiet">Add to the message:</span>
        {EMAIL_FILLS.map((f) => (
          <button key={f.token} type="button" className="pbtn ghost sm" onClick={() => setMessage(`${message}${message.endsWith("\n") || !message ? "" : " "}${f.token}`)}>
            {f.label}
          </button>
        ))}
      </div>
      <Foot busy={t.busy} note={t.note} dirty={dirty} changed={changed} onSave={() => t.save({ subject, message })} onReset={t.reset} />
    </div>
  );
}
