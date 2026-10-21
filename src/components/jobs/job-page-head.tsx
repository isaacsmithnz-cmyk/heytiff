"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/parts/button";
import { Fade } from "@/components/parts/fade";
import { Menu, type MenuItem } from "@/components/parts/menu";
import { Dot, StateWord, type Hue, type Tone } from "@/components/parts/state";
import { SectionTabs, type TabItem } from "@/components/parts/tabs";
import { Icon } from "@/components/shell/icon";

/* A JOB PAGE'S HEAD (v2, step 5; the mock-ups v2-land-* and v2-leanC):

     the job's name;
     one grey line: its colour's dot, its kind, its number, its address,
       and where it stands, one word;
     on the right, one second button, Actions, with a chevron, opening a
       white menu (rules 36, 53 and 54): what Add made first ("Add visit",
       "Add task"), then what's done to the job, then Open in ServiceM8
       (Isaac, 22 October 2026: one menu up top);
     then the seven section tabs, each saying what's in it (rule 31).

   No breadcrumb: the open tab and Jobs in the sidebar say where you are
   (6-revisions, 17 October). The stages line is Overview's, not the head's.

   It draws what it's handed. What Add makes and what Actions does are the
   job card's own doors (job-sheet.tsx, in its page mode). */

/* the Add menu's items and Open in ServiceM8 ride in Actions under keys of
   their own, so none can be taken for one of the job's actions */
const ADD = "add:";
const SM8 = "open-in-servicem8";
/** "Visit" after Add reads "Add visit"; an acronym keeps its capitals ("Add SWMS"). */
const inSentence = (word: string) => (/^[A-Z]{2,}\b/.test(word) ? word : word.charAt(0).toLowerCase() + word.slice(1));

export type JobPageHeadProps = {
  name: string;
  hue: Hue;
  /** "Work order, Job 3209, 59 Woorarra Avenue, North Narrabeen" */
  facts: string;
  /** where the job stands; grey unless it needs a look or went wrong */
  stage: { word: string; tone: Tone } | null;
  /** ServiceM8's own page for the job, when there is one */
  sm8Href: string | null;
  add: { items: readonly MenuItem[]; onPick: (key: string) => void; disabled?: boolean; onReach?: () => void };
  actions: { items: readonly MenuItem[]; onPick: (key: string) => void };
  sections: readonly TabItem[];
  section: string;
  onSection: (key: string) => void;
};

export function JobPageHead({ name, hue, facts, stage, sm8Href, add, actions, sections, section, onSection }: JobPageHeadProps) {
  const actRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const chevron = (
    <span className="jp-chev" aria-hidden="true">
      <Icon name="chevD" size={16} />
    </span>
  );
  return (
    <header className="jp-head">
      <div className="jp-top">
        <div className="jp-id">
          <h1 className="jp-name">
            <Fade>{name}</Fade>
          </h1>
          <p className="jp-line">
            <Dot hue={hue} />
            <Fade className="jp-facts">{facts ? `${facts}.` : ""}</Fade>
            {/* grey is the line's own colour: a word that needs nothing of
                you is the line's last word; one that does wears its state */}
            {stage &&
              (stage.tone === "info" ? (
                <span className="jp-stage">{stage.word}</span>
              ) : (
                <StateWord tone={stage.tone} className="jp-stage">
                  {stage.word}
                </StateWord>
              ))}
          </p>
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
              setOpen((o) => !o);
            }}
          >
            Actions
            {chevron}
          </Button>
          <Menu
            anchor={actRef}
            open={open}
            onClose={() => setOpen(false)}
            onSelect={(key) => {
              setOpen(false);
              if (key === SM8) {
                if (sm8Href) window.open(sm8Href, "_blank", "noopener,noreferrer");
              } else if (key.startsWith(ADD)) add.onPick(key.slice(ADD.length));
              else actions.onPick(key);
            }}
            items={[
              ...add.items.map((it) => ({ ...it, key: `${ADD}${it.key}`, label: `Add ${inSentence(it.label)}`, disabled: it.disabled || add.disabled })),
              ...actions.items,
              ...(sm8Href ? [{ key: SM8, label: "Open in ServiceM8" }] : []),
            ]}
            label="Actions on this job"
            align="end"
          />
        </div>
      </div>
      <SectionTabs items={sections} current={section} onGo={onSection} ariaLabel="The job" idPrefix="jp-tab" />
    </header>
  );
}
