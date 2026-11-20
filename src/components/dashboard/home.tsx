"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CvBox } from "@/components/conversations/box";
import { appendSpoken, useDictation } from "@/components/notes/dictation";
import { TiffGlyph } from "@/components/notes/tiff-mark";
import { useTiff } from "@/components/tiff/modal/tiff-context";
import { TiffInline } from "@/components/tiff/modal/tiff-inline";
import { SectionTabs } from "@/components/parts/tabs";
import type { TodayView } from "@/lib/dashboard/home-today";
import type { HomeDay, TeamDay } from "@/lib/dashboard/team-day";
import type { TodoRow } from "@/lib/dashboard/todo";
import { HomeReplyContext } from "./home-todo";
import { HomeFeed } from "./home-feed";
import { HomeSchedule, useKept } from "./home-schedule";
import { TaskForm } from "@/components/making/task-form";
import type { FeedItem } from "@/lib/dashboard/your-feed";

/* HOME, v2 (the board v2-board-home; docs/design.md rules 8, 13, 22, 26,
   27 and 39; decisions 25 and 28). Three things, in one column:

   TIFF'S MARK, centred, three times its old size, alive at rest: it throws
   its boomerang for one slow lap now and then, and keeps it up while she
   works (Isaac, 20 November 2026: "mock home throw", then "Yes, build all
   three"), over HER BOX ("What's happening on site?").
   The box is Conversations' own (components/conversations/box): the
   microphone records in the box itself, the recording card taking its
   place and the words landing in it, as Claude's box does (Isaac, 20
   October: "the recording is done in the box itself, no pop-up modal").
   Send starts the conversation ON THE PAGE (../tiff/modal/tiff-inline):
   it takes Home's place, and Back to Home brings the columns back.

   ONE CARD UNDER IT, WITH TWO TABS (Isaac, 17 November 2026: "let's make
   it so we've got schedule and activity feed as two separate tabs", then
   "Build it" to https://claude.ai/artifact/7ijojbkVbMJUGasurPCvVF).
   SCHEDULE (./home-schedule): the team's day by default, since the one at
   the desk is usually the one running it, with You for your own; the days
   along the top; the jobs listed beside a map of where they are. THE
   ACTIVITY FEED (./home-feed), the card's full width: To do first, what
   waits on you, then what came in, by day. Each tab's controls sit on the
   line under the tabs, and Home keeps the tab you left it on. Before, two
   cards: Today, your own day, beside the feed (17 November, the morning),
   and three columns before that (20 October to 17 November).

   A TASK THE ADDRESS NAMES (`?task=`, the bell's door for a Done that
   didn't reach ServiceM8) opens its own form over Home; closing it takes
   the task off the address. The old desk is gone (24 October 2026). */

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

type HomeTab = "schedule" | "feed";

export function HomeScreen({
  today,
  todo,
  feed = [],
  day,
  team = null,
  days = [],
  replyTo = null,
  openTask = null,
  voice = false,
}: {
  today: TodayView;
  todo: TodoRow[];
  feed?: readonly FeedItem[];
  /** the account's day, YYYY-MM-DD: the feed's days count from it */
  day?: string;
  /** Home's Schedule: the team's day today; null without `workboard`, which
      leaves the feed alone */
  team?: TeamDay | null;
  /** the days along the Schedule's top: today and the next working days */
  days?: readonly HomeDay[];
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
  const [kept, setTab] = useKept<HomeTab>("heytiff.home.tab.v1", ["schedule", "feed"], "schedule");
  /* a mention's Reply opens on the feed, where its box is */
  const tab: HomeTab = !team || asked ? "feed" : kept;
  const tabs = [
    ...(team ? [{ key: "schedule", label: "Schedule" }] : []),
    { key: "feed", label: "Activity feed" },
  ];
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
        {/* one card, two tabs (Isaac, 17 November 2026): Schedule, the
            team's day on a map; the Activity feed, To do first in it */}
        <HomeReplyContext.Provider value={(id) => setAsked((a) => ({ id, n: (a?.n ?? 0) + 1 }))}>
          <section className="hm-card" aria-label="Today">
            <div className="hm-card-tabs">
              <SectionTabs
                items={tabs}
                current={tab}
                onGo={(k) => {
                  if (k === "schedule") setAsked(null);
                  setTab(k as HomeTab);
                }}
                ariaLabel="Home"
                idPrefix="hm-tab"
                panelPrefix="hm-panel"
              />
            </div>
            {tab === "schedule" && team ? (
              <HomeSchedule
                first={team}
                days={days.length ? days : [{ day: team.day, label: "Today" }]}
                birthdays={today.birthdays}
                unlinked={today.empty}
              />
            ) : (
              <HomeFeed items={feed} todo={todo} today={day} replyTo={asked?.id ?? null} asked={asked?.n ?? 0} tabbed />
            )}
          </section>
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
