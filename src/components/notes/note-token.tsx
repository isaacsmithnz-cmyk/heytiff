"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import { DictClock, LevelBars, LiveWords, appendSpoken, useDictation } from "./dictation";
import { useNoteFlow, type NoteFlow } from "./note-flow";
import { useNoteScope } from "./note-context";
import { Cascade, JobPicker, ReviewRows, nothingTicked } from "./review-card";
import { describeJob } from "@/lib/workboard/note-match";
import { sniff } from "@/lib/notes/sniff";
import { TiffMark } from "./tiff-mark";

/* ONE TOKEN, EVERYWHERE.

   Five controls used to do some subset of "hear a person and do something
   with the words": a pill that routed, a box that appended, a one-liner that
   appended, a bridge button that carried text from the second to the first,
   and — on most of the app — nothing at all. This is all of them.

   THE ONLY THING THAT VARIES IS POSTURE, and posture is about where the
   token is standing, not about what it can do:

     strip    a row that lives with the notes it joins. Same flow, but the
              review grows in place instead of covering the job.
     field    a textarea with the token on it. Fills the box and shuts up;
              only offers to route when the words smell actionable.
     line     the same, one line, commits an item at a time.

   WHAT IT DOES WITH THE WORDS comes from context (./note-context): on a job
   card the note lands on that job, anywhere else it's a universal note taker
   that falls through to your own notes. No caller passes a target.

   THE CORNER TOKEN IS NOT IN HERE ANY MORE. It was the `capsule` posture — a
   keyboard|mic pill mounted by two workboard screens — and it has become the
   Tiff button in ./tiff-button, which stands in the app FRAME and is on every
   screen rather than two. The postures left are the ones that belong to a
   place on a page; the corner belongs to the frame.

   THE MIC IS ALWAYS AN ENHANCEMENT. No key, no permission, no MediaRecorder —
   every posture is still a control you can type into. */

export type Posture = "strip" | "field" | "line" | "debrief";

/* ── the surface: ribbon + whatever the stage calls for ── */

