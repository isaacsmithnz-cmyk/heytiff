"use client";

import { useEffect, useRef, useState } from "react";
import { NoteToken } from "@/components/notes/note-token";
import { Waiting } from "@/components/ui/orb";
import { readQuoteDraft, saveQuoteDraft } from "@/app/actions/quote-draft";
import {
  EXTRA_NOTES,
  EXTRA_NOTE_KEYS,
  draftText,
  notesText,
  optionHeading,
  optionText,
  pricingLines,
  proposalTitle,
  type ExtraNoteKey,
  type PricingMode,
  type ProposalDraft,
  type ProposalOption,
} from "@/lib/quotes/proposal";
import type { StoredProposal } from "@/lib/quotes/proposal-writer";

/* THE QUOTE FACE — a proposal draft in the house layout, block by block.

   The blocks stand in the order the ServiceM8 Proposal has them — title,
   intro, the options, pricing, the notes this job needs beyond the
   template's — each with Copy, so the office starts a Proposal from its
   template and pastes a block into each of its blocks. The words inside a
   block are Tiff's until someone edits them; the order and the dress are
   never anyone's (lib/quotes/proposal).

   WHAT TIFF STILL NEEDS TO KNOW STANDS FIRST, over the draft, because it is
   what has to happen before the draft can go out. Each question's Answer
   puts it in the change box, so an answer is a change like any other and
   the question comes off the list when it lands.

   ONE BOX DRAFTS AND ONE BOX CHANGES. Before there is a draft the box is
   what was said on site; after, it is what to change ("add a second option
   with the unit on the ground", "which option is better?"). Start again
   brings the first box back with its words in it; the draft stays until a
   new one replaces it. */

