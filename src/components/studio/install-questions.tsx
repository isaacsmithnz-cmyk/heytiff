/* The install questions (docs/studio-zones-and-systems.md, Install): once a
   system's units are on the plan, a short run of questions asks how it goes
   in, and every answer puts its parts on the equipment list beside it as it
   is given. The engine is install.ts; this is its screen.

   The whole run is on the page — it is eight short questions, not eight
   screens — and it is still asked in order: what has been answered and the
   question being asked stand at full strength, and everything past it is
   greyed and cannot be ticked until its turn. Nothing is hidden, so you can
   see the run you are in, and nothing is ever stuck, because every question
   takes Not sure yet.

   Every question takes more than one answer. Where only one can happen in
   the end, two ticks mean make provisions for both: the row says so, both
   lots of parts go on the list marked Confirm on the day, and the installer
   gets the note. An answer's follow-ups appear under it while it is ticked.

   Like the builder it edits a draft: Done applies it as one undo step,
   Discard changes drops it, and nothing waits on an answer. */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { DesignDocument } from "@/lib/studio/document";
import type { DataPack } from "@/lib/studio/packs/schema";
import { allocationsOf, hasAllocations } from "@/lib/studio/allocations";
import { KIND_WORD, systemKind } from "@/lib/studio/zones";
import { brandName } from "@/lib/studio/verdict";
import {
  answerInstall,
  askedQuestions,
  equipmentList,
  installAnswers,
  installQuestions,
  NOT_SURE,
  type EquipmentGroup,
  type EquipmentRow,
  type InstallGroup,
  type InstallQuestion,
} from "@/lib/studio/install";

const GROUPS: InstallGroup[] = ["Outdoor", "Indoor units", "Electrical"];
const EQUIPMENT_GROUPS: EquipmentGroup[] = ["Units", "Mounting", "Controls", "Electrical", "Pipework"];

function BoxGlyph({ on }: { on: boolean }) {
  return (
    <span className={`ds-iq-box${on ? " on" : ""}`} aria-hidden="true">
      {on && (
        <svg width="10" height="10" viewBox="0 0 16 16">
          <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      )}
    </span>
  );
}

