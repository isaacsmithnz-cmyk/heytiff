"use client";

import { useState } from "react";
import { Button } from "@/components/parts/button";
import { Empty } from "@/components/parts/states";
import { ViewTabs } from "@/components/parts/tabs";
import { ToastProvider } from "@/components/parts/toast";
import { TiffAssistant } from "@/components/tiff/assistant";
import type { KbCategoryKey } from "@/components/tiff/kb";
import { CONV_VIEWS, withConvState, type ConvView } from "@/lib/tiff/conversations";

/* CONVERSATIONS (v2, step 5; the board v2-board-conversations, rule 5's
   second place).

   Left: the title, the views as soft tabs (rule 29), and the list. Right:
   the open conversation, with the box at its foot.

   - All is your conversations with Tiff. They are the Library's own threads
     and its own ask (components/tiff/assistant.tsx, its `conversations`
     layout): one Tiff, two ways to lay her out.
   - Team is shared threads, which don't exist yet; the view says so (rule
     40) rather than drawing a list of nothing.

   Only me, your private notes, was a third view and went (Isaac, 24
   October 2026): they are Your name › Notes, and a note isn't a
   conversation.

   The view and what is open ride in the address (`?view=`, `?open=`),
   written with replaceState as they change, so a tab or a refresh holds
   them, as the Jobs list does. The assistant stays mounted across the views,
   so an answer still arriving keeps arriving while Team is up. */

export type ConversationsProps = {
  counts: Record<KbCategoryKey, number>;
  readyCount: number;
  canManage: boolean;
  docTitles: Record<string, string>;
  voiceEnabled: boolean;
  initial: { view: ConvView; open: string | null };
  /** The person asking, by name, beside their own turns. */
  you: string;
};

function Place({ counts, readyCount, canManage, docTitles, voiceEnabled, initial, you }: ConversationsProps) {
  const [view, setView] = useState<ConvView>(initial.view);
  const [threadOpen, setThreadOpen] = useState<string | null>(initial.view === "all" ? initial.open : null);

  const write = (v: ConvView, open: string | null) => {
    if (typeof window === "undefined") return;
    window.history.replaceState(null, "", withConvState(window.location.href, { view: v, open }));
  };

  const go = (key: string) => {
    const v = CONV_VIEWS.find((x) => x.key === key)?.key ?? "all";
    setView(v);
    write(v, v === "all" ? threadOpen : null);
  };

  const openThread = (id: string | null) => {
    setThreadOpen(id);
    write("all", id);
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
      frame={({ list, pane }) => {
        const tabs = CONV_VIEWS.map((v) => ({
          key: v.key,
          label: v.label,
        }));
        let side = list;
        let main = pane;
        if (view === "team") {
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
