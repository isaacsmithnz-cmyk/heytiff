"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icon";
import { actionRequiredItems } from "@/app/actions/action-required";
import { myDueReminders, snoozeReminder } from "@/app/actions/reminders";
import { completeTask } from "@/app/actions/dashboard";
import { GROUP_ICON, chipGroup, type ActionChip } from "@/lib/dashboard/chips";
import {
  SNOOZE,
  SNOOZE_LABEL,
  lateness,
  type DueReminder,
  type Snooze,
} from "@/lib/dashboard/reminders";

/* THE BELL, AND WHAT IT OPENS.

   It shipped as a `<button>` with no handler wearing a teal dot that pulsed on
   every screen forever — the CSS drew the dot unconditionally, so it never
   meant anything and could never stop meaning it. It became a LINK to
   /dashboard/action-required, which fixed the badge but bought a new problem:
   the only way to find out whether the number was worth caring about was to
   abandon the screen you were on. Notifications are an interruption you glance
   at; a whole route is one you commit to.

   So the list grows down out of the bell instead — the same dark glass as the
   user menu two controls to the right, absolutely positioned inside a relative
   wrapper rather than `fixed`, because the `.page.in` will-change trap breaks
   `position:fixed` in this shell. It is a plain popover with NO scrim: a scrim
   would put a body-portalled layer over `.fg`, which traps everything under it,
   and there is nothing here worth blocking the page for.

   The board at /dashboard/action-required is still there and still the whole
   truth — the panel caps at PANEL_CAP rows and says so, and the footer is the
   way through to the rest. That link is absent when nothing was cut: a "see
   all" under a list that already IS all is a lie about there being more. */

/* WHAT ELSE IS IN HERE NOW: reminders, above the chips and not among them.

   An ActionChip is one actionable EXPIRY — a licence, a rego, a claim waiting
   on a decision — and its state is bad | warn, nothing else. A reminder coming
   due is not a failure and must not wear red or amber: on this app those two
   colours never stop meaning something is wrong. Forcing one into the chip
   vocabulary would also have dragged it onto /dashboard/action-required, which
   is a compliance board and not a place to keep your own to-do list.

   So they are a separate group with their own row, and the only thing they
   share with the chips is the badge — which is the honest part, because "three
   things need you" is a count of everything that needs you. */

/** How many rows the panel will draw before it stops and points at the board. */
const PANEL_CAP = 20;

/* HOW OFTEN THE BELL LOOKS AGAIN.

   It used to read once per full page load, which the shell survives — so the
   number was accurate the moment you arrived and never again. That was livable
   for expiries, which change on the scale of days. It is not livable for a
   reminder: the whole promise is that 6:30 arrives while you are already
   sitting on a screen, and a nudge that waits for a navigation is not a nudge.

   A minute is chosen against what it costs — one small query per tab per
   minute, and only while the tab is being LOOKED at. A backgrounded tab polls
   nothing and catches up on the way back in, which is also the moment most
   people find out anything happened. */
const POLL_MS = 60_000;

function panelLabel(count: number | null): string {
  if (count === null) return "What needs you";
  if (count === 0) return "Nothing needs you";
  return `${count} ${count === 1 ? "thing needs" : "things need"} you`;
}

