"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  choiceBlock,
  choiceFacts,
  choiceStateWord,
  holdersOf,
  licenceTypes,
  type PaperChoice,
  type PaperChoices,
} from "@/lib/compliance/papers";

/* ADD COMPLIANCE — the Documents face's third way in, opened IN the face under
   the row that holds it, the way the Checklist's composer sits under its
   title. Not a modal over the card: the job stays in view, and what is added
   lands in the Compliance group directly below.

   TWO SIDES, each only for someone who may add it. The business's papers are
   a list; the team's tickets are asked the way the office asks them — which
   licence, then whose — so a type is chosen first and its holders follow,
   the people booked on this job at the top.

   A PAPER THAT CAN'T GO ON A JOB SAYS WHY INSTEAD OF OFFERING A BOX: an
   expired certificate is not something to hand a customer, and a card with no
   paper under it has nothing to hand them. Ticks survive switching licence
   type; the count beside Add to job is the whole of them. */

function ChoiceRow({
  choice,
  today,
  ticked,
  onTick,
}: {
  choice: PaperChoice;
  today: string;
  ticked: boolean;
  onTick: (on: boolean) => void;
}) {
  const block = choiceBlock(choice);
  const state = choiceStateWord(choice, today);
  const facts = choiceFacts(choice);
  const title = choice.kind === "staff" ? choice.person ?? choice.name : choice.name;
  return (
    <label className={`wb2-cprow${block ? " off" : ""}`}>
      <input
        type="checkbox"
        checked={choice.onJob || ticked}
        disabled={!!block}
        onChange={(e) => onTick(e.target.checked)}
      />
      <span className="wb2-cpname">
        <b>{title}</b>
        {facts && <em>{facts}</em>}
      </span>
      {choice.booked && <em className="wb2-cpbook">Booked on this job</em>}
      <em className={`wb2-cpstate sw-state${state.tone === "mute" ? "" : ` ${state.tone}`}`}>{state.word}</em>
    </label>
  );
}

export function ComplianceChooser({
  today,
  onLoad,
  onAdd,
  onClose,
}: {
  /** yyyy-mm-dd — what "expires in 2 weeks" counts from. */
  today: string;
  onLoad: () => Promise<PaperChoices | null>;
  /** Resolves null once they are on the job, or with the reason they aren't. */
  onAdd: (keys: string[]) => Promise<string | null>;
  onClose: () => void;
}) {
  const [choices, setChoices] = useState<PaperChoices | null>(null);
  const [failed, setFailed] = useState(false);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [type, setType] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /* READ ONCE PER OPENING — a fresh chooser is a fresh read. The loader is
     held from mount so the effect is honestly empty-dep'd: a `react-hooks/*`
     disable anywhere in a file makes React Compiler skip it (use-org-brand
     has the story). */
  const loadAtMount = useRef(onLoad);
  useEffect(() => {
    let live = true;
    loadAtMount
      .current()
      .then((c) => {
        if (!live) return;
        if (c) setChoices(c);
        else setFailed(true);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const types = useMemo(() => licenceTypes(choices?.staff ?? []), [choices]);
  /* the type in view: the one chosen, else the first — the trade tickets
     lead (licenceTypes says why) */
  const shown = type && types.includes(type) ? type : types[0] ?? null;
  const holders = shown ? holdersOf(choices?.staff ?? [], shown) : [];

  const tick = (key: string, on: boolean) =>
    setTicked((cur) => {
      const next = new Set(cur);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const tickedOf = (t: string) => holdersOf(choices?.staff ?? [], t).filter((c) => ticked.has(c.key)).length;

  const add = async () => {
    if (ticked.size === 0 || busy) return;
    setBusy(true);
    setErr(null);
    const why = await onAdd([...ticked]).catch(() => "Couldn't add them to the job.");
    setBusy(false);
    if (why) setErr(why);
    else onClose();
  };

  return (
    <div className="wb2-cpick" role="group" aria-label="Add compliance">
      {failed ? (
        <p className="int-hint">Couldn&apos;t read the licences and insurance. Close the card and open it again.</p>
      ) : choices === null ? (
        <p className="int-hint">Reading the licences and insurance…</p>
      ) : (
        <>
          {choices.company && (
            <div className="wb2-jcsec">
              <span className="wb2-sect">Company</span>
              {choices.company.length === 0 ? (
                <p className="int-hint">No licences or insurance on file. They&apos;re added on the Organisation screen.</p>
              ) : (
                choices.company.map((c) => (
                  <ChoiceRow
                    key={c.key}
                    choice={c}
                    today={today}
                    ticked={ticked.has(c.key)}
                    onTick={(on) => tick(c.key, on)}
                  />
                ))
              )}
            </div>
          )}

          {choices.staff && (
            <div className="wb2-jcsec">
              <span className="wb2-sect">Staff licences</span>
              {types.length === 0 ? (
                <p className="int-hint">No staff licences on file. They&apos;re added on each person&apos;s card.</p>
              ) : (
                <>
                  <span className="wb2-ckseg wb2-cptypes" role="group" aria-label="Which licence">
                    {types.map((t) => {
                      const n = tickedOf(t);
                      return (
                        <button
                          key={t}
                          type="button"
                          className={t === shown ? "on" : undefined}
                          aria-pressed={t === shown}
                          onClick={() => setType(t)}
                        >
                          {t}
                          {n > 0 && <em>{n}</em>}
                        </button>
                      );
                    })}
                  </span>
                  {holders.map((c) => (
                    <ChoiceRow
                      key={c.key}
                      choice={c}
                      today={today}
                      ticked={ticked.has(c.key)}
                      onTick={(on) => tick(c.key, on)}
                    />
                  ))}
                </>
              )}
            </div>
          )}
        </>
      )}

      {err && <p className="wb2-sherr">{err}</p>}

      <div className="wb2-cpfoot">
        {ticked.size > 0 && <em>{ticked.size === 1 ? "1 ticked" : `${ticked.size} ticked`}</em>}
        <button type="button" className="pbtn ghost" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="pbtn" disabled={ticked.size === 0 || busy} onClick={() => void add()}>
          {busy ? "Adding…" : "Add to job"}
        </button>
      </div>
    </div>
  );
}
