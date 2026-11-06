"use client";

import { useState, type CSSProperties, type MouseEvent } from "react";
import { Dialog } from "@/components/parts/dialog";
import { Button } from "@/components/parts/button";
import { Field, TextInput } from "@/components/parts/field";
import { Chooser } from "@/components/parts/chooser";
import { Fade } from "@/components/parts/fade";
import { Icon } from "@/components/shell/icon";
import { thrownWords } from "@/lib/stale-deploy";
import { BLOCK_LENGTHS_MIN, BLOCK_WHAT_MAX, BLOCK_WHERE_MAX, blockWrong, cleanWords, type PileBlock } from "@/lib/schedule/blocks";
import { makeScheduleBlock } from "@/app/actions/schedule-blocks";
import { clockWord, lengthWord, type DayAway } from "@/lib/schedule/board";

/* BLOCK OUT TIME on the Schedule (Isaac, 6 November 2026, "Build it" on
   https://claude.ai/artifact/9BSz3k2q6MYZbb7Ua7PhUL, option B): time off
   drawn as a booking's card whose box holds a clock on the soft grey, in a
   grey hairline, three lines (what, where, "Blocked out" and when); the form
   that makes one into Jobs (what, where, how long), in the inputs every
   other form uses; and what a placed block offers when it's pressed. */

const LENGTHS = BLOCK_LENGTHS_MIN.map((m) => ({ value: String(m), label: lengthWord(m) }));

/** When time off runs, on its card: "All day", or "3 to 4:30 pm". */
export const offWhen = (a: Pick<DayAway, "startMin" | "endMin" | "whole">) => (a.whole ? "All day" : `${clockWord(a.startMin)} to ${clockWord(a.endMin, true)}`);

/** The card's three lines, in the box's clock. */
function OffInner({ what, where, when }: { what: string; where: string | null; when: string }) {
  return (
    <>
      <span className="sc-cn">
        <Icon name="clock" size={16} />
      </span>
      <span className="sc-cb">
        <Fade className="sc-c1">{what}</Fade>
        {where ? <Fade className="sc-c2">{where}</Fade> : null}
        <span className="sc-c3">
          <b>Blocked out</b>
          <span>{when}</span>
        </span>
      </span>
    </>
  );
}

/** Time off on a person's row: a block made here opens what it offers; ServiceM8's own is only shown. */
export function OffCard({
  away,
  who,
  when,
  className,
  style,
  onOpen,
}: {
  away: DayAway;
  who: string;
  when: string;
  className: string;
  style: CSSProperties;
  /** a block made in HeyTiff, where the viewer may change it */
  onOpen?: () => void;
}) {
  const label = `${who}, ${away.word}${away.where ? `, ${away.where}` : ""}, ${when}`;
  const inner = <OffInner what={away.word} where={away.where ?? null} when={when} />;
  return onOpen ? (
    <button
      type="button"
      className={`${className} sc-card sc-card--off`}
      style={style}
      aria-label={label}
      onClick={(e: MouseEvent) => {
        /* while a job is held, a press on the row books it: the card lets it through */
        if (document.querySelector(".sc-holding")) return;
        e.stopPropagation();
        onOpen();
      }}
    >
      {inner}
    </button>
  ) : (
    <div className={`${className} sc-card sc-card--off`} style={style} aria-label={label} role="img">
      {inner}
    </div>
  );
}

/** A block in Jobs, waiting: the card to drag. */
export function PileCard({
  block,
  picked,
  onPick,
}: {
  block: PileBlock;
  picked: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      className={`sc-job sc-card sc-card--off${picked ? " sc-picked" : ""}`}
      draggable
      aria-pressed={picked}
      aria-label={`${block.what}${block.where ? `, ${block.where}` : ""}, ${lengthWord(block.minutes)}`}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", `block:${block.id}`);
        e.dataTransfer.effectAllowed = "copy";
        if (!picked) onPick();
      }}
      onClick={onPick}
    >
      <OffInner what={block.what} where={block.where} when={lengthWord(block.minutes)} />
      <span className="sc-grip" aria-hidden="true">
        <Icon name="grip" size={16} />
      </span>
    </button>
  );
}

/** Block out time: what, where and how long, into Jobs. */
export function BlockForm({ onClose, onMade }: { onClose: () => void; onMade: () => void }) {
  const [what, setWhat] = useState("");
  const [where, setWhere] = useState("");
  const [minutes, setMinutes] = useState("120");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const wrong = blockWrong({ ...cleanWords(what, where), minutes: Number(minutes) });
    if (wrong) {
      setError(wrong);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await makeScheduleBlock({ what, where, minutes: Number(minutes) });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onMade();
      onClose();
    } catch (e) {
      setError(thrownWords(e, "That didn't save. Try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      heading="Block out time"
      onClose={onClose}
      foot={
        <>
          <Button kind="second" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="main" onClick={() => void save()} disabled={saving}>
            {saving ? "Adding" : "Add to Jobs"}
          </Button>
        </>
      }
    >
      <form
        className="mk-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="What" error={error}>
          <TextInput value={what} maxLength={BLOCK_WHAT_MAX} onChange={(e) => setWhat(e.target.value)} data-autofocus />
        </Field>
        <Field label="Where">
          <TextInput value={where} maxLength={BLOCK_WHERE_MAX} onChange={(e) => setWhere(e.target.value)} />
        </Field>
        <Field label="How long">
          <Chooser aria-label="How long" options={LENGTHS} value={minutes} onChange={setMinutes} />
        </Field>
      </form>
    </Dialog>
  );
}

/** A placed block, pressed: back to Jobs, or off altogether. */
export function BlockDialog({
  away,
  who,
  day,
  onClose,
  onBack,
  onRemove,
}: {
  away: DayAway;
  who: string;
  day: string;
  onClose: () => void;
  onBack: () => void;
  onRemove: () => void;
}) {
  return (
    <Dialog
      heading={away.where ? `${away.word}, ${away.where}` : away.word}
      onClose={onClose}
      foot={
        <>
          <Button kind="second" onClick={onRemove}>
            Take it off
          </Button>
          <Button kind="main" onClick={onBack}>
            Back to Jobs
          </Button>
        </>
      }
    >
      <p>
        {who}, {day}, {offWhen(away)}
      </p>
    </Dialog>
  );
}