function Ribbon({ flow }: { flow: NoteFlow }) {
  const { stage, chosenJob } = flow;
  return (
    <div className="wb2-capribbon">
      {stage === "recording" ? (
        <span className="wb2-recdot" aria-hidden="true" />
      ) : stage === "sorting" || stage === "transcribing" || (stage === "answer" && flow.asking) ? (
        <span className="wb2-spin" aria-hidden="true" />
      ) : stage === "answer" ? (
        <Icon name="sparkles" size={16} />
      ) : (
        <Icon name="note" size={16} />
      )}
      <b>
        {stage === "recording"
          ? "Recording"
          : stage === "transcribing"
            ? "Reading it back"
            : stage === "answer"
              ? flow.asking
                ? "Looking it up"
                : "Answer"
              : stage === "review"
                ? "Check it before it saves"
                : stage === "sorting"
                  ? "Sorting it out"
                  : flow.debrief
                    ? "Debrief"
                    : /* The button's own words, not "Add a note" — every
                         posture routes questions as readily as notes, and
                         the title was the last thing still claiming
                         otherwise. */
                      "Ask or tell Tiff"}
      </b>
      {flow.debrief ? (
        <span className="wb2-chip">Tasks, knowledge &amp; your notes</span>
      ) : flow.targetLabel ? (
        /* THE TAG. What the screen underneath handed up, and the note lands
           on it — but standing on a job card is not the same as talking about
           that job, so it comes off. Dropping it is a per-capture thing; the
           next time you open this, the tag is back. */
        <span className="wb2-chip blue wb2-aim">
          {flow.targetLabel}
          <button
            type="button"
            className="wb2-aimx"
            onClick={flow.dropAim}
            title="This isn't about that — take the tag off"
            aria-label={`Not about ${flow.targetLabel} — take the tag off`}
          >
            <Icon name="x" size={11} />
          </button>
        </span>
      ) : (
        <span className="wb2-chip">{chosenJob ? chosenJob.clientName : "General note"}</span>
      )}
      {stage === "recording" && <DictClock seconds={flow.dict.seconds} />}
      <button className="wb2-ico" onClick={flow.close} title="Discard" aria-label="Discard">
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

/* ── THE DEFAULT SWITCH ──

   Isaac wanted the preference SAID OUT LOUD rather than inferred from which
   button you last pressed: a switch that reads "Default", with Talk and Type
   on it, so what the Tiff button will do next time is never a thing you have
   to remember. That label is also what makes storing the preference safe at
   all — see ./capture-default.

   IT IS ONE CONTROL DOING ONE THING, not two. Flipping it sets the default
   AND puts you in that mode now, because the alternative is a row carrying
   both a "Talk" button and a Talk segment that don't do the same thing.
   Switching to Talk starts listening; switching to Type hands the words over
   to the box (never discarding them — see `handOver` in ./dictation).

   IT ONLY APPEARS WHERE THE DEFAULT APPLIES. Spotted live 2026-08-10: the
   switch was in the shared body, so the DEBRIEF sheet wore it too — a sheet
   that opens from its own two-door capsule and never consults the stored
   mode. It sat there reading "DEFAULT · Talk" above a text box, promising
   something that surface does not do, and pressing it would have silently
   rewritten the Tiff button's default from a screen with no authority over
   it. Everywhere but the Tiff button's sheet, the same choice is offered as
   what it actually is there: a one-off, in `ModeControl` below.

   Absent where the deployment cannot hear: a choice with one option is not a
   choice, it is furniture. */
function DefaultSwitch({ flow }: { flow: NoteFlow }) {
  const talk = flow.mode === "talk";
  return (
    <span className="wb2-modesw">
      <span className="wb2-modelbl" id="wb2-modelbl">
        Default
      </span>
      <span className={"wb2-modeseg" + (talk ? "" : " type")} role="group" aria-labelledby="wb2-modelbl">
        {/* The thumb is decoration over the two real buttons — it slides,
            they stay hit-targets. */}
        <span className="wb2-modethumb" aria-hidden="true" />
        <button
          type="button"
          className="wb2-modeopt"
          aria-pressed={talk}
          onClick={() => {
            flow.chooseMode("talk");
            if (!flow.dict.recording) flow.dict.start();
          }}
        >
          <Icon name="mic" size={13} />
          Talk
        </button>
        <button
          type="button"
          className="wb2-modeopt"
          aria-pressed={!talk}
          onClick={() => {
            flow.chooseMode("type");
            if (flow.dict.recording) flow.dict.handOver();
          }}
        >
          <Icon name="keyboard" size={13} />
          Type
        </button>
      </span>
    </span>
  );
}

/** The row's mode control. The labelled switch where the stored default is
    actually in play; a plain one-off button everywhere else — the debrief
    and the field postures already chose their way in, and offering them a
    "default" would be a setting that governs a different screen. */
function ModeControl({ flow }: { flow: NoteFlow }) {
  if (!flow.scope.voiceEnabled) return null;
  if (flow.governsDefault) return <DefaultSwitch flow={flow} />;
  return flow.dict.recording ? (
    <button className="pbtn ghost wb2-modeone" onClick={flow.dict.handOver}>
      <Icon name="keyboard" size={15} />
      Type
    </button>
  ) : (
    <button className="pbtn ghost wb2-talk" onClick={flow.dict.start} disabled={flow.busy}>
      <Icon name="mic" size={15} />
      Talk
    </button>
  );
}

function Body({ flow }: { flow: NoteFlow }) {
  const stage = flow.stage;
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  /* `sorting` is in here because the textarea UNMOUNTS while the router
     thinks. Without it, a note that fails to route comes back to a box the
     cursor isn't in — the one moment you're most likely to want to retry. */
  useEffect(() => {
    if (flow.open && stage === "idle") textRef.current?.focus();
  }, [flow.open, stage]);

  if (stage === "sorting") {
    /* Something has to MOVE, or seven seconds is indistinguishable from a
       hang — and the note is worth re-reading while you wait, because the
       next screen asks you to confirm what was made of it. The skeleton rows
       hold the space the review is about to occupy. They do NOT count up,
       name steps, or claim to know what was found: there is a standing rule
       here against interfaces that pretend to be further along than they are. */
    return (
      <div className="wb2-sorting" role="status" aria-live="polite">
        <p className="wb2-sortnote">{flow.text}</p>
        <div className="wb2-sortrows" aria-hidden="true">
          <span className="wb2-skel wb2-skel-a" />
          <span className="wb2-skel wb2-skel-b" />
          <span className="wb2-skel wb2-skel-c" />
        </div>
        <p className="wb2-hint">Working out what this becomes — tasks, flags, or just a note.</p>
      </div>
    );
  }

  if (stage === "recording") {
    return (
      <div className="wb2-caprec">
        <LevelBars innerRef={flow.dict.barsRef} />
        {/* The bars are real samples, so they already say whether anything is
            being heard — a paragraph explaining that they do was Isaac's to
            cut (2026-08-10), and he cut it. Nothing replaces it: on the batch
            transport there is simply nothing to show until you stop. */}
        {flow.dict.interim && <LiveWords text={flow.dict.interim} />}
        <div className="wb2-capact">
          {/* Flipping this to Type is the way out of the mic, and it keeps
              every word — `handOver` puts what you have said in the box
              rather than routing it, so changing your mind mid-sentence
              costs nothing. */}
          <ModeControl flow={flow} />
          {/* GO HERE TOO (Isaac, 2026-08-10), and the same green. The card
              had two words for one gesture — "Stop & read" while the mic is
              open, "Go" once the words are in the box — and from where the
              person is standing both are simply the way onward. Two buttons
              named Go never share a screen: this one only exists while
              recording, that one only once there is something to sort.

              THE SQUARE STAYS. The word says where you are going; the glyph
              says what it costs, which is that the recording ends here. A
              green Go with no stop mark would be the one control on the card
              that gives no sign it is about to close the microphone. */}
          <button className="pbtn wb2-go" onClick={flow.dict.stop}>
            <Icon name="square" size={15} />
            Go
          </button>
        </div>
      </div>
    );
  }

  if (stage === "transcribing") return <p className="wb2-hint">Reading it back…</p>;

  if (stage === "answer") {
    return (
      <div className="wb2-ans">
        {/* The question, echoed — by the time an answer streams, the box it
            was typed into is gone, and an answer with no visible question
            reads like the widget talking to itself. */}
        <p className="wb2-ansq">{flow.text}</p>
        {flow.askTools.length > 0 && (
          <div className="wb2-anstools">
            {flow.askTools.map((label) => (
              <span className="wb2-anstool" key={label}>
                <Icon name="search" size={11} />
                {label}
              </span>
            ))}
          </div>
        )}
        <p className="wb2-anstext" aria-live="polite">
          {flow.askText}
          {flow.asking && <span className="wb2-anscursor" aria-hidden="true" />}
        </p>
        <div className="wb2-capact">
          <button className="pbtn ghost" onClick={flow.askAgain} disabled={flow.asking}>
            Ask another
          </button>
          <button className="pbtn" onClick={flow.close}>
            Done
          </button>
        </div>
      </div>
    );
  }

  if (stage === "idle") {
    return (
      <>
        <textarea
          ref={textRef}
          className="wb2-notes"
          rows={flow.debrief ? 6 : 3}
          value={flow.text}
          onChange={(e) => flow.setText(e.target.value)}
          placeholder={
            flow.debrief
              ? "Everything on your mind, in any order — jobs, people, things to chase, things you learned. It gets sorted; nothing is lost."
              : "Tell Luke he needs to order the grilles… or ask: what's outstanding here?"
          }
          disabled={flow.busy}
        />
        {/* The ceiling, explained where it happened. Nothing was lost and
            nothing was filed — this is a pause, so it says what to do next
            rather than apologising. */}
        {flow.ranOut && (
          <p className="wb2-hint" role="status">
            Two minutes — that&apos;s the limit for one recording. It&apos;s all in the box; press
            Talk to carry on where you left off.
          </p>
        )}
        {/* DISCARD IS GONE FROM BOTH STAGES. It called `flow.close`, which is
            exactly what the ribbon's × does — two controls, one behaviour,
            and the × is present in every stage while Discard never was. */}
        <div className="wb2-capact">
          <ModeControl flow={flow} />
          {/* IT ARRIVES WITH THE WORDS (Isaac, 2026-08-10). It used to sit
              there greyed out on an empty sheet — a dead control is a
              question you have to answer every time you look at it. Now the
              row is quiet until there is something to sort, and the button
              appearing IS the signal that there is.

              AND IT IS CALLED "GO" (Isaac, 2026-08-10). "Sort this out" was
              the button describing its own machinery; by the time it appears
              there is one thing to do with the words in the box and no
              choice left to explain. The accessible name moves with the
              visible one — a label a screen reader reads as something other
              than what is printed on it is its own bug. */}
          {flow.text.trim() && (
            <button
              className="pbtn wb2-go"
              aria-label="Go"
              onClick={() => flow.submit(flow.text)}
              disabled={flow.busy}
            >
              {flow.busy ? "Reading…" : "Go"}
            </button>
          )}
        </div>
      </>
    );
  }

  return <Review flow={flow} />;
}

function Review({ flow }: { flow: NoteFlow }) {
  const { note, draft } = flow;
  if (!note || !draft) return null;

  return (
    <div className="wb-review" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}>
      <p className="wb-notetext">{note.proposal.plainNote || flow.text}</p>

      {note.proposal.clarify && (
        <div className="wb-ask">
          <b>{note.proposal.clarify.question}</b>
          <div className="int-act">
            {note.proposal.clarify.options.map((o) => (
              <button
                key={o}
                className="wb-chip"
                disabled={flow.busy}
                onClick={() => flow.sendAnswer(o)}
              >
                {o}
              </button>
            ))}
          </div>
          <div className="wb-row">
            <input
              className="wb-inline"
              value={flow.answer}
              onChange={(e) => flow.setAnswer(e.target.value)}
              placeholder="…or answer in your own words"
            />
            <button
              className="pbtn ghost"
              onClick={() => flow.sendAnswer()}
              disabled={flow.busy || !flow.answer.trim()}
            >
              Answer
            </button>
          </div>
        </div>
      )}

      <ReviewRows draft={draft} staff={note.staff} patch={flow.patch} />

      <Cascade
        jobLabel={
          flow.debrief
            ? null
            : flow.targetLabel ?? (flow.chosenJob ? describeJob(flow.chosenJob) : null)
        }
        taskCount={draft.tasks.filter((t) => t.on && t.title.trim() && t.assigneeId).length}
        kbCount={draft.kbEntries.filter((k) => k.on && k.title.trim() && k.body.trim()).length}
        noteLineCount={draft.noteLines.filter((l) => l.on && l.text.trim()).length}
        fallsThrough={flow.fallsThrough}
      />

      {/* Nothing on this card is thrown away quietly. If a ticked row can't be
          saved, Save says so and stays off until you fix it or untick it. */}
      {flow.stops.map((s) => (
        <p className="wb2-capstop" key={s}>
          {s}
        </p>
      ))}

      <div className="wb2-capact">
        {/* A debrief's Save already files its leftovers as the grouped note,
            so a second "keep it" door would file the transcript TWICE. Untick
            everything else and Save IS "just keep my notes". */}
        {flow.debrief ? null : flow.hasTarget ? (
          <button
            className="pbtn ghost"
            onClick={flow.keepOnJob}
            disabled={flow.busy}
            title="Put the words on the job's notes and apply none of this"
          >
            Put it on the job&apos;s notes
          </button>
        ) : (
          <button
            className="pbtn ghost"
            onClick={flow.keepForMe}
            disabled={flow.busy}
            title="Keep the words in your own notes and apply none of this"
          >
            Keep it in my notes
          </button>
        )}
        {/* THE ACCESSIBLE NAME DOES NOT MOVE. The visible label still flips to
            "Saving…", but a button whose NAME changes mid-action is a button a
            screen reader loses track of exactly when it matters — and it made
            this one un-findable in tests the instant a transition was still
            pending, which is the same bug wearing different clothes. */}
        <button
          className="pbtn"
          aria-label="Save these"
          onClick={flow.confirm}
          disabled={flow.busy || nothingTicked(draft) || flow.stops.length > 0}
        >
          {flow.busy ? "Saving…" : "Save these"}
        </button>
      </div>
    </div>
  );
}

/** The job confirmation + picker, shown when a note arrived against nothing
    and there are jobs it could belong to. */
function JobLine({ flow }: { flow: NoteFlow }) {
  /* A debrief spans jobs by nature and its job-bound lanes are closed, so
     offering to pin the WHOLE thing to one job would un-say all of that. */
  if (flow.debrief) return null;
  if (!flow.note || flow.targetLabel || flow.scope.jobs.length === 0) return null;
  return (
    <>
      <div className={"wb2-capjob" + (flow.chosenJob ? " on" : "")}>
        <Icon name={flow.chosenJob ? "check" : "alert"} size={14} />
        <span>
          {flow.chosenJob ? (
            <>
              Sounds like <b>{describeJob(flow.chosenJob)}</b>
            </>
          ) : flow.guess.ambiguous ? (
            "More than one job matches what you said."
          ) : (
            "No job named — it'll go to your own notes."
          )}
        </span>
        {/* The picker lives HERE, on the thing it changes. A select you have
            to scroll past the right answer in is a way to hit the wrong one. */}
        <button
          type="button"
          className="wb2-capchange"
          onClick={() => flow.setPicking(!flow.picking)}
          aria-expanded={flow.picking}
        >
          {flow.chosenJob ? "Change" : "Pick a job"}
        </button>
      </div>
      {flow.picking && (
        <JobPicker
          options={flow.guess.ranked}
          chosenId={flow.chosen?.id ?? null}
          onPick={flow.pickJob}
          onClose={() => flow.setPicking(false)}
        />
      )}
    </>
  );
}

/* ── posture: debrief ──

   THE BUTTON YOU PRESS BEFORE YOU GET STUCK IN (Isaac, 2026-08-06): unload
   everything at once and let the sorting be the machine's problem. It opens
   the same sheet as every other posture; only the framing and the brain's
   instructions differ. Typing is as first-class here as everywhere else.

   IT IS THE GLOBAL BUTTON, IN A BAR (Isaac, 2026-08-12). Four shapes now:

     the cyan pill      the app's language from before the Tiff button existed
     the ink capsule    dark face, gradient rim, mic half beside the word
     just "Debrief"     a word on a glass capsule
     this               the row IS the button, and it wears `TiffMark`

   THE CAPSULE DIED OF ITS OWN MATERIAL. It was the topbar button's glass —
   `rgba(255,255,255,.08)` — which works on the topbar's near-black but
   composites to 1.29:1 against the glass card it ended up on. On the topbar
   the fill was never the thing doing the work: a breathing halo sits behind
   it and the chevron-and-sparkle sit inside it. #327 removed both, rightly,
   when the control was a word on Tiff's own ink — but on a lighter ground
   that left a bright gradient rim around a fill nobody could see, and the
   card already wears that same gradient. Two outlines, one hollow shape.

   So the mark comes back, and the WORD stays: the rule this posture was
   built on is "never an icon alone, because what does the sparkle do is a
   question a 6am brain shouldn't have to ask". The bar is the label and the
   hit area; the mark is what makes it recognisably Tiff's. #327's argument
   does not carry over, because that was about a mark on a control sitting on
   an ink console — here the mark IS the control's contrast.

   THE MARK LEADS AND THE COPY IS THREE WORDS (Isaac, 2026-08-12). It read
   "Say the day — anything you'll forget, and it gets sorted", which is a
   sales promise, not this app's voice: "tag line is cheesy". `Debrief` is
   already the app's own noun for these entries (the record counts "2
   debriefs" and the sheet is labelled "Morning debrief"), so the verb costs
   no new vocabulary.

   The mark's host is a SPAN taking `.tiffbtn-topbar` (which owns the 44px
   box, the face, the halo and the spark's placement) but NOT `.tiffbtn` —
   the same split #325 arrived at, for the same reason: a button inside a
   button is invalid, and `.tiffbtn`'s cursor and lift belong to the bar now.
   Its hovers are re-pointed at `.hm-say:hover` in shell.css. */

function DebriefButton({ flow }: { flow: NoteFlow }) {
  return (
    <>
      <div className="wb2-tokdock hm-saydock">
        <button
          type="button"
          className="hm-say"
          aria-haspopup="dialog"
          aria-expanded={flow.open}
          onClick={() => flow.setOpen(true)}
        >
          {/* Decorative: the bar's own words are its accessible name, and a
              mark announced beside them would be the label said twice. */}
          <span className="hm-saymk tiffbtn-topbar" aria-hidden="true">
            <TiffMark chevron={20} spark={13} halo />
          </span>
          <span className="hm-saytx">Debrief the day</span>
        </button>
        {flow.done && <span className="wb2-chip ok">{flow.done}</span>}
      </div>

      {flow.open &&
        createPortal(
          <>
            <div className="wb2-capdim" onClick={flow.close} />
            <div
              className={"wb2-capcard wb2-caps" + duskClass(flow)}
              role="dialog"
              aria-modal="true"
              aria-label="Morning debrief"
            >
              <span className="wb2-grab" aria-hidden="true" />
              <Ribbon flow={flow} />
              {flow.error && <p className="wb2-sherr">{flow.error}</p>}
              <Body flow={flow} />
            </div>
          </>,
          document.body
        )}
    </>
  );
}

/* ── posture: capsule ── */

/* THE DUSK SKIN. Until the review arrives the card wears the frame's own
   material — ink glass, gradient edge, white type — and the moment the
   review lands it hands over to the light work surface it has always been.
   The split is deliberate, not unfinished: capture is Tiff's moment and
   reads at a glance; the review is dense reading with a dozen tuned light
   components (ticks, selects, state colours) that a dark pass would have to
   re-earn one by one. Deriving it from the stage keeps every posture and the
   debrief consistent for free. */
const duskClass = (flow: NoteFlow) => (flow.stage === "review" ? "" : " wb2-dusk");

/** The capture surface, portalled. One copy: the Tiff button and the field
    postures open the SAME sheet, which is the whole argument of the
    unification — what you get should not depend on which control you reached
    it through. `entrance` only changes how it ARRIVES: the Tiff button hands
    in "blossom" so the sheet grows out of the button, and `from` is where —
    the button's own offset from the viewport centre, measured on click. */
export function CaptureSheet({
  flow,
  entrance,
  from,
}: {
  flow: NoteFlow;
  entrance?: "blossom";
  from?: { dx: number; dy: number } | null;
}) {
  if (!flow.open) return null;
  return createPortal(
    <>
      <div className="wb2-capdim" onClick={flow.close} />
      {/* KEEPS `wb2-capcard` DELIBERATELY. Sixteen rules in shell.css name
          that class to give a PORTALLED surface its button fills, type sizes
          and disabled states — anything declared under `.fg` is absent out
          here, and the capture card shipped once with colourless primary
          buttons for exactly this reason. `wb2-caps` only moves it. */}
      <div
        className={
          "wb2-capcard wb2-caps" + duskClass(flow) + (entrance === "blossom" ? " wb2-blossom" : "")
        }
        /* The keyframe reads these; with no measurement it falls back to 0,0
           and simply grows from the middle rather than breaking. */
        style={
          from
            ? ({ "--cap-dx": `${from.dx}px`, "--cap-dy": `${from.dy}px` } as React.CSSProperties)
            : undefined
        }
        role="dialog"
        aria-modal="true"
        aria-label={flow.debrief ? "Day debrief" : "Add a note"}
      >
        <span className="wb2-grab" aria-hidden="true" />
        <Ribbon flow={flow} />
        {flow.error && <p className="wb2-sherr">{flow.error}</p>}
        <JobLine flow={flow} />
        <Body flow={flow} />
      </div>
    </>,
    document.body
  );
}

function Strip({
  flow,
  label,
  placeholder,
  value,
  onChange,
  onCommit,
  disabled,
}: {
  flow: NoteFlow;
  label: string;
  placeholder?: string;
  value: string;
  onChange: (next: string) => void;
  onCommit?: () => void;
  disabled: boolean;
}) {
  const mic = useFieldMic(value, onChange);
  const { dict } = mic;
  const shown = dict.interim ? appendSpoken(value, dict.interim) : value;
  const busy = disabled || dict.recording || dict.transcribing;

  if (flow.open && flow.stage !== "idle") {
    return (
      <div className="wb2-stripopen">
        <Ribbon flow={flow} />
        {flow.error && <p className="wb2-sherr">{flow.error}</p>}
        <JobLine flow={flow} />
        <Body flow={flow} />
      </div>
    );
  }

  const commit = () => {
    if (!value.trim()) return;
    onCommit?.();
    /* Sniff what was just committed, not what's in the box — the box is
       about to be cleared by the caller. */
    mic.check(value);
  };

  return (
    <>
      <div className={"wb2-strip" + (dict.recording ? " live" : "")}>
        {dict.recording && <span className="wb2-recdot" aria-hidden="true" />}
        <input
          className="wb2-stripin"
          value={shown}
          placeholder={dict.recording ? "Listening…" : (placeholder ?? "Add a note, or say it…")}
          aria-label={label}
          disabled={busy}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            commit();
          }}
        />
        {mic.voiceEnabled && dict.recording ? (
          <>
            <LevelBars innerRef={dict.barsRef} />
            <DictClock seconds={dict.seconds} />
            <button
              type="button"
              className="wb2-striprnd stop"
              onClick={dict.stop}
              aria-label={`Stop dictating — ${label}`}
            >
              <Icon name="square" size={13} />
            </button>
            <button
              type="button"
              className="wb2-striprnd"
              onClick={dict.cancel}
              aria-label={`Discard the recording — ${label}`}
            >
              <Icon name="x" size={13} />
            </button>
          </>
        ) : (
          <>
            {mic.voiceEnabled && (
              <button
                type="button"
                className="wb2-striprnd"
                aria-label={`Say ${label}`}
                disabled={disabled || dict.transcribing}
                onClick={dict.start}
              >
                <Icon name="mic" size={15} />
              </button>
            )}
            <button
              type="button"
              className="wb2-striprnd go"
              aria-label={`Add ${label}`}
              disabled={busy || !value.trim()}
              onClick={commit}
            >
              <Icon name="plus" size={15} />
            </button>
          </>
        )}
      </div>
      {dict.transcribing && <p className="wb2-dicthint">Reading it back…</p>}
      {mic.err && <p className="wb2-dicterr">{mic.err}</p>}
      {mic.found && (
        <Nudge
          onDismiss={mic.dismiss}
          onOpen={() => {
            const words = mic.found!;
            mic.dismiss();
            flow.setOpen(true);
            flow.read("text", words);
          }}
        />
      )}
    </>
  );
}

