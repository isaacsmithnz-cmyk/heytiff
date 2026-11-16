"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/parts/button";
import { Menu, type MenuItem } from "@/components/parts/menu";
import { Dot, type Hue } from "@/components/parts/state";
import { SectionTabs, type TabItem } from "@/components/parts/tabs";
import { Icon } from "@/components/shell/icon";
import { WayBack } from "./way-back";

/* A JOB PAGE'S HEAD (v2, step 5; the mock-ups v2-land-* and v2-leanC):

     the way back, the screen you came from (way-back.tsx);
     the job's plate, as a Schedule card draws a booking (rule 19): its
       number in a solid box of the job's colour, white on it, and beside
       it the job's client, as Schedule, Jobs and the tab name a job (Isaac,
       5 November 2026, B on
       https://claude.ai/artifact/SJyEw4dkCb7MLp1bgCzypJ; 6 November, on
       https://claude.ai/artifact/Wtc1ZrZYkAp1aaedxSn2J4: "job number,
       client name, then underneath it, the site would show the address").
       The address is the Site card's and the scope Overview's. A job with
       no client is named by its address, and one with no number wears
       its dot. A long name wraps, to three lines at ServiceM8's 100
       characters, and never fades (Isaac, 14 November 2026, call 19,
       mock C: important text never fades);
     under the name, the site: its address, Site notes and their PO; and on
       the right, the map of it, fading into the words, pressed for the
       directions (Isaac, 16 November 2026: "The map can probably become
       like a hero", A on https://claude.ai/artifact/XbKL1kUEjP1YxP3qEAQnL6).
       One white card, the same on every tab. The stages are the Overview
       card's (job-facts);
     in its top right, over the map faded behind it, one second button,
       Actions, with a chevron, opening a white menu (rules 36, 53 and 54):
       the six things made most, Add visit, to do, task, quote, cost and
       purchase, and a work order to make, then More, which holds the rest:
       SWMS, Certificate, what's done to the job and Open in ServiceM8
       (Isaac, 16 November 2026: "a huge list of things… Should some of
       these things be minimized?");
     under them, on every tab, the job's description: the first sentence of
       its Scope, plain text at 16 with no mark, wrapping when it's long
       (Isaac, 14 November 2026, calls 22 and 19, mock B on
       https://claude.ai/artifact/6JjEtQm7aukwxDsHQfKY5e); a job with no
       Scope has no line;
     then the section tabs, each saying what's in it (rule 31).

   No breadcrumb (6-revisions, 17 October): the way back is one word, not
   a path.

   It draws what it's handed. What Add makes and what Actions does are the
   job card's own doors (job-sheet.tsx, in its page mode). */

/* the Add menu's items and Open in ServiceM8 ride in Actions under keys of
   their own, so none can be taken for one of the job's actions */
const ADD = "add:";
const SM8 = "open-in-servicem8";
const MORE = "more";
/** What Add makes that stays on Actions' first list; the rest of Add goes under More. */
const FIRST_ADDS = new Set(["visit", "todo", "task", "quote", "cost", "purchase"]);
/** What's done to the job that stays on the first list: a work order is the job's next step. */
const FIRST_ACTS = new Set(["work-order"]);
/** "Visit" after Add reads "Add visit"; an acronym keeps its capitals ("Add SWMS"). */
const inSentence = (word: string) => (/^[A-Z]{2,}\b/.test(word) ? word : word.charAt(0).toLowerCase() + word.slice(1));

export type JobPageHeadProps = {
  /** the job's client, or its address where it has none */
  name: string;
  /** what the job is, in one sentence: its Scope's description; none without a Scope */
  description?: string | null;
  /** the job's number, in the plate's coloured box */
  number?: string | null;
  /** the site under the name, its words and its map: none until the job is read */
  site?: { words: ReactNode; map: ReactNode } | null;
  hue: Hue;
  /** ServiceM8's own page for the job, when there is one */
  sm8Href: string | null;
  add: { items: readonly MenuItem[]; onPick: (key: string) => void; disabled?: boolean; onReach?: () => void };
  actions: { items: readonly MenuItem[]; onPick: (key: string) => void };
  sections: readonly TabItem[];
  section: string;
  onSection: (key: string) => void;
};

export function JobPageHead({ name, description = null, number = null, site = null, hue, sm8Href, add, actions, sections, section, onSection }: JobPageHeadProps) {
  const actRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  /* More swaps the list for the rest, and a fresh open starts at the six */
  const [more, setMore] = useState(false);
  const addAll = add.items.map((it) => ({ ...it, key: `${ADD}${it.key}`, label: `Add ${inSentence(it.label)}`, disabled: it.disabled || add.disabled }));
  const firstList = [
    ...addAll.filter((it) => FIRST_ADDS.has(it.key.slice(ADD.length))),
    ...actions.items.filter((it) => FIRST_ACTS.has(it.key)),
  ];
  const rest = [
    ...addAll.filter((it) => !FIRST_ADDS.has(it.key.slice(ADD.length))),
    ...actions.items.filter((it) => !FIRST_ACTS.has(it.key)),
    ...(sm8Href ? [{ key: SM8, label: "Open in ServiceM8" }] : []),
  ];
  const listed = more || firstList.length === 0 ? rest : [...firstList, ...(rest.length ? [{ key: MORE, label: "More", rule: true, count: <Icon name="chevR" size={16} /> }] : [])];
  const chevron = (
    <span className="jp-chev" aria-hidden="true">
      <Icon name="chevD" size={16} />
    </span>
  );
  return (
    <header className="jp-head">
      <WayBack />
      <div className="jp-top jp-top--site">
        {site?.map}
        <div className="jp-words">
          <div className={`jp-id jp-plate jp-plate--${hue}`}>
            {number ? <span className="jp-num">{number}</span> : <Dot hue={hue} />}
            <div className="jp-named">
              <h1 className="jp-name">{name}</h1>
            </div>
          </div>
          {site?.words}
        </div>
        <div className="jp-acts">
          <Button
            ref={actRef}
            kind="second"
            aria-haspopup="menu"
            aria-expanded={open}
            onPointerEnter={add.onReach}
            onFocus={add.onReach}
            onClick={() => {
              add.onReach?.();
              setMore(false);
              setOpen((o) => !o);
            }}
          >
            Actions
            {chevron}
          </Button>
          <Menu
            key={more ? "more" : "first"}
            anchor={actRef}
            open={open}
            stay
            onClose={() => setOpen(false)}
            onSelect={(key) => {
              if (key === MORE) {
                setMore(true);
                return;
              }
              setOpen(false);
              actRef.current?.focus({ preventScroll: true });
              if (key === SM8) {
                if (sm8Href) window.open(sm8Href, "_blank", "noopener,noreferrer");
              } else if (key.startsWith(ADD)) add.onPick(key.slice(ADD.length));
              else actions.onPick(key);
            }}
            items={listed}
            label="Actions on this job"
            align="end"
          />
        </div>
      </div>
      {description ? <p className="jp-desc">{description}</p> : null}
      <SectionTabs items={sections} current={section} onGo={onSection} ariaLabel="The job" idPrefix="jp-tab" />
    </header>
  );
}
