"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { acknowledgeTask } from "@/app/actions/assignments";
import { resolveIssue } from "@/app/actions/dashboard";
import { replyToJobNote, type ReplyResult } from "@/app/actions/job-note-sm8";
import { Button, LinkButton } from "@/components/parts/button";
import { TextInput } from "@/components/parts/field";
import { Initials } from "@/components/parts/initials";
import { Empty } from "@/components/parts/states";
import { Tray } from "@/components/parts/tabs";
import { TaskForm } from "@/components/making/task-form";
import { FEED_FILTERS, FEED_HOME_CAP, inFilter, type FeedFilter, type FeedItem } from "@/lib/dashboard/your-feed";
import { Icon } from "@/components/shell/icon";
import { ColumnHead } from "./home-todo";

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
   with nothing lost). */

const KEPT = "heytiff.home.feed.v1";
const newComposeId = () => crypto.randomUUID();
const readKept = (): FeedFilter | null => {
  try {
    const v = localStorage.getItem(KEPT);
    return v === "you" || v === "jobs" || v === "approvals" || v === "all" ? v : null;
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
const keep = (f: FeedFilter) => {
  try {
    localStorage.setItem(KEPT, f);
  } catch {
    /* not kept: it still filters */
  }
  listeners.forEach((fn) => fn());
};

function ReplyBox({ item, onSent }: { item: FeedItem; onSent: (words: string) => void }) {
  const [words, setWords] = useState("");
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
      composeId,
      ...(reply.closesTaskId ? { closesTaskId: reply.closesTaskId } : {}),
    }).catch((): ReplyResult => ({ ok: false, error: "That didn't send. Try again." }));
    setSending(false);
    if (got.ok) onSent(w);
    else setError(got.error);
  };
  return (
    <form
      className="hm-feed-reply"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <div className="hm-feed-replyrow">
        <TextInput
          aria-label={`Reply to ${item.who.name}`}
          placeholder={`Reply to ${item.who.name.split(" ")[0]}`}
          value={words}
          disabled={sending}
          autoFocus
          onChange={(e) => setWords(e.target.value)}
        />
        <Button kind="main" size={36} disabled={sending || !words.trim()} onClick={() => void send()}>
          {sending ? "Sending" : "Send"}
        </Button>
      </div>
      {error && (
        <p className="hm-feed-err" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

const THING_ICON: Record<FeedItem["filter"], string> = { approvals: "check", you: "note", jobs: "folder" };

/** A field issue made a task: its words, and the issue the saved task closes. */
type MakeTask = { title: string; issueId: string };

/** The item's words, as the door to what it is about. */
function Opener({ item, onTask, children }: { item: FeedItem; onTask: (taskId: string) => void; children: ReactNode }) {
  const open = item.open;
  if (open && "href" in open)
    return (
      <Link className="hm-feed-open" href={open.href}>
        {children}
      </Link>
    );
  if (open)
    return (
      <button type="button" className="hm-feed-open" onClick={() => onTask(open.taskId)}>
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
}: {
  item: FeedItem;
  onGone: (key: string) => void;
  onTask: (taskId: string) => void;
  onMakeTask: (m: MakeTask) => void;
  open?: boolean;
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
        <Opener item={item} onTask={onTask}>
          <span className="hm-feed-head">
            {item.unread && !sent && <span className="hm-feed-new" aria-label="New" />}
            <b>{item.who.name}</b>
            <span className="hm-feed-what">{item.what}</span>
            {item.when && <span className="hm-feed-when">{item.when}</span>}
          </span>
          {item.said && <span className="hm-feed-said">{item.reply ? `"${item.said}"` : item.said}</span>}
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
          (item.reply || act) && (
            <div className="hm-feed-acts">
              {item.reply && !sent && (
                <Button size={32} onClick={() => setReplying(true)}>
                  Reply
                </Button>
              )}
              {act?.kind === "link" && (
                <Button size={32} href={act.href}>
                  {act.label}
                </Button>
              )}
              {act?.kind === "issue" && (
                <>
                  <Button size={32} onClick={() => onMakeTask({ title: act.title, issueId: act.issueId })}>
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
              {act?.kind === "gotit" && (
                <Button
                  size={32}
                  onClick={() => {
                    onGone(item.key);
                    void acknowledgeTask(act.taskId)
                      .catch(() => null)
                      .then(() => router.refresh());
                  }}
                >
                  Got it
                </Button>
              )}
            </div>
          )
        )}
      </div>
    </li>
  );
}

export function HomeFeed({
  items,
  replyTo = null,
  all = false,
  headingLevel = 2,
}: {
  items: readonly FeedItem[];
  replyTo?: string | null;
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
  const [chosen, setChosen] = useState<FeedFilter | null>(null);
  /* To do's Reply names a note: show everything so its mention is there */
  const filter: FeedFilter = chosen ?? (replyTo ? "all" : (kept ?? "all"));
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const choose = (f: FeedFilter) => {
    setChosen(f);
    keep(f);
  };
  const here = inFilter(items, filter).filter((i) => !gone.has(i.key));
  const named = (i: FeedItem) => !!replyTo && (i.notes ?? []).includes(replyTo);
  const capped = all ? here : here.slice(0, FEED_HOME_CAP);
  const asked = all ? null : (here.slice(FEED_HOME_CAP).find(named) ?? null);
  const shown = asked ? [...capped, asked] : capped;
  return (
    <section className="hm-sec hm-feed" aria-labelledby="hm-feed">
      <ColumnHead id="hm-feed" name="Your feed" icon="chat" hue="green" level={headingLevel}>
        {!all && here.length > FEED_HOME_CAP && (
          <LinkButton href="/dashboard/feed" className="hm-headlink">
            Show all
          </LinkButton>
        )}
      </ColumnHead>
      <div className="hm-feed-filter">
        <Tray ariaLabel="Show" options={FEED_FILTERS} value={filter} onChange={choose} />
      </div>
      {shown.length === 0 ? (
        <Empty what={filter === "all" ? "Nothing new" : "Nothing here"} action={null} />
      ) : (
        <ul className="hm-feed-list" aria-label="Your feed">
          {shown.map((item) => (
            <FeedEntry
              /* keyed by whether To do's Reply named it, so a Reply pressed
                 while Home is open opens its box */
              key={`${item.key}${named(item) ? ":reply" : ""}`}
              item={item}
              open={named(item)}
              onGone={(k) => setGone((g) => new Set([...g, k]))}
              onTask={setTask}
              onMakeTask={setMaking}
            />
          ))}
        </ul>
      )}
      {task && <TaskForm taskId={task} onClose={() => setTask(null)} onChanged={() => router.refresh()} />}
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
