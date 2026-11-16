"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CvBox } from "@/components/conversations/box";
import { appendSpoken, useDictation } from "@/components/notes/dictation";
import { TiffGlyph } from "@/components/notes/tiff-mark";
import { useTiff } from "@/components/tiff/modal/tiff-context";
import { TiffInline } from "@/components/tiff/modal/tiff-inline";
import { Button, LinkButton } from "@/components/parts/button";
import { Row } from "@/components/parts/row";
import { Fade } from "@/components/parts/fade";
import { Empty } from "@/components/parts/states";
import { StateWord } from "@/components/parts/state";
import { Tick } from "@/components/parts/tick";
import type { TodayRow, TodayView } from "@/lib/dashboard/home-today";
import { Icon } from "@/components/shell/icon";
import type { TodoRow } from "@/lib/dashboard/todo";
import { ColumnHead, HomeReplyContext, useTaskTick } from "./home-todo";
import { HomeFeed } from "./home-feed";
import { TaskForm } from "@/components/making/task-form";
import type { FeedItem } from "@/lib/dashboard/your-feed";

/* HOME, v2 (the board v2-board-home; docs/design.md rules 8, 13, 22, 26,
   27 and 39; decisions 25 and 28). Three things, in one column:

   TIFF'S MARK, centred, three times its old size and always turning in
   her colours, faster while she works (Isaac, 20 October: "move at all
   times, even in standby"), over HER BOX ("What's happening on site?").
   The box is Conversations' own (components/conversations/box): the
   microphone records in the box itself, the recording card taking its
   place and the words landing in it, as Claude's box does (Isaac, 20
   October: "the recording is done in the box itself, no pop-up modal").
   Send starts the conversation ON THE PAGE (../tiff/modal/tiff-inline):
   it takes Home's place, and Back to Home brings the columns back.

   TWO CARDS UNDER IT, AS A JOB'S OVERVIEW HAS (Isaac, 17 November 2026,
   "Make home todo part of activity feed like the job card", "Today should
   be just your day", then "Make all fixes";
   https://claude.ai/artifact/7ijojbkVbMJUGasurPCvVF). TODAY, the narrow one:
   your own bookings as the Schedule's cards (rule 19), your timed tasks and
   the day's events, with the Schedule a link away. THE ACTIVITY FEED, the
   wide one (./home-feed): To do first, what waits on you, the reminders due
   today among it, then what came in, by day. Before, To do stood as a third
   column and today's reminders sat under Today (20 October to 17 November).

   A TASK THE ADDRESS NAMES (`?task=`, the bell's door for a Done that
   didn't reach ServiceM8) opens its own form over Home; closing it takes
   the task off the address. The old desk is gone (24 October 2026). */

/** A booking as the Schedule's card: the number in its colour's box, the
    client over the suburb, the kind and who else is going, and the time on
    the right with where it's up to under it. A done one goes grey. */
function TodayCard({ row }: { row: TodayRow }) {
  const card = row.card!;
  const inner = (
    <>
      <span className="hm-jc-n">{card.number}</span>
      <span className="hm-jc-t">
        <Fade className="hm-jc-client">{card.client}</Fade>
        {card.line && <Fade className="hm-jc-line">{card.line}</Fade>}
      </span>
      <span className="hm-jc-end">
        <span className="hm-jc-time">{row.time}</span>
        {row.state && <StateWord tone={row.state.tone}>{row.state.word}</StateWord>}
      </span>
    </>
  );
  return (
    <li className={`hm-jc hm-jc--${card.done ? "grey" : (row.hue ?? "grey")}${card.done ? " hm-jc--done" : ""}`}>
      {row.href ? (
        <Link href={row.href} className="hm-jc-hit">
          {inner}
        </Link>
      ) : (
        <span className="hm-jc-hit">{inner}</span>
      )}
    </li>
  );
}

function TodayRows({ rows, tick }: { rows: readonly TodayRow[]; tick: (key: string, taskId: string) => Promise<void> | void }) {
  return (
    <ul className="pt-rows hm-day" aria-label="Today">
      {rows.map((row) =>
        row.card ? (
          <TodayCard key={row.key} row={row} />
        ) : (
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
                {/* an event: a calendar where a task's tick goes, as the
                    phone's card has one where a job's number goes */}
                {row.kind === "event" && <Icon name="calendar" size={16} />}
              </span>
            }
            dot={row.hue ?? undefined}
            lines={3}
            name={row.name}
            line={row.line || undefined}
            href={row.href ?? undefined}
            end={row.state ? <StateWord tone={row.state.tone}>{row.state.word}</StateWord> : undefined}
          />
        ),
      )}
    </ul>
  );
}

