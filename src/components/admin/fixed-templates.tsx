/* THE TEMPLATES WRITTEN INTO HEYTIFF — each as it reads, from the same data
   the documents are drawn from, so this page can't say one thing while a
   quote or a handover sheet says another.

   No "use client": nothing here moves. Words in brackets are filled in from
   the job. */

import { EXTRA_NOTES, EXTRA_NOTE_KEYS, PRICING_WORDS } from "@/lib/quotes/proposal";
import { PAYMENT_PRESETS, PAYMENT_PRESET_KEYS } from "@/lib/quotes/payment";
import { CHECKLIST, CHECKLIST_KEYS, GROUP_ORDER } from "@/lib/quotes/checklist";
import { DEFAULT_CHECKLIST } from "@/lib/workboard/stages";
import { defaultMessage, defaultSubject } from "@/lib/compliance/papers";

const NOT_YET = "You can't change these here yet.";

/** A heading and its lines. */
function Part({ title, note, lines }: { title: string; note?: string; lines: readonly string[] }) {
  return (
    <div className="sws-grp">
      <div className="sw-gh">
        <b>{title}</b>
        {note && <span>{note}</span>}
      </div>
      {lines.map((line, i) => (
        <p key={i} className="sw-text">
          {line}
        </p>
      ))}
    </div>
  );
}

/** The checklist's sections, in the order they're first named. */
function sections(): { section: string; labels: string[] }[] {
  const out: { section: string; labels: string[] }[] = [];
  for (const item of DEFAULT_CHECKLIST) {
    const at = out.find((s) => s.section === item.section);
    if (at) at.labels.push(item.label);
    else out.push({ section: item.section, labels: [item.label] });
  }
  return out;
}

export function QuoteTemplate() {
  const pct = (p: number | null) => (p === null ? "" : `${p}%: `);
  return (
    <div className="sws">
      <p className="sws-lede">{`Tiff writes each quote's scope from what was said about the job, then adds the notes and payment terms below. ${NOT_YET}`}</p>
      <Part
        title="The quote"
        lines={[
          "Air Conditioning Scope – [site address]",
          "Hi [first name], [why they're getting it, and the options to choose from]",
          "[Each option: what's installed and how, one line each, with pros and cons when the options differ]",
          `[Priced one of three ways: ${Object.values(PRICING_WORDS).join("; ").toLowerCase()}]`,
          "[Extras they can add, and allowances for choices not made yet]",
        ]}
      />
      <Part title="Notes" note="Added when the job needs them" lines={EXTRA_NOTE_KEYS.flatMap((k) => [`${EXTRA_NOTES[k].heading}: ${EXTRA_NOTES[k].lines.join(" ")}`])} />
      {PAYMENT_PRESET_KEYS.map((k) => (
        <Part
          key={k}
          title={`Payment terms: ${PAYMENT_PRESETS[k].label}`}
          lines={PAYMENT_PRESETS[k].stages.map((s) => `${pct(s.percent)}${s.when}`)}
        />
      ))}
      {GROUP_ORDER.map((g) => {
        const topics = CHECKLIST_KEYS.filter((k) => CHECKLIST[k].group === g);
        if (topics.length === 0) return null;
        return (
          <Part
            key={g}
            title={`Site checklist: ${g}`}
            note={g === GROUP_ORDER[0] ? "Checked before the quote goes out" : undefined}
            lines={topics.map((k) => {
              const t: { label: string; question: string; choices: readonly string[] } = CHECKLIST[k];
              return t.choices.length ? `${t.question} (${t.choices.join(", ")})` : t.question;
            })}
          />
        );
      })}
    </div>
  );
}

export function HandoverTemplate() {
  const handover = DEFAULT_CHECKLIST.filter((i) => i.section === "Handover").map((i) => i.label);
  return (
    <div className="sws">
      <p className="sws-lede">{`Printed from the project when the job is handed over, on your letterhead. ${NOT_YET}`}</p>
      <Part title="Handover sheet" lines={["[Project name]", "Stage, promised finish, defects period ends, contract total"]} />
      <Part title="Equipment installed" lines={["[Each unit: equipment, model, serial, where, manual]"]} />
      <Part title="Scope of the installation" lines={["[The project's scope]"]} />
      <Part title="Commissioning record" lines={["[The readings taken at commissioning]"]} />
      <Part title="Handover checks" note="From the project checklist" lines={handover} />
      <Part title="Signed" lines={["Handed over by: name, signature, date", "Received for the client: name, signature, date"]} />
    </div>
  );
}

export function DocumentsEmailTemplate() {
  return (
    <div className="sws">
      <p className="sws-lede">{`Sent from the job card's Documents with the files picked. The subject and message can be changed on each send; these are what they start as. ${NOT_YET}`}</p>
      <Part title="Subject" lines={[defaultSubject({ number: "[job number]", address: "[site address]" })]} />
      <Part title="Heading" lines={["Documents from [your business]"]} />
      <Part title="Message" lines={defaultMessage("[your name]", "[your business]").split(/\n+/)} />
      <Part title="Below the message" lines={["Attached: [each file]", "Reply to this email to reach [your name]."]} />
    </div>
  );
}

export function ProjectChecklistTemplate() {
  return (
    <div className="sws">
      <p className="sws-lede">{`Every new project starts with these, and each project's own list can be changed on the project. The Handover items print on the handover sheet. ${NOT_YET}`}</p>
      {sections().map((s) => (
        <Part key={s.section} title={s.section} lines={s.labels} />
      ))}
    </div>
  );
}
