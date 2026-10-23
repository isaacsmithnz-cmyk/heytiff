"use client";

import { useCallback, useContext, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { completeTask, reopenTask } from "@/app/actions/dashboard";
import { snoozeReminder } from "@/app/actions/reminders";
import { acknowledgeTask } from "@/app/actions/assignments";
import { WindowsContext } from "@/components/records/records-context";
import { Button, LinkButton } from "@/components/parts/button";
import { Menu } from "@/components/parts/menu";
import { Row, RowList } from "@/components/parts/row";
import { Empty } from "@/components/parts/states";
import { stateTone } from "@/components/parts/state";
import { Tick } from "@/components/parts/tick";
import { Icon } from "@/components/shell/icon";
import { VisitForm, type VisitJob } from "@/components/making/visit-form";
import { TaskForm } from "@/components/making/task-form";
import { BELL_REFRESH_EVENT } from "@/lib/dashboard/chips";
import { SNOOZE, SNOOZE_LABEL, type Snooze } from "@/lib/dashboard/reminders";
import { TODO_HOME_CAP, type TodoRow } from "@/lib/dashboard/todo";

/* HOME › TO DO (v2, rule 39): a dot, the name in bold, a grey line or the
   trouble in its colour, and ONE second button on the right that does the
   thing. A task leads with a tick. The rows are built on the server
   (lib/dashboard/todo); this file draws them and does the three things a
   row can do where you are: tick it done (with Undo), put a reminder off
   (Later), or say you've seen new work (Got it).

   Each of those takes the row away at once and asks the server after,
   as the bell did: a one-tap action that waits a round trip to admit it
   happened feels broken. The sidebar's count is told to ask again
   (`BELL_REFRESH_EVENT`), and the page reads again behind it. */

/** The rows a press has taken away, until the page reads again. */
function useGone() {
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const hide = useCallback((key: string) => setGone((g) => new Set(g).add(key)), []);
  const show = useCallback(
    (key: string) =>
      setGone((g) => {
        const next = new Set(g);
        next.delete(key);
        return next;
      }),
    [],
  );
  return { gone, hide, show };
}

/** After a write: the count asks again, and the page reads again. */
function useAfter() {
  const router = useRouter();
  const [, start] = useTransition();
  return useCallback(() => {
    window.dispatchEvent(new Event(BELL_REFRESH_EVENT));
    start(() => router.refresh());
  }, [router, start]);
}

/** A person's tick, on Today or To do: done, with Undo on the toast. A
    tick posts its Done to ServiceM8 for a task an ask made, and Undo takes
    that back (app/actions/dashboard). */
export function useTaskTick() {
  const host = useContext(WindowsContext);
  const after = useAfter();
  const { gone, hide, show } = useGone();
  const tick = useCallback(
    async (key: string, taskId: string) => {
      hide(key);
      const done = await completeTask(taskId, { postDone: true }).catch(() => null);
      if (!done?.ok) {
        show(key);
        host?.toast(done?.error ?? "Couldn't complete that task.");
        return;
      }
      host?.toast("Task done", async () => {
        await reopenTask(taskId, { takeBackDone: true }).catch(() => null);
        show(key);
        after();
      });
      after();
    },
    [after, hide, host, show],
  );
  return { gone, hide, tick };
}

function LaterButton({ name, onPick }: { name: string; onPick: (s: Snooze) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        ref={ref}
        size={32}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Later, ${name}`}
        onClick={() => setOpen((o) => !o)}
      >
        Later
      </Button>
      <Menu
        anchor={ref}
        open={open}
        onClose={() => setOpen(false)}
        onSelect={(key) => {
          setOpen(false);
          onPick(key as Snooze);
        }}
        items={SNOOZE.map((k) => ({ key: k, label: SNOOZE_LABEL[k] }))}
        label="Remind me"
        align="end"
      />
    </>
  );
}

/** Rows of To do's kind, in any of Home's columns: a tick for a task, the
    dot, the name, the line, and the one button that does the thing. */
export function TodoList({ rows, label, cap }: { rows: readonly TodoRow[]; label: string; cap?: number }) {
  const after = useAfter();
  const { gone, hide, tick } = useTaskTick();
  /* a won job's Book in: the Visit form over Home, the job filled in */
  const [booking, setBooking] = useState<VisitJob | null>(null);
  /* a task's own form over Home, opened from its row */
  const [opened, setOpened] = useState<string | null>(null);
  const here = rows.filter((r) => !gone.has(r.key));
  const shown = cap != null ? here.slice(0, cap) : here;

  const later = (row: TodoRow, taskId: string, s: Snooze) => {
    hide(row.key);
    void snoozeReminder(taskId, s)
      .catch(() => null)
      .then(after);
  };
  const gotIt = (row: TodoRow, taskId: string) => {
    hide(row.key);
    void acknowledgeTask(taskId)
      .catch(() => null)
      .then(after);
  };

  const end = (row: TodoRow) => {
    const a = row.act;
    if (a.kind === "later") return <LaterButton name={row.name} onPick={(s) => later(row, a.taskId, s)} />;
    if (a.kind === "gotit")
      return (
        <Button size={32} aria-label={`Got it, ${row.name}`} onClick={() => gotIt(row, a.taskId)}>
          Got it
        </Button>
      );
    if (a.kind === "task")
      return (
        <Button size={32} aria-label={`Open, ${row.name}`} onClick={() => setOpened(a.taskId)}>
          Open
        </Button>
      );
    if (a.kind === "bookIn")
      return (
        <Button size={32} aria-label={`${a.label}, ${row.name}`} onClick={() => setBooking({ uuid: a.jobUuid, label: row.name })}>
          {a.label}
        </Button>
      );
    return (
      <Button size={32} href={a.href} aria-label={`${a.label}, ${row.name}`}>
        {a.label}
      </Button>
    );
  };

  if (shown.length === 0) return null;
  return (
    <>
      <RowList label={label}>
        {shown.map((row) => (
          <Row
            key={row.key}
            lead={
              row.tick ? (
                <Tick
                  className="hm-tick"
                  label={<span className="sr-only">Done, {row.name}</span>}
                  onChange={(on) => {
                    if (on && row.tick) void tick(row.key, row.tick);
                  }}
                />
              ) : undefined
            }
            dot={stateTone(row.tone)}
            name={row.name}
            line={row.lineTone ? <span className={`hm-line hm-line--${row.tone}`}>{row.line}</span> : row.line}
            href={row.act.kind === "link" || row.act.kind === "bookIn" ? row.act.href : undefined}
            onClick={row.act.kind === "task" ? () => setOpened((row.act as { taskId: string }).taskId) : row.tick ? () => setOpened(row.tick) : undefined}
            end={end(row)}
          />
        ))}
      </RowList>
      {opened && <TaskForm taskId={opened} onClose={() => setOpened(null)} onChanged={after} />}
      {booking && (
        <VisitForm
          job={booking}
          onClose={() => setBooking(null)}
          /* the won row says where its booking is, and Undo puts it back */
          onBooked={after}
          onUndone={after}
        />
      )}
    </>
  );
}

/** A column's head on Home: a solid block of the column's colour with its
    glyph, ink on it (docs/design.md, text on a solid block), then the
    title at 20, so the three stand apart from the page (Isaac, 20 October:
    "it all blends in"). No count beside it. */
export function ColumnHead({
  id,
  name,
  icon,
  hue,
  level = 2,
  children,
}: {
  id: string;
  name: string;
  icon: string;
  hue: "purple" | "yellow" | "green";
  level?: 1 | 2;
  children?: React.ReactNode;
}) {
  const H = level === 1 ? "h1" : "h2";
  return (
    <div className="hm-head">
      <span className={`hm-blk hm-blk--${hue}`} aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
      <H className={level === 1 ? "hm-title" : "hm-h"} id={id}>
        {name}
      </H>
      {children}
    </div>
  );
}

export function HomeTodo({
  rows,
  all = false,
  headingLevel = 2,
}: {
  rows: readonly TodoRow[];
  /** The whole list (Show all's page); Home shows the first few. */
  all?: boolean;
  headingLevel?: 1 | 2;
}) {
  return (
    <section className="hm-sec" aria-labelledby="hm-todo">
      <ColumnHead id="hm-todo" name="To do" icon="check" hue="yellow" level={headingLevel}>
        {!all && rows.length > TODO_HOME_CAP && (
          <LinkButton href="/dashboard/todo" className="hm-headlink">
            Show all
          </LinkButton>
        )}
      </ColumnHead>
      {rows.length === 0 ? (
        <Empty what="Nothing is waiting on you" action={null} />
      ) : (
        <TodoList rows={rows} label="To do" cap={all ? undefined : TODO_HOME_CAP} />
      )}
    </section>
  );
}
