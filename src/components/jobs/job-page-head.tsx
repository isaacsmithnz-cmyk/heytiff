"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/parts/button";
import { Fade } from "@/components/parts/fade";
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
       its dot;
     on the right, one second button, Actions, with a chevron, opening a
       white menu (rules 36, 53 and 54): what Add made first ("Add visit",
       "Add task"), then what's done to the job, then Open in ServiceM8
       (Isaac, 22 October 2026: one menu up top);
     then the seven section tabs, each saying what's in it (rule 31).

   No breadcrumb (6-revisions, 17 October): the way back is one word, not
   a path. The stages line is Overview's, not the head's.

   It draws what it's handed. What Add makes and what Actions does are the
   job card's own doors (job-sheet.tsx, in its page mode). */

/* the Add menu's items and Open in ServiceM8 ride in Actions under keys of
   their own, so none can be taken for one of the job's actions */
const ADD = "add:";
const SM8 = "open-in-servicem8";
/** "Visit" after Add reads "Add visit"; an acronym keeps its capitals ("Add SWMS"). */
const inSentence = (word: string) => (/^[A-Z]{2,}\b/.test(word) ? word : word.charAt(0).toLowerCase() + word.slice(1));

export type JobPageHeadProps = {
  /** the job's client, or its address where it has none */
  name: string;
  /** the job's number, in the plate's coloured box */
  number?: string | null;
  hue: Hue;
  /** ServiceM8's own page for the job, when there is one */
  sm8Href: string | null;
  add: { items: readonly MenuItem[]; onPick: (key: string) => void; disabled?: boolean; onReach?: () => void };
  actions: { items: readonly MenuItem[]; onPick: (key: string) => void };
  sections: readonly TabItem[];
  section: string;
  onSection: (key: string) => void;
};

export function JobPageHead({ name, number = null, hue, sm8Href, add, actions, sections, section, onSection }: JobPageHeadProps) {
  const actRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const chevron = (
    <span className="jp-chev" aria-hidden="true">
      <Icon name="chevD" size={16} />
    </span>
  );
  return (
    <header className="jp-head">
      <WayBack />
      <div className="jp-top">
        <div className={`jp-id jp-plate jp-plate--${hue}`}>
          {number ? <span className="jp-num">{number}</span> : <Dot hue={hue} />}
          <div className="jp-named">
            <h1 className="jp-name">
              <Fade>{name}</Fade>
            </h1>
          </div>
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
