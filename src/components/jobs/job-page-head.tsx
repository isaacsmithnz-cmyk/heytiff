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
     on the right, three second buttons: Open in ServiceM8, Add and Actions,
       the last two with a chevron, each opening a white menu (rules 36, 53
       and 54);
     then the seven section tabs, each saying what's in it (rule 31).

   No breadcrumb: the open tab and Jobs in the sidebar say where you are
   (6-revisions, 17 October). The stages line is Overview's, not the head's.

   It draws what it's handed. What Add makes and what Actions does are the
   job card's own doors (job-sheet.tsx, in its page mode). */

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
  const addRef = useRef<HTMLButtonElement>(null);
  const actRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<"add" | "actions" | null>(null);
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
          {sm8Href && (
            <Button kind="second" href={sm8Href} target="_blank" rel="noopener noreferrer">
              Open in ServiceM8
            </Button>
          )}
          <Button
            ref={addRef}
            kind="second"
            icon="plus"
            disabled={add.disabled}
            aria-haspopup="menu"
            aria-expanded={open === "add"}
            onPointerEnter={add.onReach}
            onFocus={add.onReach}
            onClick={() => {
              add.onReach?.();
              setOpen((o) => (o === "add" ? null : "add"));
            }}
          >
            Add
            {chevron}
          </Button>
          <Menu
            anchor={addRef}
            open={open === "add"}
            onClose={() => setOpen(null)}
            onSelect={(key) => {
              setOpen(null);
              add.onPick(key);
            }}
            items={add.items}
            label="Add to this job"
            align="end"
          />
          <Button
            ref={actRef}
            kind="second"
            aria-haspopup="menu"
            aria-expanded={open === "actions"}
            onClick={() => setOpen((o) => (o === "actions" ? null : "actions"))}
          >
            Actions
            {chevron}
          </Button>
          <Menu
            anchor={actRef}
            open={open === "actions"}
            onClose={() => setOpen(null)}
            onSelect={(key) => {
              setOpen(null);
              actions.onPick(key);
            }}
            items={actions.items}
            label="Actions on this job"
            align="end"
          />
        </div>
      </div>
      <SectionTabs items={sections} current={section} onGo={onSection} ariaLabel="The job" idPrefix="jp-tab" />
    </header>
  );
}