export function InstallQuestions({
  doc,
  pack,
  systemId,
  onCommit,
  onClose,
}: {
  doc: DesignDocument;
  pack: DataPack;
  systemId: string;
  /** Done: the answered design, as one change */
  onCommit: (next: DesignDocument) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<DesignDocument>(doc);
  const dirty = draft !== doc;
  const sys = draft.systems.find((s) => s.id === systemId) ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !dirty) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, onClose]);

  if (!sys) return null;

  const answers = installAnswers(draft, sys);
  const questions = installQuestions(draft, pack, sys);
  const list = equipmentList(draft, pack, sys);
  /* Where the run is up to. The whole run is on the page, but it is asked in
     order: the first question with no tick is the one being asked, and the
     UNANSWERED ones past it are greyed until their turn. An answer already
     given is never greyed, wherever it sits — going back to change one is
     the whole reason for keeping the run on the page. */
  const run = askedQuestions(draft, pack, sys);
  const asking = run.findIndex((q) => !(answers[q.id] ?? []).length);
  const ahead = (id: string): boolean =>
    asking >= 0 && !(answers[id] ?? []).length && run.findIndex((q) => q.id === id) > asking;
  const units = hasAllocations(sys) ? allocationsOf(sys).filter((a) => a.model) : [];
  const kind = systemKind(draft, sys);
  const outdoor = units.find((a) => a.role === "odu");
  const outdoorRow = outdoor ? pack.outdoor_units.find((u) => u.model === outdoor.model) : null;
  const headCount = units.filter((a) => a.role === "idu").length;

  const toggle = (question: InstallQuestion, optionId: string) => {
    const ticks = answers[question.id] ?? [];
    const next = ticks.includes(optionId) ? ticks.filter((t) => t !== optionId) : [...ticks, optionId];
    setDraft((d) => answerInstall(d, sys.id, question.id, next));
  };

  /* What the person is about to stand up or hang on a wall: the model, what
     it measures and what it weighs, so the bracket and the base are picked
     against the real thing. All three come off the pack's row. */
  const groupSub = (group: InstallGroup): string => {
    if (group === "Electrical") return outdoorRow?.phase ? `${outdoorRow.phase} phase` : "";
    if (group === "Outdoor") {
      if (!outdoorRow) return "";
      const { width_mm: w, depth_mm: d, height_mm: h, weight_kg: kg } = outdoorRow;
      const size = w && d && h ? `${w} W × ${d} D × ${h} H mm` : "";
      return [outdoorRow.model, size, kg ? `${kg} kg` : ""].filter(Boolean).join(", ");
    }
    return headCount === 1 ? "1 indoor unit" : `${headCount} indoor units`;
  };

  const renderQuestion = (question: InstallQuestion, depth: number) => {
    const ticks = answers[question.id] ?? [];
    const notSure = ticks.length === 1 && ticks[0] === NOT_SURE;
    const provisions = question.exclusive && ticks.length >= 2;
    const waits = ahead(question.id);
    return (
      <div
        key={question.id}
        className={`${depth ? "ds-iq-subw" : "ds-iq-qw"}${waits ? " ahead" : ""}`}
      >
        <div className={`ds-iq-row${depth ? " sub" : ""}`}>
          <div>
            <div className="ds-iq-q">{question.text}</div>
            {question.hint && <div className="ds-iq-hint">{question.hint}</div>}
          </div>
          <div className="ds-iq-answer">
            <div className="ds-iq-choices" role="group" aria-label={question.text}>
              {question.options.map((option) => {
                const on = ticks.includes(option.id);
                return (
                  <button
                    key={option.id}
                    className={`ds-iq-choice${on ? " on" : ""}`}
                    role="checkbox"
                    aria-checked={on}
                    disabled={waits}
                    onClick={() => toggle(question, option.id)}
                  >
                    <BoxGlyph on={on} />
                    <span className="ds-iq-choice-l">
                      {option.label}
                      {option.sub && <span className="ds-iq-choice-sub">{option.sub}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            {provisions && (
              <div className="ds-iq-provisions">
                Make provisions for both. <b>Confirm on the day.</b>
              </div>
            )}
            {notSure && (
              <div className="ds-iq-provisions">
                It stays on the list. <b>Confirm on the day.</b>
              </div>
            )}
          </div>
        </div>
        {question.options
          .filter((option) => ticks.includes(option.id))
          .flatMap((option) => option.followUps ?? [])
          .map((followUp) => renderQuestion(followUp, depth + 1))}
      </div>
    );
  };

  const rowsIn = (group: EquipmentGroup): EquipmentRow[] => list.rows.filter((r) => r.group === group);

  return createPortal(
    <div className="ds-sb-scrim" onMouseDown={(e) => e.target === e.currentTarget && !dirty && onClose()}>
      <div className="ds-sb ds-iq" role="dialog" aria-modal="true" aria-label="Install questions">
        <div className="ds-iq-head">
          <span className="ds-iq-title">Install questions</span>
          <span className="ds-iq-rule" aria-hidden="true" />
          <div className="ds-iq-stats">
            <div className="ds-iq-stat">
              <span className="k">System</span>
              <span className="v">{sys.name}</span>
            </div>
            <div className="ds-iq-stat">
              <span className="k">Brand</span>
              <span className="v">{brandName(pack, sys.brand)}</span>
            </div>
            <div className="ds-iq-stat">
              <span className="k">Type</span>
              <span className="v">{KIND_WORD[kind]}</span>
            </div>
            <div className="ds-iq-stat">
              <span className="k">Units</span>
              <span className="v num">{units.length}</span>
            </div>
            <div className="ds-iq-stat">
              <span className="k">Answered</span>
              <span className="v num">
                {list.answered} of {list.total}
              </span>
            </div>
            {list.onTheDay > 0 && (
              <div className="ds-iq-stat">
                <span className="k">On the day</span>
                <span className="v num warn">{list.onTheDay}</span>
              </div>
            )}
          </div>
          <button className="ds-sb-x" onClick={onClose} aria-label="Close install questions">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
            </svg>
          </button>
        </div>

        <div className="ds-iq-body">
          <div className="ds-iq-qs">
            {GROUPS.map((group) => {
              const mine = questions.filter((q) => q.group === group);
              if (!mine.length) return null;
              const sub = groupSub(group);
              return (
                <section key={group} className="ds-iq-group" aria-label={group}>
                  <div className={`ds-iq-gh${mine.every((q) => ahead(q.id)) ? " ahead" : ""}`}>
                    {group}
                    {sub && <span className="ds-iq-gsub">{sub}</span>}
                  </div>
                  {mine.map((q) => renderQuestion(q, 0))}
                </section>
              );
            })}
          </div>

          <aside className="ds-iq-eq" aria-label="Equipment list">
            <div className="ds-iq-eh">Equipment list</div>
            {EQUIPMENT_GROUPS.map((group) => {
              const rows = rowsIn(group);
              if (!rows.length) return null;
              return (
                <div key={group} className="ds-iq-eg">
                  <div className="ds-iq-egh">{group === "Pipework" ? "Pipework, from the plan" : group}</div>
                  {rows.map((row, i) => (
                    <div key={`${row.name}-${row.model ?? ""}-${i}`} className={`ds-iq-er${row.waiting ? " waiting" : ""}`}>
                      <span className="ds-iq-er-n">
                        {row.name}
                        {row.model && row.model !== row.name && (
                          <span className="ds-iq-er-m">{row.model}</span>
                        )}
                      </span>
                      <span className="ds-iq-er-v num">
                        {row.waiting ? "Waiting on an answer" : (row.value ?? (row.qty != null ? String(row.qty) : ""))}
                      </span>
                      {row.why && <span className="ds-iq-er-why">{row.why}</span>}
                      {row.onTheDay && <span className="ds-iq-er-day">Confirm on the day</span>}
                    </div>
                  ))}
                </div>
              );
            })}
            {list.notes.length > 0 && (
              <div className="ds-iq-note">
                <b>Note for the installer</b>
                {list.notes.map((n) => (
                  <p key={n}>{n}</p>
                ))}
              </div>
            )}
          </aside>
        </div>

        <div className="ds-sb-foot">
          <span className="ds-sb-spring" />
          <button className="ds-sb-btn" onClick={onClose}>
            Discard changes
          </button>
          <button className="ds-sb-btn primary" onClick={() => (dirty ? onCommit(draft) : onClose())}>
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
