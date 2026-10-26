"use client";

/* HOW TO USE, a dialog (rule 36): the four moves, and that this is a
   planning tool, not advice. It opens by itself on a first visit, then from
   the button on the title row. */

import React from "react";
import { Button } from "@/components/parts/button";
import { Dialog } from "@/components/parts/dialog";
import { Tick } from "@/components/parts/tick";

const MOVES: [string, string][] = [
  ["Enter your numbers", "Staff and wages, business costs, vehicles, a risk buffer and your profit target. Simple takes totals; Detailed goes line by line."],
  ["Get your rates", "An install and a service rate an hour, for labour. Materials and parts are quoted on their own."],
  ["Compare", "What you charge now against break-even and the recommended rate."],
  ["Come back", "Wages and costs move. The calculator reminds you when it's time to look again."],
];

export function HelpDialog({ onClose }: { onClose: (dontShow: boolean) => void }) {
  const [dontShow, setDontShow] = React.useState(false);
  const close = () => onClose(dontShow);
  return (
    <Dialog
      heading="How to use the rate calculator"
      onClose={close}
      width={560}
      foot={
        <>
          <Tick label="Don't show this again" checked={dontShow} onChange={setDontShow} />
          <span className="rc-grow" />
          <Button kind="main" onClick={close}>Start</Button>
        </>
      }
    >
      <div className="rc-dlg">
        <ol className="rc-list">
          {MOVES.map(([t, d]) => (
            <li key={t}><span className="rc-list-w"><b>{t}</b><span>{d}</span></span></li>
          ))}
        </ol>
        <p>A planning tool, not financial, tax or legal advice. Every figure is an estimate from what you enter; check pricing and tax decisions with your accountant.</p>
      </div>
    </Dialog>
  );
}
