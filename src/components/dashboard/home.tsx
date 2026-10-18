"use client";

import { TiffGlyph } from "@/components/notes/tiff-mark";
import { TiffBox } from "@/components/tiff/modal/tiff-box";
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

   TIFF'S MARK, centred and still, over HER BOX ("What's happening on
   site?"), which is the entry box every room had (components/tiff/modal/
   tiff-box) in v2's dress: the microphone opens her listening, Send opens
   her on the words. No new Tiff flow: it is the same modal.

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

export function HomeScreen({ today, todo }: { today: TodayView; todo: TodoRow[] }) {
  const tiff = useTiff();
  return (
    <div className="page in">
      <div className="wrap hm">
        <h1 className="sr-only">Home</h1>
        <div className="hm-ask">
          <TiffGlyph size={32} working={tiff.isOpen} label="Tiff" />
          <TiffBox room="home" look="home" placeholder="What's happening on site?" save={NO_SAVE} />
        </div>
        <HomeToday view={today} />
        <HomeTodo rows={todo} />
      </div>
    </div>
  );
}

/** Home's box has no Save (tiff-box, `look="home"`); this is never pressed. */
const NO_SAVE = async () => ({ ok: false as const, error: "" });
