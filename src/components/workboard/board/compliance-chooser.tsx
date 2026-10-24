"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/parts/button";
import { Dialog } from "@/components/parts/dialog";
import { Empty, Loading, Wrong } from "@/components/parts/states";
import { StateWord, type Tone } from "@/components/parts/state";
import { ViewTabs } from "@/components/parts/tabs";
import { Tick } from "@/components/parts/tick";
import {
  choiceBlock,
  choiceFacts,
  choiceStateWord,
  holdersOf,
  licenceTypes,
  type PaperChoice,
  type PaperChoices,
} from "@/lib/compliance/papers";

/* LICENCES AND INSURANCE — a door in the Documents section's Add, opened as
   the v2 dialog (the mock of 25 October 2026, frame 7): the business's
   papers and the team's tickets, each a tick row with its state word on the
   right, and Add to job at the foot beside how many are ticked.

   TWO SIDES, each only for someone who may add it, as soft tabs when there
   are both. The team's tickets are grouped by licence, the trade tickets
   first (licenceTypes says why), and under each the people holding it, the
   ones booked on this job at the top.

   A PAPER THAT CAN'T GO ON A JOB SAYS WHY INSTEAD OF OFFERING A BOX: an
   expired certificate is not something to hand a customer, and a card with no
   paper under it has nothing to hand them. Ticks survive switching sides;
   the count beside Add to job is the whole of them. */

const TONE: Record<"ok" | "warn" | "bad" | "mute", Tone> = { ok: "good", warn: "look", bad: "wrong", mute: "info" };

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
  const facts = [choice.booked ? "Booked on this job" : null, choiceFacts(choice)].filter(Boolean).join(", ");
  const title = choice.kind === "staff" ? (choice.person ?? choice.name) : choice.name;
  return (
    <li className="pt-row wb2-cprow">
      <Tick
        className="wb2-cptick"
        checked={choice.onJob || ticked}
        disabled={!!block}
        onChange={onTick}
        label={
          <span className="wb2-cpname">
            <b>{title}</b>
            {facts && <span>{facts}</span>}
          </span>
        }
      />
      <span className="pt-row-end">
        <StateWord tone={TONE[state.tone]}>{state.word}</StateWord>
      </span>
    </li>
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
  const [side, setSide] = useState<"company" | "staff" | null>(null);
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
  /* the side in view: the one chosen, else the first this viewer may add */
  const sides = [choices?.company ? ("company" as const) : null, choices?.staff ? ("staff" as const) : null].filter(
    (s): s is "company" | "staff" => s !== null
  );
  const shown = side && sides.includes(side) ? side : (sides[0] ?? null);

  const tick = (key: string, on: boolean) =>
    setTicked((cur) => {
      const next = new Set(cur);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const add = async () => {
    if (ticked.size === 0 || busy) return;
    setBusy(true);
    setErr(null);
    const why = await onAdd([...ticked]).catch(() => "Couldn't add them to the job.");
    setBusy(false);
    if (why) setErr(why);
    else onClose();
  };

  const rowOf = (c: PaperChoice) => (
    <ChoiceRow key={c.key} choice={c} today={today} ticked={ticked.has(c.key)} onTick={(on) => tick(c.key, on)} />
  );

  return (
    <Dialog
      heading="Licences and insurance"
      width={560}
      onClose={onClose}
      foot={
        <>
          <span className="wb2-cpcount">{ticked.size === 1 ? "1 ticked" : ticked.size > 1 ? `${ticked.size} ticked` : ""}</span>
          <Button disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button kind="main" disabled={ticked.size === 0 || busy} aria-busy={busy || undefined} onClick={() => void add()}>
            {busy ? "Adding to the job" : "Add to job"}
          </Button>
        </>
      }
    >
      {failed ? (
        <Wrong word="Couldn't read the licences and insurance" means="Close this and open it again." />
      ) : choices === null ? (
        <Loading what="Reading the licences and insurance" />
      ) : (
        <div className="wb2-cpick">
          {sides.length > 1 && (
            <ViewTabs
              ariaLabel="Whose papers"
              items={[
                { key: "company", label: "Company" },
                { key: "staff", label: "Staff licences" },
              ]}
              current={shown ?? "company"}
              onGo={(key) => setSide(key as "company" | "staff")}
            />
          )}

          {shown === "company" &&
            choices.company &&
            (choices.company.length === 0 ? (
              <Empty what="No licences or insurance on file" action={null} />
            ) : (
              <ul className="pt-rows" aria-label="Company">
                {choices.company.map(rowOf)}
              </ul>
            ))}

          {shown === "staff" &&
            choices.staff &&
            (types.length === 0 ? (
              <Empty what="No staff licences on file" action={null} />
            ) : (
              types.map((t) => (
                <section key={t} className="wb2-cpgroup" aria-label={t}>
                  <h3 className="wb2-cpgh">{t}</h3>
                  <ul className="pt-rows">{holdersOf(choices.staff ?? [], t).map(rowOf)}</ul>
                </section>
              ))
            ))}
        </div>
      )}

      {err && <p className="wb2-cperr">{err}</p>}
    </Dialog>
  );
}