function HomeToday({ view }: { view: TodayView }) {
  const { gone, tick } = useTaskTick();
  const rows = view.rows.filter((r) => !gone.has(r.key));
  /* the day's events (Isaac, 6 November 2026, the events and birthdays
     mock) go in among its bookings by their time; a day with nothing
     booked still says so, and its events follow */
  const booked = rows.filter((r) => r.kind !== "event");
  const events = rows.filter((r) => r.kind === "event");
  const birthdays = view.birthdays ?? [];
  return (
    <section className="hm-sec" aria-labelledby="hm-today">
      {/* no summary beside the title (Isaac, 20 October: "not needed"); the
          v2 Schedule a link away, never the old desk or the Workboard */}
      <ColumnHead id="hm-today" name="Today" icon="calendar" hue="purple">
        {view.schedule && (
          <span className="hm-headlinks">
            <LinkButton href="/dashboard/schedule">Schedule</LinkButton>
          </span>
        )}
      </ColumnHead>
      {/* whose birthday it is, under Today, as the phone has it: only those
          who ticked Share my birthday, and an age only with Share my age */}
      {birthdays.length > 0 && (
        <ul className="hm-bdays" aria-label="Birthdays">
          {birthdays.map((words, i) => (
            <li key={`${words}-${i}`} className="hm-bday">
              <Icon name="star" size={16} />
              <span>{words}</span>
            </li>
          ))}
        </ul>
      )}
      {booked.length === 0 ? (
        <>
          <Empty
            what={view.empty.what}
            line={view.empty.line ?? undefined}
            action={view.empty.action ? <Button href={view.empty.action.href}>{view.empty.action.label}</Button> : null}
          />
          {events.length > 0 && <TodayRows rows={events} tick={tick} />}
        </>
      ) : (
        <TodayRows rows={rows} tick={tick} />
      )}
    </section>
  );
}

/** Home's box: the words, the microphone that records in the box, and Send,
    which starts the conversation on this page. */
function HomeBox({ voice, onStart }: { voice: boolean; onStart: (words: string) => void }) {
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
    if (!words) return;
    setText("");
    onStart(words);
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

export function HomeScreen({
  today,
  todo,
  feed = [],
  day,
  replyTo = null,
  openTask = null,
  voice = false,
}: {
  today: TodayView;
  todo: TodoRow[];
  feed?: readonly FeedItem[];
  /** the account's day, YYYY-MM-DD: the feed's days count from it */
  day?: string;
  /** a mention To do's Reply named (`?reply=`): its box opens in Your feed */
  replyTo?: string | null;
  /** a task the address names (`?task=`): its form opens over Home */
  openTask?: string | null;
  voice?: boolean;
}) {
  const tiff = useTiff();
  const router = useRouter();
  const [addressed, setAddressed] = useState(openTask);
  /* the mention whose box is open in Your feed: the address's, then To
     do's Reply, which opens it here without reading Home again; `n` opens
     it again on a second press */
  const [asked, setAsked] = useState<{ id: string; n: number } | null>(replyTo ? { id: replyTo, n: 0 } : null);
  /* THE CONVERSATION TAKES THE PAGE once you have said something (Isaac, 20
     October, the board's frame 2); Back to Home brings the columns back. */
  const [chat, setChat] = useState<{ words: string; n: number } | null>(null);
  if (chat)
    return (
      <div className="page in">
        <div className="wrap hm hm--chat">
          <h1 className="sr-only">Home</h1>
          <TiffInline key={chat.n} words={chat.words} onBack={() => setChat(null)} />
        </div>
      </div>
    );
  return (
    <div className="page in">
      <div className="wrap hm">
        <h1 className="sr-only">Home</h1>
        <div className="hm-ask">
          <TiffGlyph size={96} alive working={tiff.isOpen} label="Tiff" />
          <HomeBox voice={voice} onStart={(words) => setChat((was) => ({ words, n: (was?.n ?? 0) + 1 }))} />
        </div>
        {/* two cards, as a job's Overview (Isaac, 17 November 2026): Today,
            narrow, your day; the Activity feed, wide, To do first in it */}
        <HomeReplyContext.Provider value={(id) => setAsked((a) => ({ id, n: (a?.n ?? 0) + 1 }))}>
          <div className="hm-cols">
            <HomeToday view={today} />
            <HomeFeed items={feed} todo={todo} today={day} replyTo={asked?.id ?? null} asked={asked?.n ?? 0} />
          </div>
        </HomeReplyContext.Provider>
        {addressed && (
          <TaskForm
            taskId={addressed}
            onClose={() => {
              setAddressed(null);
              router.replace("/dashboard", { scroll: false });
            }}
            onChanged={() => router.refresh()}
          />
        )}
      </div>
    </div>
  );
}