export function Bell() {
  const [items, setItems] = useState<ActionChip[] | null>(null);
  const [rems, setRems] = useState<DueReminder[]>([]);
  /* Which reminder is showing its snooze choices, by task id. Held HERE rather
     than in the panel so `BellPanel` keeps no state of its own and an inert
     harness route can still render it against the real stylesheet — see the
     note on the panel below. */
  const [snoozing, setSnoozing] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  /* Same trick as the user menu: store the route the panel was opened on
     rather than a plain boolean, so navigating away closes it by construction
     — no setState-in-effect, and clicking a row inside it closes the panel it
     was clicked from. */
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const open = openedAt === pathname;

  /* Still mounted? A read in flight when the shell unmounts must not land, and
     a ref rather than an effect-local flag because these reads are shared by
     the poll, the two row actions and the first read — one answer to "am I
     still here", not four. */
  const live = useRef(true);

  /* TWO READS, ON TWO CLOCKS, AND THE ASYMMETRY IS THE POINT.

     `actionRequiredItems` assembles seven sources — licences, work rights,
     three vehicle facts, org credentials and two approval queues — into one
     list. It is not a cheap question, and its answers change on the scale of
     DAYS: a rego does not expire between one minute and the next. Polling it
     every minute in every open tab would multiply the dashboard's heaviest read
     by sixty an hour to catch something that moves once a month.

     Reminders are the opposite: one indexed query against one table, and the
     whole promise is that 06:30 arrives while you are already looking at a
     screen. So the minute belongs to that one, and the expensive half is asked
     on arrival and on coming back to the tab — the two moments it could
     plausibly have changed since you last saw it. */
  const loadRems = useCallback(async () => {
    const due = await myDueReminders().catch(() => null);
    if (live.current && due) setRems(due);
  }, []);

  const loadAll = useCallback(async () => {
    const [chips] = await Promise.all([actionRequiredItems().catch(() => null), loadRems()]);
    /* A failed read leaves the last good answer standing rather than blanking
       the badge: a bell that empties itself on a dropped connection is telling
       you nothing needs you, which is a different claim from "I couldn't ask". */
    if (live.current && chips) setItems(chips);
  }, [loadRems]);

  useEffect(() => {
    live.current = true;

    /* THE FIRST READ IS UNCONDITIONAL — it fills in the number the topbar shows
       on every screen, and gating it on visibility would leave a bell that
       mounted in a background tab permanently blank rather than merely stale.
       Only the REPEAT reads care whether anyone is looking.

       Deferred by a microtask so the setState lands after this render commits
       rather than during it (`react-hooks/set-state-in-effect`) — the same
       property the old inline `.then(setItems)` had, kept deliberately. */
    void Promise.resolve().then(loadAll);

    const id = setInterval(() => {
      if (document.visibilityState === "visible") void loadRems();
    }, POLL_MS);

    /* Coming back to the tab is the other moment worth asking, and the one
       people actually notice: a laptop opened at 8am should not wait out the
       rest of a minute that started before it was shut. This one asks for
       EVERYTHING — a tab that has been shut since yesterday may have missed an
       expiry as easily as a reminder. */
    const onShow = () => {
      if (document.visibilityState === "visible") void loadAll();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      live.current = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [loadAll, loadRems]);

  /* Acting on a reminder drops it from the list before the server answers. The
     row is gone because you just dealt with it, and waiting a round trip to
     admit that makes a one-tap action feel broken; the re-read afterwards is
     what makes the optimism honest if the write failed. */
  const done = useCallback(
    async (taskId: string) => {
      setRems((r) => r.filter((x) => x.taskId !== taskId));
      setSnoozing(null);
      await completeTask(taskId).catch(() => {});
      void loadRems();
    },
    [loadRems],
  );

  const snooze = useCallback(
    async (taskId: string, preset: Snooze) => {
      setRems((r) => r.filter((x) => x.taskId !== taskId));
      setSnoozing(null);
      await snoozeReminder(taskId, preset).catch(() => {});
      void loadRems();
    },
    [loadRems],
  );

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpenedAt(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenedAt(null);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /* The badge counts EVERYTHING that needs you, reminders included — two
     numbers in the topbar would make a person add them up to answer the
     question the badge exists to answer. Null only while the first read is in
     flight, so a bell that has never loaded stays silent rather than claiming
     zero. */
  const count = items === null ? null : items.length + rems.length;
  const label = panelLabel(count);
  return (
    <div className="bell-top" ref={wrapRef}>
      <button
        className={`bell${open ? " on" : ""}`}
        type="button"
        onClick={() => setOpenedAt((o) => (o === pathname ? null : pathname))}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title={label}
      >
        <Icon name="bell" size={20} />
        {/* `.d` is a COUNT and only renders when there is something to count,
            so it no longer pulses: a number that is present at all is already
            the signal, and an animation that ran forever was what made the old
            dot invisible. A failed read leaves it silent rather than guessing. */}
        {count !== null && count > 0 && (
          <span className="d" aria-hidden="true">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <BellPanel
          items={items}
          reminders={rems}
          label={label}
          snoozing={snoozing}
          onSnoozeOpen={(id) => setSnoozing((s) => (s === id ? null : id))}
          onSnooze={snooze}
          onDone={done}
          onLeave={() => setOpenedAt(null)}
        />
      )}
    </div>
  );
}

/* The panel itself, split out with no state of its own so it can be rendered
   against the real stylesheet at the real font by an inert harness route —
   jest ignores CSS entirely, and a 360px popover that scrolls is exactly the
   kind of thing that is only ever wrong on screen. */
export function BellPanel({
  items,
  reminders = [],
  label,
  snoozing = null,
  onSnoozeOpen,
  onSnooze,
  onDone,
  onLeave,
}: {
  items: ActionChip[] | null;
  reminders?: DueReminder[];
  label: string;
  /** Task id whose snooze choices are showing, if any. */
  snoozing?: string | null;
  onSnoozeOpen?: (taskId: string) => void;
  onSnooze?: (taskId: string, preset: Snooze) => void;
  onDone?: (taskId: string) => void;
  onLeave: () => void;
}) {
  const count = (items?.length ?? 0) + reminders.length;
  const shown = items?.slice(0, PANEL_CAP) ?? [];
  const cut = (items?.length ?? 0) - shown.length;
  const empty = items !== null && items.length === 0 && reminders.length === 0;

  return (
    <div className="bell-panel" role="dialog" aria-label={label}>
      <div className="bp-head">
        <b>Needs you</b>
        {count > 0 && <span className="bp-n">{count}</span>}
      </div>

      {/* ONE SCROLLER FOR BOTH GROUPS. They were siblings of the panel's flex
          column at first, which gave a long reminder list its own scrollbar
          beside the chips' — two bars in a 360px popover, and neither of them
          able to reach the other group's rows. The head and the footer still
          stay put; only this moves. */}
      <div className="bp-scroll">
      {/* REMINDERS FIRST, and uncapped. You asked for these by name, at a time
          you chose; a licence expiring in three weeks did not. There is no
          "see all" behind them because there is no board to see them on —
          every reminder you have is already here. */}
      {reminders.length > 0 && (
        <div className="bp-rems">
          <div className="bp-grp">You asked to be reminded</div>
          {reminders.map((r) => (
            <div className="bp-rem" key={r.taskId}>
              <div className="bp-remrow">
                <span className="bp-ic">
                  <Icon name="bell" size={15} />
                </span>
                <span className="bp-main">
                  <b>{r.title}</b>
                  {/* A CLOCK IN A RENDER BODY, and safe only because this
                      subtree cannot server-render: `open` is `openedAt ===
                      pathname` with `openedAt` starting null, so the panel is
                      absent from the first render on both sides. Render
                      `BellPanel` from a server component and `lateness` reads
                      two different clocks — which takes out the hydration of
                      the whole tree, not just this line. */}
                  <em>{lateness(r.remindAt)}</em>
                </span>
                <span className="bp-remacts">
                  <button
                    type="button"
                    className="bp-remdo"
                    onClick={() => onDone?.(r.taskId)}
                    /* Named, not "Done" alone — a column of identical buttons
                       is one button to anyone reading it out. */
                    aria-label={`Mark done — ${r.title}`}
                    title="Mark done"
                  >
                    <Icon name="check" size={14} />
                  </button>
                  <button
                    type="button"
                    className={"bp-remsnz" + (snoozing === r.taskId ? " on" : "")}
                    aria-expanded={snoozing === r.taskId}
                    onClick={() => onSnoozeOpen?.(r.taskId)}
                    aria-label={`Remind me later — ${r.title}`}
                  >
                    Later
                  </button>
                </span>
              </div>
              {snoozing === r.taskId && (
                <div className="bp-snooze" role="group" aria-label={`Remind me — ${r.title}`}>
                  {SNOOZE.map((k) => (
                    <button
                      type="button"
                      key={k}
                      className="bp-snzopt"
                      onClick={() => onSnooze?.(r.taskId, k)}
                    >
                      {SNOOZE_LABEL[k]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {items === null ? (
        reminders.length === 0 ? <div className="bp-quiet">Checking…</div> : null
      ) : empty ? (
        <div className="bp-empty">
          <span className="bp-ei">
            <Icon name="check" size={18} />
          </span>
          <b>Nothing needs you</b>
          <em>Everything is in date and nobody is waiting on an answer.</em>
        </div>
      ) : items.length === 0 ? null : (
        <div className="bp-list">
          {shown.map((c) => (
            <Link key={c.key} className={`bp-row ${c.state}`} href={c.href} onClick={onLeave}>
              <span className="bp-ic">
                <Icon name={GROUP_ICON[chipGroup(c.kind)]} size={15} />
              </span>
              <span className="bp-main">
                <b>{c.label}</b>
                <em>
                  {c.subject} · {chipGroup(c.kind)}
                </em>
              </span>
              <span className="bp-chev">
                <Icon name="arrowR" size={15} />
              </span>
            </Link>
          ))}
        </div>
      )}
      </div>

      {/* Present ONLY when rows were actually cut: a "see all" under a list
          that is already all of it is a lie about there being more. */}
      {cut > 0 && (
        <Link className="bp-more" href="/dashboard/action-required" onClick={onLeave}>
          {cut} more on the board
          <Icon name="arrowR" size={14} />
        </Link>
      )}
    </div>
  );
}
