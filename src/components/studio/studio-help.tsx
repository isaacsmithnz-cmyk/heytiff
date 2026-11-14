"use client";

/* HOW TO DESIGN: the Help button at the plan's foot opens the Studio's
   eight steps and its keys, the step you're on marked off the design
   (lib/studio/help-steps.ts). It stays open while you work; ✕ or Help
   closes it (Isaac, 13 November 2026: "Build it" to the mock). */

import { useMemo } from "react";
import { Icon } from "@/components/shell/icon";
import type { DataPack } from "@/lib/studio/packs/schema";
import type { DesignDocument } from "@/lib/studio/document";
import { HELP_KEYS, helpSteps } from "@/lib/studio/help-steps";

export function StudioHelp({
  doc,
  pack,
  onClose,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  onClose: () => void;
}) {
  const steps = useMemo(() => helpSteps(doc, pack), [doc, pack]);
  return (
    <section className="ds-help" role="dialog" aria-modal="false" aria-labelledby="ds-help-title">
      <header className="ds-help-head">
        <h2 id="ds-help-title">How to design</h2>
        <button type="button" className="ds-help-close" aria-label="Close" onClick={onClose}>
          <Icon name="x" size={16} />
        </button>
      </header>
      <ol className="ds-help-steps">
        {steps.map((s, i) => (
          <li key={s.title} className={`ds-help-step ${s.state}`} aria-current={s.state === "now" ? "step" : undefined}>
            <span className="ds-help-n" aria-label={s.state === "done" ? "Done" : undefined}>
              {s.state === "done" ? <Icon name="check" size={18} /> : i + 1}
            </span>
            <div>
              <div className="ds-help-t">{s.title}</div>
              {(s.state === "now" || s.state === "todo") && <div className="ds-help-l">{s.line}</div>}
            </div>
          </li>
        ))}
      </ol>
      <div className="ds-help-keys">
        <h3>On the plan</h3>
        <dl>
          {HELP_KEYS.map(([k, what]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