type Loaded = StoredProposal | null;
type Block = "intro" | "pricing" | "notes" | `option-${number}`;

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
  const [loaded, setLoaded] = useState<Loaded | undefined>(undefined);
  const [readFailed, setReadFailed] = useState(false);
  const [brief, setBrief] = useState("");
  const [change, setChange] = useState("");
  const [redraft, setRedraft] = useState(false);
  const [working, setWorking] = useState<"draft" | "change" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Block | null>(null);
  const changeBox = useRef<HTMLDivElement | null>(null);
  const asked = useRef(false);

  useEffect(() => {
    if (!visible || asked.current) return;
    asked.current = true;
    readQuoteDraft(job)
      .then((p) => {
        setLoaded(p);
        if (p) setBrief(p.brief);
      })
      .catch(() => {
        setReadFailed(true);
        setLoaded(null);
      });
  }, [visible, job]);

  const write = async (kind: "draft" | "change") => {
    const words = kind === "draft" ? brief : change;
    if (!words.trim() || working) return;
    setWorking(kind);
    setError(null);
    try {
      const res = await fetch("/api/workboard/quote-draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(kind === "draft" ? { job, brief: words } : { job, change: words }),
      });
      const body = (await res.json()) as { ok: true; proposal: StoredProposal } | { ok: false; reason: string };
      if (!body.ok) {
        setError(body.reason);
        return;
      }
      setLoaded(body.proposal);
      setRedraft(false);
      setEditing(null);
      if (kind === "change") setChange("");
    } catch {
      setError("Tiff couldn't be reached. Try again.");
    } finally {
      setWorking(null);
    }
  };

  const save = async (draft: ProposalDraft) => {
    const res = await saveQuoteDraft(job, draft).catch(() => null);
    if (!res) {
      onToast("The edit couldn't be saved. Try again.");
      return false;
    }
    if (!res.ok) {
      onToast(res.error);
      return false;
    }
    setLoaded(res.proposal);
    setEditing(null);
    return true;
  };

  const copy = (what: string, text: string) => {
    navigator.clipboard.writeText(text).then(
      () => onToast(`${what} copied`),
      () => onToast("Copying was blocked by the browser.")
    );
  };

  if (loaded === undefined) {
    return <Waiting note="Reading the proposal" />;
  }

  const proposal = loaded;
  const showBrief = !proposal || redraft;

  if (showBrief) {
    return (
      <div className="wb2-jcsec wb2-jq">
        <div className="wb2-jcdhead">
          <b>{proposal ? "Start the proposal again" : "Draft the proposal"}</b>
        </div>
        {readFailed && <p className="wb2-sherr">The saved proposal couldn&rsquo;t be read.</p>}
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
              <button
                type="button"
                className="pbtn primary"
                disabled={!brief.trim()}
                onClick={() => void write("draft")}
              >
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
  const ask = (q: string) => {
    setChange((cur) => (cur.trim() ? `${cur.trim()}\n${q} ` : `${q} `));
    changeBox.current?.querySelector("textarea")?.focus();
  };

  return (
    <>
      {draft.questions.length > 0 && (
        <div className="wb2-jcsec wb2-jq">
          <div className="wb2-jcdhead">
            <b>Still to find out</b>
          </div>
          <ul className="wb2-jqqs">
            {draft.questions.map((q, i) => (
              <li key={i}>
                <span>{q}</span>
                <button type="button" className="pbtn ghost sm" aria-label={`Answer: ${q}`} onClick={() => ask(q)}>
                  Answer
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="wb2-jcsec wb2-jq">
        <div className="wb2-jcdhead">
          <b>Proposal</b>
          <em>
            {proposal.changes.length ? "Changed" : "Drafted"} {whenOf(proposal.updatedAt)}
          </em>
        </div>
        <div className="wb2-jqacts">
          <button type="button" className="pbtn ghost sm" onClick={() => copy("Proposal", draftText(draft, title))}>
            Copy all
          </button>
          <button type="button" className="pbtn ghost sm" onClick={() => setRedraft(true)}>
            Start again
          </button>
        </div>
      </div>

      <QuoteBlock title="Title" onCopy={() => copy("Title", title)}>
        <p className="wb2-shtext">{title}</p>
      </QuoteBlock>

      <QuoteBlock
        title="Intro"
        onCopy={() => copy("Intro", draft.intro)}
        onEdit={() => setEditing("intro")}
        editing={editing === "intro"}
      >
        {editing === "intro" ? (
          <IntroEdit
            intro={draft.intro}
            onCancel={() => setEditing(null)}
            onSave={(intro) => save({ ...draft, intro })}
          />
        ) : (
          <p className="wb2-shtext wb2-jcread">{draft.intro}</p>
        )}
      </QuoteBlock>

      {draft.options.map((o, i) => {
        const key: Block = `option-${i}`;
        const heading = optionHeading(draft, i);
        return (
          <QuoteBlock
            key={i}
            title={heading}
            onCopy={() => copy(heading, optionText(o))}
            onEdit={() => setEditing(key)}
            editing={editing === key}
          >
            {editing === key ? (
              <OptionEdit
                option={o}
                onCancel={() => setEditing(null)}
                onSave={(next) =>
                  save({ ...draft, options: draft.options.map((x, j) => (j === i ? next : x)) })
                }
                onRemove={
                  draft.options.length > 1
                    ? () => save({ ...draft, options: draft.options.filter((_, j) => j !== i) })
                    : undefined
                }
              />
            ) : (
              <OptionBody option={o} />
            )}
          </QuoteBlock>
        );
      })}

      <QuoteBlock
        title="Pricing"
        onCopy={() => copy("Pricing", pricingLines(draft).join("\n"))}
        onEdit={() => setEditing("pricing")}
        editing={editing === "pricing"}
      >
        {editing === "pricing" ? (
          <PricingEdit
            mode={draft.pricingMode}
            onCancel={() => setEditing(null)}
            onSave={(pricingMode) => save({ ...draft, pricingMode })}
          />
        ) : (
          <>
            <p className="wb2-jqmode">
              {draft.pricingMode === "multiple_choice" ? "The client picks one" : "The client ticks the ones they want"}
            </p>
            <ul className="wb2-jqlines">
              {pricingLines(draft).map((l, i) => (
                <li key={i}>
                  <span>As Per Quote</span>
                  <b>{l}</b>
                </li>
              ))}
            </ul>
          </>
        )}
      </QuoteBlock>

      <QuoteBlock
        title="Notes for this job"
        onCopy={draft.notes.length ? () => copy("Notes", notesText(draft.notes)) : undefined}
        onEdit={() => setEditing("notes")}
        editing={editing === "notes"}
      >
        {editing === "notes" ? (
          <NotesEdit
            picked={draft.notes}
            onCancel={() => setEditing(null)}
            onSave={(notes) => save({ ...draft, notes })}
          />
        ) : draft.notes.length === 0 ? (
          <p className="wb2-jqmode">Only the template&rsquo;s standard notes.</p>
        ) : (
          draft.notes.map((k) => (
            <div className="wb2-jqnote" key={k}>
              <b>{EXTRA_NOTES[k].heading}</b>
              <ul className="wb2-jqbul">
                {EXTRA_NOTES[k].lines.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </div>
          ))
        )}
      </QuoteBlock>

      <div className="wb2-jcsec wb2-jq wb2-jqblock" ref={changeBox}>
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
          disabled={working !== null}
          placeholder="Add a second option with the outdoor unit on the ground. Or ask which option is better."
        />
        {error && <p className="wb2-sherr">{error}</p>}
        <div className="wb2-jqacts">
          {working === "change" ? (
            <Waiting note="Changing the proposal" />
          ) : (
            <button
              type="button"
              className="pbtn primary"
              disabled={!change.trim()}
              onClick={() => void write("change")}
            >
              Make the change
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function QuoteBlock({
  title,
  onCopy,
  onEdit,
  editing = false,
  children,
}: {
  title: string;
  onCopy?: () => void;
  onEdit?: () => void;
  editing?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="wb2-jcsec wb2-jq wb2-jqblock">
      <div className="wb2-jcdhead">
        <b>{title}</b>
        {!editing && (onCopy || onEdit) && (
          <span className="wb2-jqbtns">
            {onEdit && (
              <button type="button" className="pbtn ghost sm" aria-label={`Edit ${title}`} onClick={onEdit}>
                Edit
              </button>
            )}
            {onCopy && (
              <button type="button" className="pbtn ghost sm" aria-label={`Copy ${title}`} onClick={onCopy}>
                Copy
              </button>
            )}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function OptionBody({ option }: { option: ProposalOption }) {
  return (
    <>
      <ul className="wb2-jqbul">
        {option.lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      {option.pros.length > 0 && (
        <div className="wb2-jqnote">
          <b>Pros</b>
          <ul className="wb2-jqbul">
            {option.pros.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      )}
      {option.cons.length > 0 && (
        <div className="wb2-jqnote">
          <b>Cons</b>
          <ul className="wb2-jqbul">
            {option.cons.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      )}
    </>
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

function IntroEdit({
  intro,
  onCancel,
  onSave,
}: {
  intro: string;
  onCancel: () => void;
  onSave: (intro: string) => Promise<boolean>;
}) {
  const [text, setText] = useState(intro);
  const { busy, run } = useSaving(() => onSave(text));
  return (
    <>
      <NoteToken as="field" label="the intro" offer={false} rows={5} value={text} onChange={setText} disabled={busy} />
      <EditFoot busy={busy} onCancel={onCancel} onSave={() => void run()} saveWord="Save intro" />
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
  const [pros, setPros] = useState(option.pros.join("\n"));
  const [cons, setCons] = useState(option.cons.join("\n"));
  const { busy, run } = useSaving(() =>
    onSave({ name, lines: linesOf(lines), pros: linesOf(pros), cons: linesOf(cons) })
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
  mode,
  onCancel,
  onSave,
}: {
  mode: PricingMode;
  onCancel: () => void;
  onSave: (mode: PricingMode) => Promise<boolean>;
}) {
  const [pick, setPick] = useState<PricingMode>(mode);
  const { busy, run } = useSaving(() => onSave(pick));
  return (
    <div className="wb2-jqform">
      <label className="wb2-jqcheck">
        <input type="radio" name="jq-mode" checked={pick === "multiple_choice"} onChange={() => setPick("multiple_choice")} disabled={busy} />
        The client picks one
      </label>
      <label className="wb2-jqcheck">
        <input type="radio" name="jq-mode" checked={pick === "optional"} onChange={() => setPick("optional")} disabled={busy} />
        The client ticks the ones they want
      </label>
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
