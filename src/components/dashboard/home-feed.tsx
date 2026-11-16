"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { acknowledgeTask } from "@/app/actions/assignments";
import { resolveIssue } from "@/app/actions/dashboard";
import { replyToJobNote } from "@/app/actions/job-note-sm8";
import type { ReplyResult } from "@/lib/integrations/sm8-note-entry";
import { Button, LinkButton } from "@/components/parts/button";
import { Initials } from "@/components/parts/initials";
import { NoteToken } from "@/components/notes/note-token";
import { Empty } from "@/components/parts/states";
import { Fade } from "@/components/parts/fade";
import { Tray } from "@/components/parts/tabs";
import { TaskForm } from "@/components/making/task-form";
import {
  FEED_FILTERS,
  FEED_HOME_CAP,
  feedDays,
  feedTime,
  inFilter,
  type FeedFilter,
  type FeedItem,
} from "@/lib/dashboard/your-feed";
import { TODO_HOME_CAP, type TodoRow } from "@/lib/dashboard/todo";
import { Icon } from "@/components/shell/icon";
import { ColumnHead, TodoList } from "./home-todo";

/* YOUR FEED — Home's third column, in place of Activity (Isaac, 20 October
   2026; the board https://claude.ai/artifact/NzYjAQqzJJsgSgPPGCSJVq, built
   as mocked). Everything that comes to you, newest first, with a filter
   under the head: All, To you, Jobs, Approvals. The items are decided on the
   server (lib/dashboard/your-feed); this draws them and does what they do
   where they sit: Reply to a mention opens a box under it and sends through
   the job card's own reply (it goes to ServiceM8 as you, and closes the task
   the ask made); Got it takes work given to you; the rest open their page.
   The item itself opens too (Isaac, 24 October 2026: "Everything on that
   feed and notes should be interactive"): its words go where it is about,
   or open the task it is over Home. A field issue with nothing to open is
   made a task (the task form, its words filled in, and the issue closes
   once the task is saved) or Done (closed) where it sits.

   The filter is remembered on this device (a convenience, so it can be lost
   with nothing lost).

   ON HOME IT IS THE ACTIVITY FEED, AS A JOB'S IS (Isaac, 17 November 2026,
   "Make home todo part of activity feed like the job card", then "Make all
   fixes", https://claude.ai/artifact/7ijojbkVbMJUGasurPCvVF). To do is in it,
   not a column of its own: its views sit on the right of its name, All, To
   do, To you, Jobs and Approvals, and All starts with what waits on you,
   then what came in, a day's name over each day's items and only the time
   on an item. A mention's Reply went from under it, since the item opens
   its job and To do's row opens its reply box here. */

/** A view of the feed: one of its filters, or Home's To do. */
type View = FeedFilter | "todo";

const KEPT = "heytiff.home.feed.v1";
const newComposeId = () => crypto.randomUUID();
const readKept = (): View | null => {
  try {
    const v = localStorage.getItem(KEPT);
    return v === "you" ||
      v === "jobs" ||
      v === "approvals" ||
      v === "all" ||
      v === "todo"
      ? v
      : null;
  } catch {
    return null;
  }
};
/* the kept choice as a store, so the page draws All on the server and the
   kept one once it is in the browser, without a render that disagrees */
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
};
const keep = (f: View) => {
  try {
    localStorage.setItem(KEPT, f);
  } catch {
    /* not kept: it still filters */
  }
  listeners.forEach((fn) => fn());
};

/** The job card's reply, here: the same box, said or typed (no Tiff offer —
    a reply is a reply), and Send under it (Isaac, 7 November 2026: "Fix all
    of those", the feed's reply was one line with no microphone). */
