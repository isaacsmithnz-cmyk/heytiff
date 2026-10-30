"use client";

import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/parts/button";
import { Empty } from "@/components/parts/states";
import { ViewTabs } from "@/components/parts/tabs";
import { ToastProvider } from "@/components/parts/toast";
import { TiffAssistant, askHandoffAtMount, noAskHandoff, noHandoffSubscription } from "@/components/tiff/assistant";
import { useEmailJob } from "@/components/tiff/email-job-card";
import type { KbCategoryKey } from "@/components/tiff/kb";
import { inboxLine, inboxWord, type InboxEmail, type InboxEmailState } from "@/lib/email/inbox";
import { threadTitleOf } from "@/lib/email/proposal";
import { CONV_VIEWS, EMAIL_THREAD, isEmailThread, withConvState, type ConvView } from "@/lib/tiff/conversations";
import { useHydrated } from "@/lib/use-hydrated";
import { InboxHead, InboxRead, seedOf } from "./inbox";
import { CvList } from "./list";

/* CONVERSATIONS (v2, step 5; the board v2-board-conversations, rule 5's
   second place).

   Left: the title, the views as soft tabs (rule 29), and the list. Right:
   what's open, with the box at its foot.

   - Inbox is every email sent to Tiff by anyone in the business (Isaac, 30
     October 2026: "it needs to be called inbox… And it should be a good flow";
     lib/email/inbox.ts). Each opens at its decision: Create job, or Add to job
     N. It's where the place opens, and its word goes amber while an email
     waits on someone.
   - Chats is your own talk with Tiff. They are the Library's own threads and
     its own ask (components/tiff/assistant.tsx, its `conversations` layout):
     one Tiff, two ways to lay her out. A question handed over from the Library
     or the Toolbox lands here.

   Team (shared chats, never built) went on 30 October ("Why do we need the
   team conversations?"); Only me went on 24 October (a note isn't a
   conversation; they are Your name › Notes).

   The view and what is open ride in the address (`?view=`, `?open=`),
   written with replaceState as they change, so a tab or a refresh holds
   them, as the Jobs list does. The assistant stays mounted across the views,
   so an answer still arriving keeps arriving while the other view is up. */

export type ConversationsProps = {
  counts: Record<KbCategoryKey, number>;
  readyCount: number;
  canManage: boolean;
  docTitles: Record<string, string>;
  voiceEnabled: boolean;
  initial: { view: ConvView; open: string | null };
  /** The person asking, by name, beside their own turns. */
  you: string;
  /** The business's emails to Tiff, newest first. */
  inbox: InboxEmail[];
};

const emailIdOf = (thread: string | null) => (isEmailThread(thread) ? thread!.slice(EMAIL_THREAD.length) : null);

function Place({ counts, readyCount, canManage, docTitles, voiceEnabled, initial, you, inbox }: ConversationsProps) {
  const hydrated = useHydrated();
  /* A question handed over (the Library, the Toolbox) is a chat, whatever the
     address says: it arrives with none. */
  const handoff = useSyncExternalStore(noHandoffSubscription, askHandoffAtMount, noAskHandoff);
  const handed = Boolean(handoff.text || handoff.doc || handoff.ask);
  const [picked, setPicked] = useState<ConvView | null>(null);
  const view = picked ?? (handed ? "chats" : initial.view);
  const [threadOpen, setThreadOpen] = useState<string | null>(initial.view === "chats" ? initial.open : null);
  const [emailPicked, setEmailPicked] = useState<string | null>(emailIdOf(initial.open));
  /* what's been done since the page was read, so a row's word keeps up */
  const [changed, setChanged] = useState<Record<string, { state: InboxEmailState; jobNumber: string | null }>>({});
  const [now] = useState(() => Date.now());

  const rows = inbox.map((e) => (changed[e.id] ? { ...e, ...changed[e.id] } : e));
  /* The newest opens when none is named, as Chats' newest does. */
  const emailOpen = emailPicked ?? rows[0]?.id ?? null;
  const job = useEmailJob(view === "inbox" && emailOpen ? emailOpen : "", (v) => {
    if (v.state !== "refused") setChanged((c) => ({ ...c, [v.id]: { state: v.state as InboxEmailState, jobNumber: v.jobNumber } }));
  });
  const openRow = rows.find((e) => e.id === emailOpen) ?? null;

  const write = (v: ConvView, open: string | null) => {
    if (typeof window === "undefined") return;
    window.history.replaceState(null, "", withConvState(window.location.href, { view: v, open }));
  };

  const go = (key: string) => {
    const v = CONV_VIEWS.find((x) => x.key === key)?.key ?? "inbox";
    setPicked(v);
    write(v, v === "chats" ? threadOpen : emailPicked ? `${EMAIL_THREAD}${emailPicked}` : null);
  };

  const openThread = (id: string | null) => {
    setThreadOpen(id);
    setPicked("chats");
    write("chats", id);
  };

  const openEmail = (id: string) => {
    setEmailPicked(id);
    write("inbox", `${EMAIL_THREAD}${id}`);
  };

  const email =
    view === "inbox" && emailOpen
      ? {
          threadId: `${EMAIL_THREAD}${emailOpen}`,
          title: job.view ? threadTitleOf(job.view.subject, job.view.proposal) : (openRow?.subject ?? "An email to Tiff"),
          seed: job.view ? seedOf(job.view) : null,
          head: <InboxHead job={job} row={openRow} now={now} />,
          read: <InboxRead job={job} />,
        }
      : null;

  return (
    <TiffAssistant
      layout="conversations"
      counts={counts}
      readyCount={readyCount}
      canManage={canManage}
      docTitles={docTitles}
      voiceEnabled={voiceEnabled}
      initialThreadId={initial.view === "chats" ? initial.open : null}
      onOpenChange={openThread}
      you={you}
      email={email}
      frame={({ list, pane }) => {
        const tabs = CONV_VIEWS.map((v) => ({
          key: v.key,
          label: v.label,
          ...(v.key === "inbox" && rows.some((e) => inboxWord(e).waiting) ? { tone: "look" as const } : {}),
        }));
        const side =
          view === "chats" ? (
            list
          ) : !hydrated ? null : rows.length > 0 ? (
            <CvList
              label="Emails to Tiff"
              rows={rows.map((e) => ({ id: e.id, title: e.subject, when: inboxLine(e, now), state: inboxWord(e) }))}
              openId={emailOpen}
              onOpen={openEmail}
            />
          ) : (
            <Empty
              what="Nothing in the inbox yet"
              line="Forward a builder's email to Tiff and it lands here, read."
              action={
                canManage ? (
                  <Button kind="second" size={32} href="/dashboard/admin/integrations">
                    Find Tiff&apos;s address
                  </Button>
                ) : null
              }
            />
          );
        return (
          <div className="cv">
            <div className="cv-side">
              <div className="cv-head">
                <h1 className="cv-title">Conversations</h1>
                <ViewTabs items={tabs} current={view} onGo={go} ariaLabel="Conversations" idPrefix="cv-view" panelPrefix="cv-views" />
              </div>
              <div className="cv-list" id={`cv-views-${view}`} role="tabpanel" aria-labelledby={`cv-view-${view}`}>
                {side}
              </div>
            </div>
            <div className="cv-main">{view === "inbox" && !emailOpen ? null : pane}</div>
          </div>
        );
      }}
    />
  );
}

export function Conversations(props: ConversationsProps) {
  return (
    <ToastProvider>
      <Place {...props} />
    </ToastProvider>
  );
}
