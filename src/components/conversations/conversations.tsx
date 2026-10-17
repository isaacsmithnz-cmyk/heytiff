"use client";

import { useState } from "react";
import { Button } from "@/components/parts/button";
import { Empty } from "@/components/parts/states";
import { ViewTabs } from "@/components/parts/tabs";
import { ToastProvider } from "@/components/parts/toast";
import { TiffAssistant } from "@/components/tiff/assistant";
import type { KbCategoryKey } from "@/components/tiff/kb";
import { useHydrated } from "@/lib/use-hydrated";
import type { MyNote } from "@/lib/notes/my-notes-query";
import { CONV_VIEWS, withConvState, type ConvView } from "@/lib/tiff/conversations";
import { NotePane, NotesList } from "./only-me";

/* CONVERSATIONS (v2, step 5; the board v2-board-conversations, rule 5's
   second place).

   Left: the title, the views as soft tabs (rule 29), and the list. Right:
   the open conversation, with the box at its foot.

   - All is your conversations with Tiff. They are the Library's own threads
     and its own ask (components/tiff/assistant.tsx, its `conversations`
     layout): one Tiff, two ways to lay her out.
   - Team is shared threads, which don't exist yet; the view says so (rule
     40) rather than drawing a list of nothing.
   - Only me is your private notes (6-revisions.md, decision 18).

   The view and what is open ride in the address (`?view=`, `?open=`),
   written with replaceState as they change, so a tab or a refresh holds
   them, as the Jobs list does. The assistant stays mounted across the views,
   so an answer still arriving keeps arriving while Only me is up. */

export type ConversationsProps = {
  counts: Record<KbCategoryKey, number>;
  readyCount: number;
  canManage: boolean;
  docTitles: Record<string, string>;
  voiceEnabled: boolean;
  notes: MyNote[];
  archived: MyNote[];
  initial: { view: ConvView; open: string | null };
  /** The person asking, by name, beside their own turns and notes. */
  you: string;
};

/* The clock the notes' times are read against, at module scope: a clock in
   a component body reads to the compiler as a render that could change. */
const nowMs = (): number => Date.now();

function Place({ counts, readyCount, canManage, docTitles, voiceEnabled, notes, archived, initial, you }: ConversationsProps) {
  const hydrated = useHydrated();
  const [view, setView] = useState<ConvView>(initial.view);
  const [threadOpen, setThreadOpen] = useState<string | null>(initial.view === "all" ? initial.open : null);
  const [noteOpen, setNoteOpen] = useState<string | null>(initial.view === "me" ? initial.open : null);
  const [draft, setDraft] = useState("");
  const [clock] = useState(nowMs);
  /* The server's clock and zone are not the reader's: a note's "Today
     8:12 am" is drawn once the page is in the browser, never on the server. */
  const now = hydrated ? clock : null;

  const write = (v: ConvView, open: string | null) => {
    if (typeof window === "undefined") return;
    window.history.replaceState(null, "", withConvState(window.location.href, { view: v, open }));
  };

  const go = (key: string) => {
    const v = CONV_VIEWS.find((x) => x.key === key)?.key ?? "all";
    setView(v);
    write(v, v === "all" ? threadOpen : v === "me" ? noteOpen : null);
  };

  const openThread = (id: string | null) => {
    setThreadOpen(id);
    write("all", id);
  };

  const openNote = (id: string | null) => {
    setNoteOpen(id);
    write("me", id);
  };

  return (
    <TiffAssistant
      layout="conversations"
      counts={counts}
      readyCount={readyCount}
      canManage={canManage}
      docTitles={docTitles}
      voiceEnabled={voiceEnabled}
      initialThreadId={initial.view === "all" ? initial.open : null}
      onOpenChange={openThread}
      you={you}
      frame={({ list, pane, count }) => {
        const tabs = CONV_VIEWS.map((v) => ({
          key: v.key,
          label: v.label,
          count: v.key === "all" ? count : v.key === "team" ? 0 : notes.length,
        }));
        let side = list;
        let main = pane;
        if (view === "me") {
          side = <NotesList notes={notes} archived={archived} openId={noteOpen} onOpen={openNote} now={now} />;
          main = (
            <NotePane
              notes={notes}
              archived={archived}
              openId={noteOpen}
              onOpen={openNote}
              draft={draft}
              setDraft={setDraft}
              you={you}
              voiceEnabled={voiceEnabled}
              now={now}
            />
          );
        } else if (view === "team") {
          side = null;
          main = (
            <section className="cv-pane" aria-label="Team conversations">
              <div className="cv-start">
                {/* rule 40: what's missing, honestly, and the way on */}
                <Empty
                  what="No team conversations yet"
                  line="Sharing a conversation with your team isn't built yet. What you ask Tiff stays yours, under All."
                  action={
                    <Button kind="second" size={32} onClick={() => go("all")}>
                      Open your conversations
                    </Button>
                  }
                />
              </div>
            </section>
          );
        }
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
            <div className="cv-main">{main}</div>
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
