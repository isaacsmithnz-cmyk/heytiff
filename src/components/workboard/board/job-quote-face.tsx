"use client";

import { useEffect, useRef, useState } from "react";
import { NoteToken } from "@/components/notes/note-token";
import { Waiting } from "@/components/ui/orb";
import {
  EXTRA_NOTES,
  EXTRA_NOTE_KEYS,
  PRICING_WORDS,
  optionHeading,
  proposalTitle,
  type ExtraNoteKey,
  type ProposalDraft,
  type ProposalOption,
} from "@/lib/quotes/proposal";
import {
  CHECKLIST,
  GROUP_ORDER,
  checklistCounts,
  type CheckItem,
  type ChecklistKey,
} from "@/lib/quotes/checklist";
import {
  PAYMENT_PRESETS,
  PAYMENT_PRESET_KEYS,
  paymentProblems,
  type PaymentPreset,
  type PaymentStage,
} from "@/lib/quotes/payment";
import type { StoredProposal } from "@/lib/quotes/proposal-writer";

/* THE QUOTE FACE — a proposal draft on the skeleton, with Tiff as supervisor.

   THE SITE CHECKLIST STANDS FIRST. It is what has to be settled before the
   proposal can go out: the drain, the covering and its colour, the power,
   the height, home or business. Tiff asks one question at a time with the
   usual answers as one press each; an answer is saved on the spot, with no
   model call, and "Put them in" folds the answers into the scope in one
   change. The topics and their questions are fixed (lib/quotes/checklist),
   so every job is asked the same way.

   THE BLOCKS FOLLOW THE SKELETON (lib/quotes/proposal): title, intro, why
   this system, the options with their units room by room, pricing with its
   extras and allowances, payment, and the notes this job needs beyond the
   standard ones. Each has Edit. Nothing is copied out: the proposal goes to
   the client and to ServiceM8 as a whole, from here.

   ONE BOX DRAFTS AND ONE BOX CHANGES. Before there is a draft the box is
   what was said on site; after, it is what to change. Start again brings the
   first box back with its words in it; the draft stays until a new one
   replaces it. */

type Block = "intro" | "why" | "pricing" | "payment" | "notes" | `option-${number}`;
type Answer =
  | { ok: true; proposal: StoredProposal | null }
  /** `proposal` comes back when the draft moved on underneath the change */
  | { ok: false; reason: string; proposal?: StoredProposal | null };
/** A person's edit, applied to the draft as it stands when its turn comes. */
type Edit = (draft: ProposalDraft) => ProposalDraft;

const ROUTE = "/api/workboard/quote-draft";

const whenOf = (iso: string) =>
  new Date(iso).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Australia/Sydney",
  });

const linesOf = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/** "Name, detail" per line, split on the first comma or spaced dash. */
const namedOf = (text: string) =>
  linesOf(text).map((l) => {
    const m = /^(.*?)\s*(?:,|\s[-–]\s)\s*(.*)$/.exec(l);
    return m ? { name: m[1]!, detail: m[2]! } : { name: l, detail: "" };
  });
const namedText = (xs: readonly { name: string; detail: string }[]) =>
  xs.map((x) => (x.detail ? `${x.name}, ${x.detail}` : x.name)).join("\n");

