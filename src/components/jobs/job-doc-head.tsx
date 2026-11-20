"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Button } from "@/components/parts/button";
import { Fade } from "@/components/parts/fade";
import { Menu, type MenuItem } from "@/components/parts/menu";
import { Dot, StateWord, type Hue, type Tone } from "@/components/parts/state";
import { Icon } from "@/components/shell/icon";
import { openInTab } from "@/components/shell/open-tabs";

/* A DOCUMENT'S HEAD, IN A TAB OF ITS OWN (the Price overhaul, 18 November
   2026: "Quote and invoice should open full screen", then the phone's quote,
   "the same on either system"). One row, where the job's head is a card and
   a map: the way back to the job ("‹ Job", as the phone's quote says it),
   the job's number in its colour, the client, the site and, for an
   invoice, which one it is, faded where they run out; then where it's up to as a state
   word (rule 17) and Actions (rule 53). The job's sections aren't here: the
   document's own tabs are under it. */

export type DocStage = {
  word: string;
  tone: Tone;
  undo?: (() => void) | null;
  /** the document's own actions, first in Actions: on a quote, what moved
      off the panel's one-button foot */
  actions?: readonly MenuItem[];
  act?: (key: string) => void;
};

export function JobDocHead({
  jobHref,
  number,
  client,
  site,
  what,
  hue,
  stage,
  actions,
  onAction,
}: {
  /** the job's own page, which the way back opens */
  jobHref: string;
  number: string | null;
  client: string;
  site: string | null;
  /** which invoice it is; none for a quote, whose proposal title is
      written to the customer and isn't a fact about the job (Isaac, 20
      November 2026, bug 57: "the line next to client name has included
      summary, also says your apartment") */
  what: string | null;
  hue: Hue;
  stage: DocStage | null;
  actions: readonly MenuItem[];
  onAction: (key: string) => void;
}) {
  const actRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <header className="jd-head">
      {/* the job's own tab where one holds it, so the job never has two (rule 11) */}
      <Link href={jobHref} className="jp-back jd-back" onClick={() => openInTab(jobHref, `${window.location.pathname}${window.location.search}`)}>
        <Icon name="chevL" size={16} />
        <span>Job</span>
      </Link>
      <div className={`jd-id jp-plate--${hue}`}>
        {number ? <span className="jp-num jd-num">{number}</span> : <Dot hue={hue} />}
        <b className="jd-client">{client}</b>
        <span className="jd-line">
          <Fade>{[site, what].filter(Boolean).join(", ")}</Fade>
        </span>
      </div>
      {stage && (
        <span className="jd-stage">
          <StateWord tone={stage.tone}>{stage.word}</StateWord>
          {stage.undo && (
            <Button kind="second" size={32} onClick={stage.undo} aria-label={`Undo ${stage.word.toLowerCase()}`}>
              Undo
            </Button>
          )}
        </span>
      )}
      {actions.length > 0 && (
        <span className="jp-acts">
          <Button ref={actRef} kind="second" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            Actions
            <span className="jp-chev" aria-hidden="true">
              <Icon name="chevD" size={16} />
            </span>
          </Button>
          <Menu
            anchor={actRef}
            open={open}
            onClose={() => setOpen(false)}
            onSelect={(key) => {
              setOpen(false);
              onAction(key);
            }}
            items={actions}
            label="Actions on this quote"
            align="end"
          />
        </span>
      )}
    </header>
  );
}
