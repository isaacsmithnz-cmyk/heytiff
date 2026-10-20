"use client";

import { useRef, useState } from "react";
import { CvBox } from "@/components/conversations/box";
import { appendSpoken, useDictation } from "@/components/notes/dictation";
import { TiffGlyph } from "@/components/notes/tiff-mark";
import { useTiff } from "@/components/tiff/modal/tiff-context";
import { Button, LinkButton } from "@/components/parts/button";
import { Row, RowList } from "@/components/parts/row";
import { Empty } from "@/components/parts/states";
import { StateWord } from "@/components/parts/state";
import { Tick } from "@/components/parts/tick";
import type { TodayView } from "@/lib/dashboard/home-today";
import type { TodoRow } from "@/lib/dashboard/todo";
import { HomeTodo, useTaskTick } from "./home-todo";

/* HOME, v2 (the board v2-board-home; docs/design.md rules 8, 13, 22, 26,
   27 and 39; decisions 25 and 28). Three things, in one column:

   TIFF'S MARK, centred, three times its old size and always turning in
   her colours, faster while she works (Isaac, 20 October: "move at all
   times, even in standby"), over HER BOX ("What's happening on site?").
   The box is Conversations' own (components/conversations/box): the
   microphone records in the box itself, the recording card taking its
   place and the words landing in it, as Claude's box does (Isaac, 20
   October: "the recording is done in the box itself, no pop-up modal").
   Send opens her on the words.

   TODAY: your own visits and timed tasks, one row each, with the Schedule
   (the Workboard, until Schedule is rebuilt) and the old desk's Calendar a
   link away.

   TO DO: everything waiting on you, the bell's lists among it, with Show
   all for the rest (./home-todo, lib/dashboard/todo).

   The old Home (Your day, Diary, Tasks, the Calendar and its list) stands
   at /dashboard/desk until Conversations and Schedule take its faces in. */

/** The old desk's Calendar, until Schedule › Calendar is built (F-023). */
export const CALENDAR_HREF = "/dashboard/desk?face=calendar";

function HomeToday({ view }: { view: TodayView }) {
  const { gone, tick } = useTaskTick();
  const rows = view.rows.filter((r) => !gone.has(r.key));
  return (
    <section className="hm-sec" aria-labelledby="hm-today">
      <div className="hm-head">
        <h2 className="hm-h" id="hm-today">
          Today
        </h2>
        <span className="hm-sum">{view.summary}</span>
        <span className="hm-headlinks">
          <LinkButton href={CALENDAR_HREF}>Calendar</LinkButton>
          {view.schedule && <LinkButton href="/dashboard/workboard">Schedule</LinkButton>}
        </span>
      </div>
      {rows.length === 0 ? (
        <Empty
          what={view.empty.what}
          line={view.empty.line ?? undefined}
          action={view.empty.action ? <Button href={view.empty.action.href}>{view.empty.action.label}</Button> : null}
        />
      ) : (
        <RowList label="Today">
          {rows.map((row) => (
            <Row
              key={row.key}
              lead={
                <span className="hm-lead">
                  <span className="hm-time">{row.time}</span>
                  {row.taskId && (
                    <Tick
                      className="hm-tick"
                      label={<span className="sr-only">Done, {row.name}</span>}
                      onChange={(on) => {
                        if (on && row.taskId) void tick(row.key, row.taskId);
                      }}
                    />
                  )}
                </span>
              }
              dot={row.hue ?? undefined}
              name={row.name}
              line={row.line}
              href={row.href ?? undefined}
              end={row.state ? <StateWord tone={row.state.tone}>{row.state.word}</StateWord> : undefined}
            />
          ))}
        </RowList>
      )}
    </section>
  );
}

/** Home's box: the words, the microphone that records in the box, and Send. */
function HomeBox({ voice }: { voice: boolean }) {
  const tiff = useTiff();
  const [text, setText] = useState("");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [ranOut, setRanOut] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const dict = useDictation({
    onTranscript: (spoken, { capped }) => {
      setVoiceError(null);
      setRanOut(capped);
      setText((prev) => appendSpoken(prev, spoken));
    },
    onError: setVoiceError,
  });

  const send = () => {
    const words = text.trim();
    const at = field.current;
    if (!words || !at) return;
    if (tiff.open({ from: at, words, room: "home", keyboard: true, back: at })) setText("");
  };

  return (
    <CvBox
      value={text}
      onChange={setText}
      onSubmit={send}
      label="What's happening on site?"
      placeholder="What's happening on site?"
      sendWord="Send"
      dict={voice ? dict : null}
      voiceError={voiceError}
      ranOut={ranOut}
      boxRef={field}
    />
  );
}

export function HomeScreen({ today, todo, voice = false }: { today: TodayView; todo: TodoRow[]; voice?: boolean }) {
  const tiff = useTiff();
  return (
    <div className="page in">
      <div className="wrap hm">
        <h1 className="sr-only">Home</h1>
        <div className="hm-ask">
          <TiffGlyph size={96} alive working={tiff.isOpen} label="Tiff" />
          <HomeBox voice={voice} />
        </div>
        <HomeToday view={today} />
        <HomeTodo rows={todo} />
      </div>
    </div>
  );
}