/* ── postures: field and line ──

   These FILL A BOX. A mic on "site requirements" is not a note-taker: what
   you dictate belongs to that field and saves with the form around it, so
   routing every gate code would file a task nobody asked for.

   "Smart, but only when it finds something" (Isaac, 2026-08-05) is the
   middle path, and `sniff` is what makes it affordable — deciding the
   question properly costs an Opus call, so a free local sieve decides
   whether to ask. The offer that appears is dismissible and ignoring it
   costs nothing; the field has already saved either way. */

function useFieldMic(value: string, onChange: (next: string) => void) {
  const scope = useNoteScope();
  const [err, setErr] = useState<string | null>(null);
  const [found, setFound] = useState<string | null>(null);

  const dict = useDictation({
    onTranscript: (spoken) => {
      setErr(null);
      const next = appendSpoken(value, spoken);
      onChange(next);
      /* The sieve runs on the WHOLE box, not just the new sentence: dictation
         appends, so "Luke needs to" and "order the grilles before Monday" can
         arrive as two presses and only read as a job together. */
      setFound(sniff(next, scope.staffFirstNames).actionable ? next : null);
    },
    onError: setErr,
  });

  return {
    dict,
    err,
    setErr,
    found,
    /** Run the sieve over words the caller already has — the strip commits
        and clears in one gesture, so by the time it asks, `value` is gone. */
    check: (words: string) => setFound(sniff(words, scope.staffFirstNames).actionable ? words : null),
    dismiss: () => setFound(null),
    voiceEnabled: scope.voiceEnabled,
  };
}

