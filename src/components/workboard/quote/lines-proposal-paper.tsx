"use client";

import { useState, type ReactNode } from "react";
import { Letterhead } from "@/components/org/letterhead";
import { useOrgBrand } from "@/components/studio/summary/use-org-brand";
import { capacityOf } from "@/lib/quotes/brands";
import { againstFirst, type QuoteLine } from "@/lib/quotes/lines";
import { areasOf, areasText, listOf, listText, proposalOf, stageAmounts, type LinesProposal } from "@/lib/quotes/lines-proposal";
import { PAYMENT_PRESETS, PAYMENT_PRESET_KEYS, type PaymentPreset, type PaymentStage } from "@/lib/quotes/payment";
import type { QuotePrice } from "@/lib/quotes/quote-price-server";
import type { QuoteNote } from "@/lib/templates/settings";
import { themeVars } from "@/lib/org/theme";
import { fmtAud } from "@/lib/workboard/project-money";

/* THE PROPOSAL, FOR A QUOTE BUILT ON ITS LINES (slice 7.1, mock-up screen 7,
   Isaac 2026-10-07: "the price should not be first… each option… clear
   scope… written summary… what's included on each one").

   Option by option, price last: each option's summary, the work by area,
   what's included, its equipment (the unit lines, a change from option 1
   tagged), then its price; then the choice, what isn't included, payment by
   stage with each option's amount, the business's notes, and the sign-off.

   The words are the quote's own (lines-proposal.ts), each block edited in
   place; every figure is the lines', read as the paper is drawn. */

type Props = {
  proposal: LinesProposal | null;
  lines: QuoteLine[];
  price: QuotePrice | null | undefined;
  optionNames: string[];
  noteLibrary: QuoteNote[];
  paymentTerms: Record<PaymentPreset, { label: string; stages: PaymentStage[] }> | null;
  title: string;
  client: string | null;
  site: string | null;
  preparedBy: string | null;
  jobNumber: string | null;
  busy: boolean;
  onSave: (patch: Partial<LinesProposal>) => void;
};

type Block = "intro" | "notIncluded" | "payment" | "choice" | "notes" | `summary-${number}` | `work-${number}` | `included-${number}`;

const today = () => new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

/** A block of the proposal's words, edited where it sits. */
function Editable({ label, editing, onEdit, children, editor }: { label: string; editing: boolean; onEdit: () => void; children: ReactNode; editor: ReactNode }) {
  return (
    <div className={editing ? "lp-ed on" : "lp-ed"}>
      {editing ? editor : children}
      {!editing && (
        <button type="button" className="lp-edit" aria-label={`Edit ${label}`} onClick={onEdit}>
          Edit
        </button>
      )}
    </div>
  );
}

/** A box of words with Save and Cancel. */
function WordsBox({ label, value, rows, onSave, onCancel, busy }: { label: string; value: string; rows: number; onSave: (v: string) => void; onCancel: () => void; busy: boolean }) {
  const [typed, setTyped] = useState(value);
  return (
    <div className="lp-box">
      <textarea className="wb2-fi" rows={rows} value={typed} aria-label={label} onChange={(e) => setTyped(e.target.value)} />
      <div className="wb2-jqacts">
        <button type="button" className="pbtn ghost sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="pbtn primary sm" disabled={busy} onClick={() => onSave(typed)}>
          Save
        </button>
      </div>
    </div>
  );
}

const quiet = (words: string) => <p className="lp-none">{words}</p>;

