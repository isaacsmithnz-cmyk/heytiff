"use client";

import { Activity, useContext, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { toneOf } from "@/components/workboard/board/derive";
import { RecordsContext, WindowsContext, titleOf, type Win } from "./records-context";
import { isPinned, pin, pinsServerSnapshot, pinsSnapshot, subscribePins, unpin } from "@/components/shell/pins-store";

/* A visit's sheet and an agreement's load when one opens: they carry the
   maintenance board's actions with them. */
const VisitSheet = dynamic(() => import("@/components/workboard/board/visit-sheet").then((m) => m.VisitSheet), {
  ssr: false,
});
const AgreementSheet = dynamic(
  () => import("@/components/workboard/board/agreement-sheet").then((m) => m.AgreementSheet),
  { ssr: false },
);

/** The open records, drawn: the board's own sheet for each, wherever it was
    opened — a maintenance visit's, a service agreement's.
    Drawn by the shell through `RecordWindowsSlot` (loaded when a record
    opens), or directly by a page that hosts its own records.

    A card set aside stays drawn, hidden, so it comes back as it was left;
    each card is kept in the place it was first opened in, so moving it
    between the dock and the front never remounts it. */
export function RecordWindows({ manage }: { manage: boolean }) {
  const host = useContext(WindowsContext);
  const records = useContext(RecordsContext);
  if (!host) return null;
  const { windows, close, reload, toast } = host;
  return (
    <>
      {windows.map((w) => (
        <Activity key={w.key} mode={w.aside ? "hidden" : "visible"}>
          {/* Each sheet portals itself to <body>. */}
          {w.body.kind === "visit" ? (
            <VisitSheet
              visit={w.body.card.visit}
              tone={toneOf(w.body.card.visit, w.body.card.today)}
              today={w.body.card.today}
              staff={w.body.card.staff}
              tagPool={w.body.card.tagPool}
              manage={manage}
              connected={w.body.card.connected}
              history={w.body.card.history}
              lastDone={w.body.card.lastDone}
              siteAddress={w.body.card.siteAddress}
              siteRequirements={w.body.card.siteRequirements}
              equipment={w.body.card.equipment}
              windowControls={<WindowControls win={w} />}
              /* The band's chip and a History row are doors to records of
                 their own: each opens in this card's place. */
              onOpenAgreement={(id) => records?.open({ kind: "agreement", id })}
              onOpenVisit={(id) => records?.open({ kind: "visit", id })}
              onToast={toast}
              onChanged={() => reload(w.key)}
              onClose={() => close(w.key)}
            />
          ) : (
            <AgreementSheet
              agreement={w.body.card.agreement}
              categories={w.body.card.categories}
              tagPool={w.body.card.tagPool}
              today={w.body.card.today}
              manage={manage}
              windowControls={<WindowControls win={w} />}
              onToast={toast}
              onChanged={() => reload(w.key)}
              onClose={() => close(w.key)}
            />
          )}
        </Activity>
      ))}
    </>
  );
}

/* THE WINDOW'S OWN CONTROLS, in the card's band beside its menu: what a
   card opened where you are can do that a card on the board cannot. Each
   carries its word (law 25).

     SET ASIDE, into the dock, where the frame has one. */
function WindowControls({ win }: { win: Win }) {
  const host = useContext(WindowsContext);
  const pins = useSyncExternalStore(subscribePins, pinsSnapshot, pinsServerSnapshot);
  const pinned = isPinned(pins, win.ref);

  if (!host) return null;
  return (
    <span className="wb2-jcwin">
      {/* PIN (v2, rules 6 and 53): keeps this record in the sidebar's Pinned */}
      <button
        type="button"
        className="pbtn ghost sm"
        aria-pressed={pinned}
        onClick={async () => {
          const ok = pinned ? await unpin(win.ref) : await pin({ ref: win.ref, ...titleOf(win.body) });
          if (!ok) host.toast(pinned ? "That didn't unpin. Try it again." : "That didn't pin. Try it again.");
        }}
      >
        {pinned ? "Unpin" : "Pin"}
      </button>
      {host.docked && (
        <button type="button" className="pbtn ghost sm" onClick={() => host.setAside(win.key)}>
          Set aside
        </button>
      )}
    </span>
  );
}