/** The offer. Deliberately quiet: a dashed hairline, no colour shift on the
    field, and a dismiss that leaves nothing behind. */
function Nudge({ onOpen, onDismiss }: { onOpen: () => void; onDismiss: () => void }) {
  return (
    <div className="wb2-nudge">
      <Icon name="sparkles" size={15} />
      <span className="wb2-nudgetext">There&apos;s something to do in this.</span>
      <button type="button" className="pbtn sm" onClick={onOpen}>
        Have a look
      </button>
      <button
        type="button"
        className="wb2-ico"
        onClick={onDismiss}
        aria-label="Ignore that — leave it as a note"
      >
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}

/* ── the component ── */

export function NoteToken({
  as,
  label = "a note",
  value,
  onChange,
  onCommit,
  placeholder,
  rows = 3,
  disabled = false,
  className,
}: {
  /** Where this one is standing. No default: the corner — the only posture
      that was ever the obvious one — is now the Tiff button in the frame. */
  as: Posture;
  /** What the token's accessible names say it's for — "a note for this
      visit", "access notes". Never an icon alone. */
  label?: string;
  /** field/line only — the box's own value. */
  value?: string;
  onChange?: (next: string) => void;
  /** line only — Enter, or the +. */
  onCommit?: () => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  className?: string;
}) {
  const flow = useNoteFlow({ debrief: as === "debrief" });

  if (as === "debrief") return <DebriefButton flow={flow} />;
  if (as === "strip")
    return (
      <Strip
        flow={flow}
        label={label}
        placeholder={placeholder}
        value={value ?? ""}
        onChange={onChange ?? (() => {})}
        onCommit={onCommit}
        disabled={disabled}
      />
    );

  return (
    <FieldPosture
      as={as}
      label={label}
      value={value ?? ""}
      onChange={onChange ?? (() => {})}
      onCommit={onCommit}
      placeholder={placeholder}
      rows={rows}
      disabled={disabled}
      className={className}
      flow={flow}
    />
  );
}

function FieldPosture({
  as,
  label,
  value,
  onChange,
  onCommit,
  placeholder,
  rows,
  disabled,
  className,
  flow,
}: {
  as: Posture;
  label: string;
  value: string;
  onChange: (next: string) => void;
  onCommit?: () => void;
  placeholder?: string;
  rows: number;
  disabled: boolean;
  className?: string;
  flow: NoteFlow;
}) {
  const mic = useFieldMic(value, onChange);
  const { dict } = mic;
  const shown = dict.interim ? appendSpoken(value, dict.interim) : value;
  const busy = disabled || dict.recording || dict.transcribing;

  const offer = mic.found && (
    <Nudge
      onDismiss={mic.dismiss}
      onOpen={() => {
        mic.dismiss();
        flow.setOpen(true);
        flow.read("text", mic.found!);
      }}
    />
  );

  /* The review, when the offer is taken, is the SAME surface the capsule
     opens — which is the entire point of the unification. `wb2-capcard` was
     missing here alone of the three portal sites, which left this copy
     outside the sixteen rules that give the portalled card its fills and
     positioning — the exact bug the CaptureSheet comment warns about. */
  const surface =
    flow.open &&
    createPortal(
      <>
        <div className="wb2-capdim" onClick={flow.close} />
        <div
          className={"wb2-capcard wb2-caps" + duskClass(flow)}
          role="dialog"
          aria-modal="true"
          aria-label="Add a note"
        >
          <span className="wb2-grab" aria-hidden="true" />
          <Ribbon flow={flow} />
          {flow.error && <p className="wb2-sherr">{flow.error}</p>}
          <JobLine flow={flow} />
          <Body flow={flow} />
        </div>
      </>,
      document.body
    );

  if (as === "line") {
    return (
      <div className="wb2-dictline">
        <div className="wb2-addrow">
          <input
            className="wb2-fi"
            placeholder={dict.recording ? "Listening…" : placeholder}
            value={shown}
            disabled={busy}
            aria-label={label}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              onCommit?.();
            }}
          />
          {mic.voiceEnabled && dict.recording ? (
            <>
              <LevelBars innerRef={dict.barsRef} />
              <DictClock seconds={dict.seconds} />
              <button
                type="button"
                className="wb2-micgo on"
                onClick={dict.stop}
                title="Stop and read it back"
                aria-label={`Stop dictating — ${label}`}
              >
                <Icon name="square" size={12} />
              </button>
              <button
                type="button"
                className="wb2-dictx"
                onClick={dict.cancel}
                title="Throw it away"
                aria-label={`Discard the recording — ${label}`}
              >
                <Icon name="x" size={12} />
              </button>
            </>
          ) : (
            <>
              {mic.voiceEnabled && (
                <button
                  type="button"
                  className="wb2-micgo"
                  onClick={dict.start}
                  disabled={disabled || dict.transcribing}
                  title="Say it instead"
                  aria-label={`Dictate — ${label}`}
                >
                  <Icon name="mic" size={14} />
                </button>
              )}
              <button
                type="button"
                className="wb2-addgo"
                disabled={disabled || dict.transcribing || value.trim() === ""}
                title="Add it"
                aria-label={`Add — ${label}`}
                onClick={onCommit}
              >
                <Icon name="plus" size={14} />
              </button>
            </>
          )}
        </div>
        {dict.transcribing && <p className="wb2-dicthint">Reading it back…</p>}
        {mic.err && <p className="wb2-dicterr">{mic.err}</p>}
        {offer}
        {surface}
      </div>
    );
  }

  return (
    <div className={"wb2-dict" + (className ? ` ${className}` : "")}>
      <textarea
        className="wb2-notes"
        rows={rows}
        placeholder={dict.recording ? "Listening…" : placeholder}
        value={shown}
        onChange={(e) => onChange(e.target.value)}
        disabled={busy}
      />
      {mic.voiceEnabled && (
        <div className="wb2-dictbar">
          {dict.recording ? (
            <>
              <button
                type="button"
                className="wb2-dictmic on"
                onClick={dict.stop}
                title="Stop and read it back"
                aria-label={`Stop dictating — ${label}`}
              >
                <Icon name="square" size={13} />
              </button>
              <LevelBars innerRef={dict.barsRef} />
              <DictClock seconds={dict.seconds} />
              <button
                type="button"
                className="wb2-dictx"
                onClick={dict.cancel}
                title="Throw it away"
                aria-label={`Discard the recording — ${label}`}
              >
                <Icon name="x" size={12} />
              </button>
            </>
          ) : dict.transcribing ? (
            <span className="wb2-dicthint">Reading it back…</span>
          ) : (
            <button
              type="button"
              className="wb2-dictmic"
              onClick={dict.start}
              disabled={disabled}
              title="Say it instead"
              aria-label={`Dictate — ${label}`}
            >
              <Icon name="mic" size={13} />
              Say it
            </button>
          )}
        </div>
      )}
      {mic.err && <p className="wb2-dicterr">{mic.err}</p>}
      {offer}
      {surface}
    </div>
  );
}