export function LinesProposalPaper(props: Props) {
  const { lines, price, busy, onSave } = props;
  const brand = useOrgBrand();
  const [editing, setEditing] = useState<Block | null>(null);
  const p = props.proposal ?? proposalOf({});
  const options = Math.max(1, ...lines.map((l) => l.optionIndex + 1));
  const priced = price && price.ok ? price.options : [];
  const save = (patch: Partial<LinesProposal>) => {
    onSave(patch);
    setEditing(null);
  };
  const optionWords = (i: number) => p.options[i] ?? { summary: "", areas: [], included: [] };
  const setOption = (i: number, change: Partial<LinesProposal["options"][number]>) =>
    save({ options: Array.from({ length: options }, (_, j) => (j === i ? { ...optionWords(j), ...change } : optionWords(j))) });
  const nameOf = (i: number) => props.optionNames[i] || priced[i]?.name || `Option ${i + 1}`;
  const terms = props.paymentTerms ?? PAYMENT_PRESETS;

  return (
    <article className="lp-paper" aria-label="The proposal" style={themeVars(brand.color)}>
      <header className="lp-lh">
        <Letterhead brand={brand} />
        <div className="lp-lh-r">
          <b>{props.jobNumber ? `Quote ${props.jobNumber}` : "Quote"}</b>
          <span>{today()}</span>
        </div>
      </header>

      <div className="lp-parties">
        <div>
          <span>Prepared for</span>
          <b>{props.client ?? "–"}</b>
        </div>
        <div>
          <span>Site</span>
          <b>{props.site ?? "–"}</b>
        </div>
        <div>
          <span>Prepared by</span>
          <b>{props.preparedBy ?? "–"}</b>
        </div>
      </div>

      <Editable
        label="the introduction"
        editing={editing === "intro"}
        onEdit={() => setEditing("intro")}
        editor={
          <IntroBox
            title={p.title || props.title}
            intro={p.intro}
            busy={busy}
            onCancel={() => setEditing(null)}
            onSave={(title, intro) => save({ title, intro })}
          />
        }
      >
        <div className="lp-intro">
          <h2>{p.title || props.title}</h2>
          {p.intro ? <p>{p.intro}</p> : quiet("No introduction written yet.")}
        </div>
      </Editable>

      {Array.from({ length: options }, (_, i) => {
        const w = optionWords(i);
        const units = lines.filter((l) => l.optionIndex === i && l.kind === "unit");
        const o = priced[i];
        return (
          <section key={i} className="lp-opt" aria-label={`Option ${i + 1}`}>
            <header>
              <b className="lp-num">{i + 1}</b>
              <div>
                <span>{`Option ${i + 1}`}</span>
                <h3>{nameOf(i)}</h3>
              </div>
            </header>
            <Editable
              label={`option ${i + 1}'s summary`}
              editing={editing === `summary-${i}`}
              onEdit={() => setEditing(`summary-${i}`)}
              editor={<WordsBox label={`Option ${i + 1}'s summary`} value={w.summary} rows={4} busy={busy} onCancel={() => setEditing(null)} onSave={(v) => setOption(i, { summary: v })} />}
            >
              {w.summary ? <p className="lp-osum">{w.summary}</p> : quiet("No summary written yet.")}
            </Editable>
            <div className="lp-ocols">
              <Editable
                label={`option ${i + 1}'s work`}
                editing={editing === `work-${i}`}
                onEdit={() => setEditing(`work-${i}`)}
                editor={
                  <WordsBox
                    label={`Option ${i + 1}'s work: an area's name ending in a colon, its items under it`}
                    value={areasText(w.areas)}
                    rows={10}
                    busy={busy}
                    onCancel={() => setEditing(null)}
                    onSave={(v) => setOption(i, { areas: areasOf(v) })}
                  />
                }
              >
                <div className="lp-work">
                  <h4 className="lp-oh">The work</h4>
                  {w.areas.length === 0 && quiet("Not written yet.")}
                  {w.areas.map((a, k) => (
                    <div key={k} className="lp-scope">
                      {a.name && <h4>{a.name}</h4>}
                      <ul>
                        {a.items.map((it, n) => (
                          <li key={n}>{it}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </Editable>
              <Editable
                label={`what option ${i + 1} includes`}
                editing={editing === `included-${i}`}
                onEdit={() => setEditing(`included-${i}`)}
                editor={<WordsBox label={`What option ${i + 1} includes, one a line`} value={listText(w.included)} rows={8} busy={busy} onCancel={() => setEditing(null)} onSave={(v) => setOption(i, { included: listOf(v) })} />}
              >
                <aside className="lp-inc">
                  <h4 className="lp-oh">Included</h4>
                  {w.included.length === 0 ? (
                    quiet("Not written yet.")
                  ) : (
                    <ul className="lp-in">
                      {w.included.map((it, n) => (
                        <li key={n}>{it}</li>
                      ))}
                    </ul>
                  )}
                </aside>
              </Editable>
            </div>
            {units.length > 0 && (
              <table className="lp-eq">
                <thead>
                  <tr>
                    <th>Where</th>
                    <th>Unit</th>
                    <th>Model</th>
                    <th className="r">Cooling</th>
                  </tr>
                </thead>
                <tbody>
                  {units.map((u) => {
                    const vs = againstFirst(u, lines);
                    const kw = capacityOf(u.name, u.code ?? "");
                    return (
                      <tr key={u.id}>
                        <td>{u.system || "–"}</td>
                        <td>
                          {u.qty > 1 ? `${u.name} × ${u.qty}` : u.name}
                          {i > 0 && vs !== "same" && <em className="lp-tag">{vs === "added" ? "Added" : "Changed"}</em>}
                        </td>
                        <td>{u.code ?? "–"}</td>
                        <td className="r">{kw != null ? `${kw} kW` : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <footer className="lp-price">
              <span>{`Option ${i + 1}`}</span>
              <b>
                {o ? fmtAud(o.build.exGstCents) : "–"} <small>+ GST</small>
              </b>
              <em>{o ? `${fmtAud(o.build.incGstCents)} inc GST` : ""}</em>
            </footer>
          </section>
        );
      })}

      <section className="lp-sec" aria-label="Your choice">
        <Editable
          label="how the client chooses"
          editing={editing === "choice"}
          onEdit={() => setEditing("choice")}
          editor={
            <div className="lp-box">
              <select className="wb2-fi" value={p.choice} aria-label="How the client chooses" onChange={(e) => save({ choice: e.target.value === "any" ? "any" : "one" })}>
                <option value="one">They choose one option</option>
                <option value="any">They tick any they want</option>
              </select>
            </div>
          }
        >
          <h3 className="lp-ph">
            Your choice <span>{p.choice === "any" ? "Tick any you want" : "Choose one"}</span>
          </h3>
        </Editable>
        <table className="lp-table">
          <thead>
            <tr>
              <th aria-label="Pick" />
              <th>Option</th>
              <th className="r">Ex GST</th>
              <th className="r">GST</th>
              <th className="r">Inc GST</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: options }, (_, i) => (
              <tr key={i}>
                <td>
                  <i className={p.choice === "any" ? "lp-pick tick" : "lp-pick"} aria-hidden="true" />
                </td>
                <td>{`${i + 1}. ${nameOf(i)}`}</td>
                <td className="r">{priced[i] ? fmtAud(priced[i]!.build.exGstCents) : "–"}</td>
                <td className="r">{priced[i] ? fmtAud(priced[i]!.build.gstCents) : "–"}</td>
                <td className="r">
                  <b>{priced[i] ? fmtAud(priced[i]!.build.incGstCents) : "–"}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="lp-sec" aria-label="Not included">
        <Editable
          label="what isn't included"
          editing={editing === "notIncluded"}
          onEdit={() => setEditing("notIncluded")}
          editor={<WordsBox label="What isn't included, one a line" value={listText(p.notIncluded)} rows={8} busy={busy} onCancel={() => setEditing(null)} onSave={(v) => save({ notIncluded: listOf(v) })} />}
        >
          <h3 className="lp-ph">Not included</h3>
          {p.notIncluded.length === 0 ? (
            quiet("Not written yet.")
          ) : (
            <ul className="lp-ex">
              {p.notIncluded.map((it, n) => (
                <li key={n}>{it}</li>
              ))}
            </ul>
          )}
        </Editable>
      </section>

      <section className="lp-sec" aria-label="Payment">
        <Editable
          label="the payment stages"
          editing={editing === "payment"}
          onEdit={() => setEditing("payment")}
          editor={
            <div className="lp-box">
              <select
                className="wb2-fi"
                value={p.payment.preset}
                aria-label="The payment stages"
                onChange={(e) => {
                  const preset = (PAYMENT_PRESET_KEYS as readonly string[]).includes(e.target.value) ? (e.target.value as PaymentPreset) : "domestic_small";
                  save({ payment: { preset, stages: terms[preset].stages.map((s) => ({ ...s })) } });
                }}
              >
                {PAYMENT_PRESET_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {terms[k].label}
                  </option>
                ))}
              </select>
            </div>
          }
        >
          <h3 className="lp-ph">Payment</h3>
        </Editable>
        <table className="lp-table">
          <thead>
            <tr>
              <th>Stage</th>
              <th className="r">Share</th>
              {Array.from({ length: options }, (_, i) => (
                <th key={i} className="r">{`Option ${i + 1}, inc GST`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {p.payment.stages.map((s, k) => (
              <tr key={k}>
                <td>{s.when}</td>
                <td className="r">{s.percent == null ? "–" : `${s.percent}%`}</td>
                {Array.from({ length: options }, (_, i) => {
                  const amount = priced[i] ? stageAmounts(p.payment.stages, priced[i]!.build.incGstCents)[k] : null;
                  return (
                    <td key={i} className="r">
                      {amount == null ? "–" : fmtAud(amount)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="lp-sec" aria-label="Notes">
        <Editable
          label="the notes"
          editing={editing === "notes"}
          onEdit={() => setEditing("notes")}
          editor={<NotesBox library={props.noteLibrary} picked={p.notes} busy={busy} onCancel={() => setEditing(null)} onSave={(notes) => save({ notes })} />}
        >
          <h3 className="lp-ph">Notes</h3>
          {props.noteLibrary.filter((n) => n.always || p.notes.includes(n.key)).length === 0 && quiet("No notes on this proposal.")}
          {props.noteLibrary
            .filter((n) => n.always || p.notes.includes(n.key))
            .map((n) => (
              <div key={n.key} className="lp-note">
                <b>{n.heading}</b>
                <ul>
                  {n.lines.map((l, k) => (
                    <li key={k}>{l}</li>
                  ))}
                </ul>
              </div>
            ))}
        </Editable>
      </section>

      <section className="lp-sec" aria-label="Accepting this quote">
        <h3 className="lp-ph">Accepting this quote</h3>
        <div className="lp-sign">
          <div>Name</div>
          <div>Signature</div>
          <div>Date</div>
          <div>Option</div>
        </div>
      </section>
    </article>
  );
}

function IntroBox({ title, intro, busy, onSave, onCancel }: { title: string; intro: string; busy: boolean; onSave: (title: string, intro: string) => void; onCancel: () => void }) {
  const [t, setT] = useState(title);
  const [words, setWords] = useState(intro);
  return (
    <div className="lp-box">
      <input className="wb2-fi" value={t} aria-label="The proposal's title" onChange={(e) => setT(e.target.value)} />
      <textarea className="wb2-fi" rows={5} value={words} aria-label="The introduction" onChange={(e) => setWords(e.target.value)} />
      <div className="wb2-jqacts">
        <button type="button" className="pbtn ghost sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="pbtn primary sm" disabled={busy} onClick={() => onSave(t.trim(), words)}>
          Save
        </button>
      </div>
    </div>
  );
}

function NotesBox({ library, picked, busy, onSave, onCancel }: { library: QuoteNote[]; picked: string[]; busy: boolean; onSave: (keys: string[]) => void; onCancel: () => void }) {
  const [on, setOn] = useState(new Set(picked));
  return (
    <div className="lp-box">
      <ul className="lp-notepick">
        {library.map((n) => (
          <li key={n.key}>
            <label>
              <input
                type="checkbox"
                checked={n.always || on.has(n.key)}
                disabled={n.always}
                onChange={(e) =>
                  setOn((s) => {
                    const x = new Set(s);
                    if (e.target.checked) x.add(n.key);
                    else x.delete(n.key);
                    return x;
                  })
                }
              />
              {n.heading}
            </label>
          </li>
        ))}
      </ul>
      <div className="wb2-jqacts">
        <button type="button" className="pbtn ghost sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="pbtn primary sm" disabled={busy} onClick={() => onSave([...on])}>
          Save
        </button>
      </div>
    </div>
  );
}