export function JobQuoteFace({
  job,
  address,
  visible,
  onToast,
}: {
  /** The job card's uuid, or the row's until the record read lands. */
  job: string;
  address: string | null;
  /** Read the stored draft only once the tab is opened. */
  visible: boolean;
  onToast: (message: string) => void;
}) {
  const [loaded, setLoaded] = useState<StoredProposal | null | undefined>(undefined);
  const [readFailed, setReadFailed] = useState(false);
  const [brief, setBrief] = useState("");
  const [change, setChange] = useState("");
  const [redraft, setRedraft] = useState(false);
  const [working, setWorking] = useState<"draft" | "change" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Block | null>(null);
  const [reads, setReads] = useState(0);
  const asked = useRef(-1);
  /* The draft as the server last said it is, and the saves in flight, one
     behind the other: two answers pressed in a second each build on the one
     before, rather than both on the same old copy. */
  const latest = useRef<StoredProposal | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const land = (p: StoredProposal | null) => {
    latest.current = p;
    setLoaded(p);
  };

  useEffect(() => {
    if (!visible || asked.current === reads) return;
    asked.current = reads;
    fetch(`${ROUTE}?job=${encodeURIComponent(job)}`)
      .then((r) => r.json() as Promise<Answer>)
      .then((a) => {
        if (!a.ok) throw new Error(a.reason);
        setReadFailed(false);
        latest.current = a.proposal;
        setLoaded(a.proposal);
        if (a.proposal) setBrief(a.proposal.brief);
      })
      /* NOT the draft box: drafting on a read that failed would pay for a
         new proposal over the one that couldn't be read */
      .catch(() => setReadFailed(true));
  }, [visible, job, reads]);

  const write = async (kind: "draft" | "change" | "apply") => {
    const words = kind === "draft" ? brief : change;
    if ((kind !== "apply" && !words.trim()) || working) return;
    setWorking(kind);
    setError(null);
    try {
      const res = await fetch(ROUTE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          kind === "draft"
            ? { job, brief: words, replace: redraft }
            : kind === "change"
              ? { job, change: words }
              : { job, apply: true }
        ),
      });
      const a = (await res.json()) as Answer;
      if (!a.ok) {
        setError(a.reason);
        if (a.proposal) {
          land(a.proposal);
          setRedraft(false);
        }
        return;
      }
      land(a.proposal);
      setRedraft(false);
      setEditing(null);
      if (kind === "change") setChange("");
    } catch {
      setError("Tiff couldn't be reached. Try again.");
    } finally {
      setWorking(null);
    }
  };

  const save = (edit: Edit): Promise<boolean> => {
    const run = async () => {
      const base = latest.current;
      if (!base) return false;
      try {
        const res = await fetch(ROUTE, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ job, draft: edit(base.draft), base: base.updatedAt }),
        });
        const a = (await res.json()) as Answer;
        if (!a.ok) {
          if (a.proposal) land(a.proposal);
          onToast(a.reason);
          return false;
        }
        land(a.proposal);
        return true;
      } catch {
        onToast("The edit couldn't be saved. Try again.");
        return false;
      }
    };
    const next = queue.current.then(run, run);
    queue.current = next;
    return next;
  };

  /** A block's own Save: closes that block's editor when it lands, and
      leaves any other editor open with its words in it. */
  const saveBlock = (block: Block, edit: Edit) =>
    save(edit).then((ok) => {
      if (ok) setEditing((open) => (open === block ? null : open));
      return ok;
    });

  if (readFailed && loaded === undefined) {
    return (
      <div className="wb2-jcsec wb2-jq">
        <p className="wb2-sherr">The saved proposal couldn&rsquo;t be read.</p>
        <div className="wb2-jqacts">
          <button type="button" className="pbtn ghost" onClick={() => setReads((n) => n + 1)}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (loaded === undefined) return <Waiting note="Reading the proposal" />;

  const proposal = loaded;
  if (!proposal || redraft) {
    return (
      <div className="wb2-jcsec wb2-jq">
        <div className="wb2-jcdhead">
          <b>{proposal ? "Start the proposal again" : "Draft the proposal"}</b>
        </div>
        <NoteToken
          as="field"
          label="what the job is"
          offer={false}
          rows={6}
          value={brief}
          onChange={setBrief}
          disabled={working !== null}
          placeholder="What's the job? The unit, where each part goes, and how the pipes, drain and power get there."
        />
        {error && <p className="wb2-sherr">{error}</p>}
        <div className="wb2-jqacts">
          {working === "draft" ? (
            <Waiting note="Drafting the proposal" />
          ) : (
            <>
              <button type="button" className="pbtn primary" disabled={!brief.trim()} onClick={() => void write("draft")}>
                Draft proposal
              </button>
              {proposal && (
                <button type="button" className="pbtn ghost" onClick={() => setRedraft(false)}>
                  Keep this draft
                </button>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  const { draft } = proposal;
  const title = proposalTitle(address);
  const busy = working !== null;

  return (
    <>
      <SiteChecklist
        items={draft.checklist}
        busy={busy}
        applying={working === "apply"}
        onAnswer={(key, answer) =>
          save((d) => ({
            ...d,
            checklist: d.checklist.map((i) => (i.key === key ? { key, state: "known", answer, fresh: true } : i)),
          }))
        }
        onApply={() => void write("apply")}
      />

      <div className="wb2-jcsec wb2-jq wb2-jqblock">
        <div className="wb2-jcdhead">
          <b>Proposal</b>
          <em>
            {proposal.changes.length ? "Changed" : "Drafted"} {whenOf(proposal.updatedAt)}
          </em>
        </div>
        <p className="wb2-jqtitle">{title}</p>
        <div className="wb2-jqacts">
          <button type="button" className="pbtn ghost sm" disabled={busy} onClick={() => setRedraft(true)}>
            Start again
          </button>
        </div>
      </div>

      <QuoteBlock title="Intro" onEdit={() => setEditing("intro")} editing={editing === "intro"}>
        {editing === "intro" ? (
          <TextEdit
            label="the intro"
            value={draft.intro}
            word="Save intro"
            onCancel={() => setEditing(null)}
            onSave={(intro) => saveBlock("intro", (d) => ({ ...d, intro }))}
          />
        ) : (
          <p className="wb2-shtext wb2-jcread">{draft.intro}</p>
        )}
      </QuoteBlock>

      {(draft.why || editing === "why") && (
        <QuoteBlock title="Why this system" onEdit={() => setEditing("why")} editing={editing === "why"}>
          {editing === "why" ? (
            <TextEdit
              label="why this system"
              value={draft.why}
              word="Save"
              onCancel={() => setEditing(null)}
              onSave={(why) => saveBlock("why", (d) => ({ ...d, why }))}
            />
          ) : (
            <p className="wb2-shtext wb2-jcread">{draft.why}</p>
          )}
        </QuoteBlock>
      )}

      {draft.options.map((o, i) => {
        const key: Block = `option-${i}`;
        return (
          <QuoteBlock key={i} title={optionHeading(draft, i)} onEdit={() => setEditing(key)} editing={editing === key}>
            {editing === key ? (
              <OptionEdit
                option={o}
                onCancel={() => setEditing(null)}
                onSave={(next) => saveBlock(key, (d) => ({ ...d, options: d.options.map((x, j) => (j === i ? next : x)) }))}
                onRemove={
                  draft.options.length > 1
                    ? () => saveBlock(key, (d) => ({ ...d, options: d.options.filter((_, j) => j !== i) }))
                    : undefined
                }
              />
            ) : (
              <OptionBody option={o} />
            )}
          </QuoteBlock>
        );
      })}

      <QuoteBlock title="Pricing" onEdit={() => setEditing("pricing")} editing={editing === "pricing"}>
        {editing === "pricing" ? (
          <PricingEdit
            draft={draft}
            onCancel={() => setEditing(null)}
            onSave={(pricing) => saveBlock("pricing", (d) => ({ ...d, ...pricing }))}
          />
        ) : (
          <PricingBody draft={draft} />
        )}
      </QuoteBlock>

      <QuoteBlock title="Payment" onEdit={() => setEditing("payment")} editing={editing === "payment"}>
        <PaymentBlock
          payment={draft.payment}
          editing={editing === "payment"}
          onCancel={() => setEditing(null)}
          onPick={(payment) => save((d) => ({ ...d, payment }))}
          onSave={(payment) => saveBlock("payment", (d) => ({ ...d, payment }))}
        />
      </QuoteBlock>

      <QuoteBlock title="Notes for this job" onEdit={() => setEditing("notes")} editing={editing === "notes"}>
        {editing === "notes" ? (
          <NotesEdit
            picked={draft.notes}
            onCancel={() => setEditing(null)}
            onSave={(notes) => saveBlock("notes", (d) => ({ ...d, notes }))}
          />
        ) : draft.notes.length === 0 ? (
          <p className="wb2-jqmode">Only the standard notes.</p>
        ) : (
          draft.notes.map((k) => (
            <div className="wb2-jqnote" key={k}>
              <b>{EXTRA_NOTES[k].heading}</b>
              <Bullets lines={EXTRA_NOTES[k].lines} />
            </div>
          ))
        )}
      </QuoteBlock>

      <div className="wb2-jcsec wb2-jq wb2-jqblock">
        <div className="wb2-jcdhead">
          <b>Change the proposal</b>
        </div>
        <NoteToken
          as="field"
          label="what to change"
          offer={false}
          rows={3}
          value={change}
          onChange={setChange}
          disabled={busy}
          placeholder="Add a second option with the outdoor unit on the ground. Or ask which option is better."
        />
        {error && <p className="wb2-sherr">{error}</p>}
        <div className="wb2-jqacts">
          {working === "change" ? (
            <Waiting note="Changing the proposal" />
          ) : (
            <button type="button" className="pbtn primary" disabled={!change.trim() || busy} onClick={() => void write("change")}>
              Make the change
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/* ── the site checklist ── */

function SiteChecklist({
  items,
  busy,
  applying,
  onAnswer,
  onApply,
}: {
  items: CheckItem[];
  busy: boolean;
  applying: boolean;
  onAnswer: (key: ChecklistKey, answer: string) => Promise<boolean>;
  onApply: () => void;
}) {
  const asks = items.filter((i) => i.state === "ask");
  /* What the card is on. `chosen` is a topic the person opened themselves,
     which stays open even when it's known; a topic the card moved on to by
     itself gives way to the first open question once it's settled, so a
     rewrite of the draft never leaves the card on an answered topic. */
  const [on, setOn] = useState<{ key: ChecklistKey | null; chosen: boolean } | null>(null);
  const first = asks[0]?.key ?? null;
  const asking =
    on === null
      ? first
      : on.chosen || on.key === null || asks.some((i) => i.key === on.key)
        ? on.key
        : first;
  const setAsking = (key: ChecklistKey | null, chosen = false) => setOn({ key, chosen });
  const [own, setOwn] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (items.length === 0) return null;

  const counts = checklistCounts(items);
  const fresh = items.filter((i) => i.fresh).length;
  const current = asking ? CHECKLIST[asking] : null;
  const currentItem = asking ? items.find((i) => i.key === asking) : undefined;

  const answer = async (words: string) => {
    if (!asking || !words.trim()) return;
    setSaving(true);
    const ok = await onAnswer(asking, words.trim());
    setSaving(false);
    if (!ok) return;
    setOwn(null);
    /* on down the list from the one just answered, then round to the top */
    const at = asks.findIndex((i) => i.key === asking);
    const next = asks.slice(at + 1).concat(asks.slice(0, Math.max(at, 0))).find((i) => i.key !== asking);
    setAsking(next ? next.key : null);
  };

  return (
    <div className="wb2-jcsec wb2-jq">
      <div className="wb2-jcdhead">
        <b>Site checklist</b>
        <em>{`${counts.known} known, ${counts.ask} to ask`}</em>
      </div>

      {current && currentItem && (
        <div className="wb2-jqnow">
          <p className="wb2-jqask">{current.question}</p>
          {own === null ? (
            <div className="wb2-jqacts">
              {current.choices.map((c) => (
                <button key={c} type="button" className="pbtn ghost" disabled={saving || busy} onClick={() => void answer(c)}>
                  {c}
                </button>
              ))}
              <button type="button" className="pbtn ghost" disabled={saving || busy} onClick={() => setOwn(currentItem.answer)}>
                {current.choices.length ? "Something else" : "Type the answer"}
              </button>
              <button type="button" className="pbtn ghost sm wb2-jqlead-r" disabled={saving} onClick={() => setAsking(null)}>
                Not now
              </button>
            </div>
          ) : (
            <div className="wb2-jqown">
              <input
                className="wb2-fi"
                aria-label={current.label}
                value={own}
                autoFocus
                disabled={saving}
                onChange={(e) => setOwn(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void answer(own);
                  if (e.key === "Escape") setOwn(null);
                }}
              />
              <button type="button" className="pbtn primary" disabled={saving || !own.trim()} onClick={() => void answer(own)}>
                Save answer
              </button>
              <button type="button" className="pbtn ghost" disabled={saving} onClick={() => setOwn(null)}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {fresh > 0 && (
        <div className="wb2-jqfresh">
          <span>{fresh === 1 ? "1 answer isn't in the proposal yet" : `${fresh} answers aren't in the proposal yet`}</span>
          {applying ? (
            <Waiting note="Putting them in" />
          ) : (
            <button type="button" className="pbtn primary sm" disabled={busy} onClick={onApply}>
              Put them in
            </button>
          )}
        </div>
      )}

      <ul className="wb2-jqcheck-list">
        {GROUP_ORDER.map((g) => {
          const rows = items.filter((i) => CHECKLIST[i.key].group === g);
          if (rows.length === 0) return null;
          return (
            <li key={g} className="wb2-jqcg">
              <b>{g}</b>
              <ul>
                {rows.map((i) => (
                  <li key={i.key} className={asking === i.key ? "on" : undefined}>
                    <span className="wb2-jqct">{CHECKLIST[i.key].label}</span>
                    <span className="wb2-jqca">{i.state === "ask" ? CHECKLIST[i.key].question : i.answer}</span>
                    <span className={`wb2-jqcs ${i.state === "known" ? "ok" : i.state === "ask" ? "warn" : "q"}`}>
                      {i.state === "known" ? "Known" : i.state === "ask" ? "Ask" : "Not needed"}
                    </span>
                    <button
                      type="button"
                      className="pbtn ghost sm"
                      aria-label={`${i.state === "ask" ? "Answer" : "Change"} ${CHECKLIST[i.key].label}`}
                      disabled={busy}
                      onClick={() => {
                        setOwn(null);
                        setAsking(i.key, true);
                      }}
                    >
                      {i.state === "ask" ? "Answer" : "Change"}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ── the blocks ── */

function QuoteBlock({
  title,
  onEdit,
  editing = false,
  children,
}: {
  title: string;
  onEdit?: () => void;
  editing?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="wb2-jcsec wb2-jq wb2-jqblock">
      <div className="wb2-jcdhead">
        <b>{title}</b>
        {!editing && onEdit && (
          <span className="wb2-jqbtns">
            <button type="button" className="pbtn ghost sm" aria-label={`Edit ${title}`} onClick={onEdit}>
              Edit
            </button>
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function Bullets({ lines }: { lines: readonly string[] }) {
  return (
    <ul className="wb2-jqbul">
      {lines.map((l, i) => (
        <li key={i}>{l}</li>
      ))}
    </ul>
  );
}

function OptionBody({ option }: { option: ProposalOption }) {
  return (
    <>
      <Bullets lines={option.lines} />
      {option.units.length > 0 && (
        <ul className="wb2-jqlines wb2-jqunits">
          {option.units.map((u, i) => (
            <li key={i}>
              <span>{u.room}</span>
              <b>{[u.capacity, u.type].filter(Boolean).join(", ")}</b>
            </li>
          ))}
        </ul>
      )}
      {option.pros.length > 0 && (
        <div className="wb2-jqnote">
          <b>Pros</b>
          <Bullets lines={option.pros} />
        </div>
      )}
      {option.cons.length > 0 && (
        <div className="wb2-jqnote">
          <b>Cons</b>
          <Bullets lines={option.cons} />
        </div>
      )}
    </>
  );
}

function NamedRows({ label, rows }: { label: string; rows: readonly { name: string; detail: string }[] }) {
  return (
    <ul className="wb2-jqlines">
      {rows.map((x, i) => (
        <li key={i}>
          <span>{label}</span>
          <b>
            {x.name}
            {x.detail && <em>{x.detail}</em>}
          </b>
        </li>
      ))}
    </ul>
  );
}

function PricingBody({ draft }: { draft: ProposalDraft }) {
  return (
    <>
      <p className="wb2-jqmode">{PRICING_WORDS[draft.pricingMode]}</p>
      <ul className="wb2-jqlines">
        {draft.pricingMode === "itemised"
          ? draft.items.map((it, i) => (
              <li key={i}>
                <span>{`${it.qty} ×`}</span>
                <b>{it.name}</b>
              </li>
            ))
          : draft.options.map((_, i) => (
              <li key={i}>
                <span>As Per Quote</span>
                <b>{optionHeading(draft, i)}</b>
              </li>
            ))}
      </ul>
      {draft.extras.length > 0 && (
        <div className="wb2-jqnote">
          <b>Extras, priced on their own</b>
          <NamedRows label="Extra" rows={draft.extras} />
        </div>
      )}
      {draft.allowances.length > 0 && (
        <div className="wb2-jqnote">
          <b>Allowances</b>
          <NamedRows label="Allowance" rows={draft.allowances} />
        </div>
      )}
    </>
  );
}

function PaymentBlock({
  payment,
  editing,
  onCancel,
  onPick,
  onSave,
}: {
  payment: ProposalDraft["payment"];
  editing: boolean;
  onCancel: () => void;
  /** A preset pressed: saved on its own, closing nothing. */
  onPick: (p: ProposalDraft["payment"]) => Promise<boolean>;
  onSave: (p: ProposalDraft["payment"]) => Promise<boolean>;
}) {
  const [switching, setSwitching] = useState(false);
  const problems = paymentProblems(payment.preset, payment.stages);

  const pick = async (preset: PaymentPreset) => {
    if (preset === payment.preset || switching) return;
    setSwitching(true);
    await onPick({ preset, stages: PAYMENT_PRESETS[preset].stages.map((s) => ({ ...s })) });
    setSwitching(false);
  };

  return (
    <>
      <div className="wb2-jqseg" role="radiogroup" aria-label="Payment terms">
        {PAYMENT_PRESET_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={payment.preset === k}
            className={payment.preset === k ? "on" : undefined}
            disabled={switching || editing}
            onClick={() => void pick(k)}
          >
            {PAYMENT_PRESETS[k].label}
          </button>
        ))}
      </div>
      {editing ? (
        /* mounted fresh each time Edit opens, so it starts from the stages
           the draft holds now, whoever last changed them */
        <StagesEdit payment={payment} onCancel={onCancel} onSave={onSave} />
      ) : (
        <>
          <ul className="wb2-jqlines">
            {payment.stages.map((s, i) => (
              <li key={i}>
                <span>{s.percent === null ? "Claimed" : `${s.percent}%`}</span>
                <b>{s.when}</b>
              </li>
            ))}
          </ul>
          {problems.map((p) => (
            <p key={p} className="wb2-sherr">
              {p}
            </p>
          ))}
        </>
      )}
    </>
  );
}

function StagesEdit({
  payment,
  onCancel,
  onSave,
}: {
  payment: ProposalDraft["payment"];
  onCancel: () => void;
  onSave: (p: ProposalDraft["payment"]) => Promise<boolean>;
}) {
  const [stages, setStages] = useState<PaymentStage[]>(payment.stages);
  const { busy, run } = useSaving(() => onSave({ preset: payment.preset, stages }));
  const problems = paymentProblems(payment.preset, stages);
  return (
    <div className="wb2-jqform">
      {stages.map((s, i) => (
        <div className="wb2-jqstage" key={i}>
          <input
            className="wb2-fi"
            aria-label={`Stage ${i + 1}`}
            value={s.when}
            disabled={busy}
            onChange={(e) => setStages((cur) => cur.map((x, j) => (j === i ? { ...x, when: e.target.value } : x)))}
          />
          <input
            className="wb2-fi wb2-jqpct"
            aria-label={`Stage ${i + 1} percent`}
            inputMode="numeric"
            value={s.percent ?? ""}
            disabled={busy}
            onChange={(e) =>
              setStages((cur) =>
                cur.map((x, j) =>
                  j === i ? { ...x, percent: e.target.value.trim() === "" ? null : Number(e.target.value) || 0 } : x
                )
              )
            }
          />
          <span className="wb2-jqpcts">%</span>
          <button
            type="button"
            className="pbtn ghost sm"
            aria-label={`Remove stage ${i + 1}`}
            disabled={busy || stages.length < 2}
            onClick={() => setStages((cur) => cur.filter((_, j) => j !== i))}
          >
            Remove
          </button>
        </div>
      ))}
      {problems.map((p) => (
        <p key={p} className="wb2-sherr">
          {p}
        </p>
      ))}
      <EditFoot
        busy={busy}
        onCancel={onCancel}
        onSave={() => void run()}
        saveWord="Save payment"
        extra={
          <button
            type="button"
            className="pbtn ghost wb2-jqlead"
            disabled={busy}
            onClick={() => setStages((cur) => [...cur, { when: "", percent: 0 }])}
          >
            Add a stage
          </button>
        }
      />
    </div>
  );
}

/* ── the edits: each saves the whole draft through the same gate ── */

function EditFoot({
  busy,
  onCancel,
  onSave,
  saveWord,
  extra,
}: {
  busy: boolean;
  onCancel: () => void;
  onSave: () => void;
  saveWord: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="wb2-jqacts">
      {extra}
      <button type="button" className="pbtn ghost" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
      <button type="button" className="pbtn primary" disabled={busy} onClick={onSave}>
        {saveWord}
      </button>
    </div>
  );
}

function useSaving(onSave: () => Promise<boolean>) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const ok = await onSave();
    if (!ok) setBusy(false);
  };
  return { busy, run };
}

function TextEdit({
  label,
  value,
  word,
  onCancel,
  onSave,
}: {
  label: string;
  value: string;
  word: string;
  onCancel: () => void;
  onSave: (text: string) => Promise<boolean>;
}) {
  const [text, setText] = useState(value);
  const { busy, run } = useSaving(() => onSave(text));
  return (
    <>
      <NoteToken as="field" label={label} offer={false} rows={5} value={text} onChange={setText} disabled={busy} />
      <EditFoot busy={busy} onCancel={onCancel} onSave={() => void run()} saveWord={word} />
    </>
  );
}

function OptionEdit({
  option,
  onCancel,
  onSave,
  onRemove,
}: {
  option: ProposalOption;
  onCancel: () => void;
  onSave: (next: ProposalOption) => Promise<boolean>;
  onRemove?: () => Promise<boolean>;
}) {
  const [name, setName] = useState(option.name);
  const [lines, setLines] = useState(option.lines.join("\n"));
  const [units, setUnits] = useState(option.units.map((u) => [u.room, u.capacity, u.type].join(", ")).join("\n"));
  const [pros, setPros] = useState(option.pros.join("\n"));
  const [cons, setCons] = useState(option.cons.join("\n"));
  const { busy, run } = useSaving(() =>
    onSave({
      name,
      lines: linesOf(lines),
      units: linesOf(units).map((l) => {
        const [room = "", capacity = "", ...type] = l.split(",").map((s) => s.trim());
        return { room, capacity, type: type.join(", ") };
      }),
      pros: linesOf(pros),
      cons: linesOf(cons),
    })
  );
  const removing = useSaving(() => (onRemove ? onRemove() : Promise.resolve(false)));
  const off = busy || removing.busy;
  return (
    <div className="wb2-jqform">
      <label className="wb2-jqfield">
        <span>Name</span>
        <input className="wb2-fi" value={name} onChange={(e) => setName(e.target.value)} disabled={off} />
      </label>
      <div className="wb2-jqfield">
        <span>Scope, one line each</span>
        <NoteToken as="field" label="the scope" offer={false} rows={6} value={lines} onChange={setLines} disabled={off} />
      </div>
      <div className="wb2-jqfield">
        <span>Units, one room each: room, capacity, type</span>
        <NoteToken as="field" label="the units" offer={false} rows={3} value={units} onChange={setUnits} disabled={off} />
      </div>
      <div className="wb2-jqfield">
        <span>Pros, one line each</span>
        <NoteToken as="field" label="the pros" offer={false} rows={2} value={pros} onChange={setPros} disabled={off} />
      </div>
      <div className="wb2-jqfield">
        <span>Cons, one line each</span>
        <NoteToken as="field" label="the cons" offer={false} rows={2} value={cons} onChange={setCons} disabled={off} />
      </div>
      <EditFoot
        busy={off}
        onCancel={onCancel}
        onSave={() => void run()}
        saveWord="Save option"
        extra={
          onRemove && (
            <button type="button" className="pbtn ghost danger wb2-jqlead" disabled={off} onClick={() => void removing.run()}>
              Remove option
            </button>
          )
        }
      />
    </div>
  );
}

function PricingEdit({
  draft,
  onCancel,
  onSave,
}: {
  draft: ProposalDraft;
  onCancel: () => void;
  onSave: (pricing: Pick<ProposalDraft, "pricingMode" | "items" | "extras" | "allowances">) => Promise<boolean>;
}) {
  const [mode, setMode] = useState(draft.pricingMode);
  const [items, setItems] = useState(draft.items.map((it) => `${it.qty} × ${it.name}`).join("\n"));
  const [extras, setExtras] = useState(namedText(draft.extras));
  const [allowances, setAllowances] = useState(namedText(draft.allowances));
  const { busy, run } = useSaving(() =>
    onSave({
      pricingMode: mode,
      items: linesOf(items).map((l) => {
        const m = /^(\d+(?:\.\d+)?)\s*[×x*]\s*(.+)$/i.exec(l);
        return m ? { qty: m[1]!, name: m[2]! } : { qty: "1", name: l };
      }),
      extras: namedOf(extras),
      allowances: namedOf(allowances),
    })
  );
  return (
    <div className="wb2-jqform">
      {(["multiple_choice", "optional", "itemised"] as const).map((m) => (
        <label className="wb2-jqcheck" key={m}>
          <input type="radio" name="jq-mode" checked={mode === m} onChange={() => setMode(m)} disabled={busy} />
          {PRICING_WORDS[m]}
        </label>
      ))}
      {mode === "itemised" && (
        <div className="wb2-jqfield">
          <span>Lines, one each: quantity × item</span>
          <NoteToken as="field" label="the lines" offer={false} rows={4} value={items} onChange={setItems} disabled={busy} />
        </div>
      )}
      <div className="wb2-jqfield">
        <span>Extras, one each: name, detail</span>
        <NoteToken as="field" label="the extras" offer={false} rows={2} value={extras} onChange={setExtras} disabled={busy} />
      </div>
      <div className="wb2-jqfield">
        <span>Allowances, one each: name, allowance</span>
        <NoteToken as="field" label="the allowances" offer={false} rows={2} value={allowances} onChange={setAllowances} disabled={busy} />
      </div>
      <EditFoot busy={busy} onCancel={onCancel} onSave={() => void run()} saveWord="Save pricing" />
    </div>
  );
}

function NotesEdit({
  picked,
  onCancel,
  onSave,
}: {
  picked: ExtraNoteKey[];
  onCancel: () => void;
  onSave: (notes: ExtraNoteKey[]) => Promise<boolean>;
}) {
  const [keys, setKeys] = useState<ExtraNoteKey[]>(picked);
  const { busy, run } = useSaving(() => onSave(EXTRA_NOTE_KEYS.filter((k) => keys.includes(k))));
  return (
    <div className="wb2-jqform">
      {EXTRA_NOTE_KEYS.map((k) => (
        <label className="wb2-jqcheck" key={k}>
          <input
            type="checkbox"
            checked={keys.includes(k)}
            disabled={busy}
            onChange={(e) => setKeys((cur) => (e.target.checked ? [...cur, k] : cur.filter((x) => x !== k)))}
          />
          {EXTRA_NOTES[k].heading}
        </label>
      ))}
      <EditFoot busy={busy} onCancel={onCancel} onSave={() => void run()} saveWord="Save notes" />
    </div>
  );
}