function ReplyBox({
  item,
  onSent,
}: {
  item: FeedItem;
  onSent: (words: string) => void;
}) {
  const [words, setWords] = useState("");
  const [spoken, setSpoken] = useState(false);
  const [composeId] = useState(newComposeId);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reply = item.reply!;
  const send = async () => {
    const w = words.trim();
    if (!w || sending) return;
    setSending(true);
    setError(null);
    const got: ReplyResult = await replyToJobNote({
      jobUuid: reply.jobUuid,
      sourceNoteUuid: reply.sourceNoteUuid,
      words: w,
      spoken,
      composeId,
      ...(reply.closesTaskId ? { closesTaskId: reply.closesTaskId } : {}),
    }).catch((): ReplyResult => ({
      ok: false,
      error: "That didn't send. Try again.",
    }));
    setSending(false);
    if (got.ok) onSent(w);
    else setError(got.error);
  };
  return (
    <div className="hm-feed-reply">
      <NoteToken
        as="field"
        label="a reply"
        offer={false}
        rows={2}
        value={words}
        onChange={setWords}
        onSpoken={() => setSpoken(true)}
        placeholder={`Reply to ${item.who.name.split(" ")[0]}`}
        disabled={sending}
        box={{ "aria-label": `Reply to ${item.who.name}`, autoFocus: true }}
      />
      <div className="wb2-jcattsave">
        <Button
          kind="main"
          size={36}
          disabled={sending || !words.trim()}
          onClick={() => void send()}
        >
          {sending ? "Sending" : "Send"}
        </Button>
      </div>
      {error && (
        <p className="hm-feed-err" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const THING_ICON: Record<FeedItem["filter"], string> = {
  approvals: "check",
  you: "note",
  jobs: "folder",
};

/** A field issue made a task: its words, and the issue the saved task closes. */
type MakeTask = { title: string; issueId: string };

/** The item's words, as the door to what it is about. */
function Opener({
  item,
  onTask,
  onOpen,
  children,
}: {
  item: FeedItem;
  onTask: (taskId: string) => void;
  onOpen?: () => void;
  children: ReactNode;
}) {
  const open = item.open;
  if (open && "href" in open)
    return (
      <Link className="hm-feed-open" href={open.href} onClick={onOpen}>
        {children}
      </Link>
    );
  if (open)
    return (
      <button
        type="button"
        className="hm-feed-open"
        onClick={() => {
          onOpen?.();
          onTask(open.taskId);
        }}
      >
        {children}
      </button>
    );
  return <span className="hm-feed-words">{children}</span>;
}

function FeedEntry({
  item,
  onGone,
  onTask,
  onMakeTask,
  open = false,
  time,
  replies = true,
}: {
  item: FeedItem;
  onGone: (key: string) => void;
  onTask: (taskId: string) => void;
  onMakeTask: (m: MakeTask) => void;
  open?: boolean;
  /** under a day's name, the item says only its time */
  time?: string;
  /** a Reply under a mention: on Show all's page, not on Home, where To do's
      row opens the mention's box */
  replies?: boolean;
}) {
  const router = useRouter();
  /* To do's Reply lands here with this mention's box already open */
  const [replying, setReplying] = useState(open && !!item.reply);
  const [sent, setSent] = useState<string | null>(null);
  const yours = sent ?? item.yours;
  const act = item.act;
  return (
    <li className="hm-feed-item">
      {item.who.sm8 ? (
        <span className="hm-feed-av hm-feed-av--sm8" aria-hidden="true">
          SM8
        </span>
      ) : item.who.thing ? (
        <span className="hm-feed-av hm-feed-av--thing" aria-hidden="true">
          <Icon name={THING_ICON[item.filter]} size={16} />
        </span>
      ) : (
        <Initials name={item.who.name} size={32} beside />
      )}
      <div className="hm-feed-body">
        {/* THE ITEM IS ITS OWN DOOR (Isaac, 5 November 2026, as To do's
            rows): its Open went, since the words open the same place, and
            its Got it, since opening new work is seeing it */}
        <Opener
          item={item}
          onTask={onTask}
          onOpen={
            act?.kind === "gotit"
              ? () => {
                  void acknowledgeTask(act.taskId)
                    .catch(() => null)
                    .then(() => router.refresh());
                }
              : undefined
          }
        >
          {/* WHO AND WHAT, AS A SENTENCE THAT WRAPS (Isaac, 25 October 2026:
              "we're not losing all of the text off to the right… three lines
              max"): the name in bold and what they did after it, running to
              three lines before its end fades; when moves under their words,
              so the line has the column's whole width */}
          <span className="hm-feed-head">
            {item.unread && !sent && (
              <span className="hm-feed-new" aria-label="New" />
            )}
            <Fade lines={3} className="hm-feed-headtext">
              <b className="hm-feed-name">{item.who.name}</b>
              {item.what ? (
                <>
                  {" "}
                  <span className="hm-feed-what">{item.what}</span>
                </>
              ) : null}
            </Fade>
          </span>
          {item.said && (
            <Fade lines={3} className="hm-feed-said">
              {item.reply ? `"${item.said}"` : item.said}
            </Fade>
          )}
          {(time ?? item.when) && (
            <span className="hm-feed-when">{time ?? item.when}</span>
          )}
        </Opener>
        {yours && <p className="hm-feed-yours">You: {yours}</p>}
        {replying && !sent ? (
          <ReplyBox
            item={item}
            onSent={(w) => {
              setSent(w);
              setReplying(false);
              router.refresh();
            }}
          />
        ) : (
          ((replies && item.reply && !sent) || act?.kind === "issue") && (
            <div className="hm-feed-acts">
              {replies && item.reply && !sent && (
                <Button size={32} onClick={() => setReplying(true)}>
                  Reply
                </Button>
              )}
              {act?.kind === "issue" && (
                <>
                  <Button
                    size={32}
                    onClick={() =>
                      onMakeTask({ title: act.title, issueId: act.issueId })
                    }
                  >
                    Make it a task
                  </Button>
                  <Button
                    size={32}
                    onClick={() => {
                      onGone(item.key);
                      void resolveIssue(act.issueId)
                        .catch(() => null)
                        .then(() => router.refresh());
                    }}
                  >
                    Done
                  </Button>
                </>
              )}
            </div>
          )
        )}
      </div>
    </li>
  );
}

const VIEW_TODO = { value: "todo" as const, label: "To do" };

export function HomeFeed({
  items,
  todo,
  today,
  replyTo = null,
  asked: pressed = 0,
  all = false,
  headingLevel = 2,
}: {
  items: readonly FeedItem[];
  /** Home's To do, the first of the feed (Show all's page has its own) */
  todo?: readonly TodoRow[];
  /** the account's day, YYYY-MM-DD: the items stand under their day's name */
  today?: string;
  replyTo?: string | null;
  /** how many times To do's Reply has been pressed on Home: each opens the box again */
  asked?: number;
  /** The whole feed (Show all's page, /dashboard/feed); Home shows the first
      FEED_HOME_CAP, and the one To do's Reply named wherever it falls. */
  all?: boolean;
  headingLevel?: 1 | 2;
}) {
  const router = useRouter();
  /* a task's own form over Home: one the item is, or a field issue's to make */
  const [task, setTask] = useState<string | null>(null);
  const [making, setMaking] = useState<MakeTask | null>(null);
  const kept = useSyncExternalStore(subscribe, readKept, () => null);
  /* chosen here before it could be kept (storage refused) still filters */
  const [chosen, setChosen] = useState<View | null>(null);
  const views: readonly { value: View; label: string }[] = todo
    ? [FEED_FILTERS[0], VIEW_TODO, ...FEED_FILTERS.slice(1)]
    : FEED_FILTERS;
  const usable = (v: View | null): v is View =>
    !!v && views.some((o) => o.value === v);
  /* To do's Reply names a note: show everything so its mention is there */
  const view: View = usable(chosen)
    ? chosen
    : replyTo
      ? "all"
      : usable(kept)
        ? kept
        : "all";
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const choose = (v: View) => {
    setChosen(v);
    keep(v);
  };
  const here =
    view === "todo"
      ? []
      : inFilter(items, view).filter((i) => !gone.has(i.key));
  const named = (i: FeedItem) => !!replyTo && (i.notes ?? []).includes(replyTo);
  const capped = all ? here : here.slice(0, FEED_HOME_CAP);
  /* the mention To do's Reply named goes FIRST, its box open, where the
     press can see it: at the foot of the column it opened under the fold */
  const askedItem = here.find(named) ?? null;
  const shown = askedItem
    ? [askedItem, ...capped.filter((i) => i !== askedItem)]
    : capped;
  const waiting = todo && (view === "all" || view === "todo") ? todo : [];
  const days = today
    ? feedDays(shown, today)
    : [{ key: "all", label: "", items: shown }];
  const more = !all && here.length > FEED_HOME_CAP;
  const name = todo ? "Activity feed" : "Your feed";
  const entry = (item: FeedItem, time?: string) => (
    <FeedEntry
      /* keyed by whether To do's Reply named it, so a Reply pressed
         while Home is open opens its box */
      key={`${item.key}${named(item) ? `:reply:${pressed}` : ""}`}
      item={item}
      open={named(item)}
      time={time}
      replies={!todo}
      onGone={(k) => setGone((g) => new Set([...g, k]))}
      onTask={setTask}
      onMakeTask={setMaking}
    />
  );
  const tray = (
    <Tray ariaLabel="Show" options={views} value={view} onChange={choose} />
  );
  return (
    <section
      className={todo ? "hm-sec hm-feed hm-feed--home" : "hm-sec hm-feed"}
      aria-labelledby="hm-feed"
    >
      <ColumnHead
        id="hm-feed"
        name={name}
        icon="chat"
        hue="green"
        level={headingLevel}
      >
        {todo ? <div className="hm-headtray">{tray}</div> : null}
        {!todo && more && (
          <LinkButton href="/dashboard/feed" className="hm-headlink">
            Show all
          </LinkButton>
        )}
      </ColumnHead>
      {!todo && <div className="hm-feed-filter">{tray}</div>}
      {waiting.length > 0 && (
        <div className="hm-group">
          <h3 className="hm-dayname">To do</h3>
          <TodoList
            rows={waiting}
            label="To do"
            disc
            cap={view === "todo" ? undefined : TODO_HOME_CAP}
          />
          {view !== "todo" && waiting.length > TODO_HOME_CAP && (
            <LinkButton href="/dashboard/todo" className="hm-grouplink">
              Show all
            </LinkButton>
          )}
        </div>
      )}
      {view === "todo"
        ? waiting.length === 0 && (
            <Empty what="Nothing is waiting on you" action={null} />
          )
        : shown.length === 0
          ? waiting.length === 0 && (
              <Empty
                what={view === "all" ? "Nothing new" : "Nothing here"}
                action={null}
              />
            )
          : days.map((d) => (
              <div key={d.key} className="hm-group">
                {d.label && <h3 className="hm-dayname">{d.label}</h3>}
                <ul
                  className="hm-feed-list"
                  aria-label={d.label ? `${name}, ${d.label}` : name}
                >
                  {d.items.map((item) =>
                    entry(item, today ? feedTime(item.when) : undefined),
                  )}
                </ul>
              </div>
            ))}
      {todo && more && view !== "todo" && (
        <LinkButton href="/dashboard/feed" className="hm-grouplink">
          Show all
        </LinkButton>
      )}
      {task && (
        <TaskForm
          taskId={task}
          onClose={() => setTask(null)}
          onChanged={() => router.refresh()}
        />
      )}
      {making && (
        <TaskForm
          startWith={making.title}
          onClose={() => setMaking(null)}
          onChanged={() => {
            const issueId = making.issueId;
            setGone((g) => new Set([...g, `issue:${issueId}`]));
            void resolveIssue(issueId)
              .catch(() => null)
              .then(() => router.refresh());
          }}
        />
      )}
    </section>
  );
}
