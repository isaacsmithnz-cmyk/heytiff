"use client";

import { useState } from "react";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { fmtAud } from "@/lib/workboard/project-money";
import {
  awaitingPaymentRows,
  MONEY_BASIS,
  quotesCountLine,
  type AllJobRow,
  type AllJobsView,
} from "@/lib/workboard/all-jobs";
import { Sm8Gap, sm8Gap } from "./sm8-gap";
import { isAwaitingPayment } from "@/lib/workboard/job-money";
import { Fact, Inspector, Ledger, Reading, Split } from "./inspector";

/* The three panels of the All jobs side. Rows, not cards: at 500-plus open
   jobs a card per job is a wall, and this list is read by scanning down one
   column at a time. The row is deliberately the ledger idiom the agreements
   tab already uses — number, who, what, where, when — so the third side reads
   as the same software as the other two.

   THE NUMBER BELONGS TO WHOEVER OWNS THE ROW. A ServiceM8 row wears
   ServiceM8's number; one of ours wears ours (#1001 up). Both families are
   four digits, so neither is ever rendered bare: the label says which. */

type Props = {
  view: AllJobsView;
  today: string;
  moneyVisible: boolean;
  truncated: boolean;
  connected: boolean;
  /** Connected, but the `jobs` backfill hasn't finished its first walk. */
  syncing: boolean;
  manage: boolean;
  onOpen: (row: AllJobRow) => void;
};

const dayOf = (naive: string | null) => (naive ? naive.slice(0, 10) : null);

/* A CLICK SELECTS; IT NO LONGER OPENS. The sheet used to open whole to show
   a description the row had truncated, and had to be dismissed before the
   next row could be read. The inspector beside the list shows that and the
   rest of what the row knows, and the next click replaces it — which is how a
   list of five hundred is actually read. The sheet is one press further:
   "Open job" in the inspector, or a double-click here. */
function Row({
  row,
  moneyVisible,
  selected,
  onSelect,
  onOpen,
}: {
  row: AllJobRow;
  moneyVisible: boolean;
  selected: boolean;
  onSelect: (row: AllJobRow) => void;
  onOpen: (row: AllJobRow) => void;
}) {
  const date = dayOf(row.date);
  return (
    <button
      className={"wb2-ajr as-btn" + (selected ? " on" : "")}
      aria-pressed={selected}
      onClick={() => onSelect(row)}
      onDoubleClick={() => onOpen(row)}
      aria-label={`${row.clientName ?? "Unnamed client"}${row.number ? `, #${row.number}` : ""}`}
    >
      <span className="wb2-ajnum">
        {row.number ? (
          <>
            <b>#{row.number}</b>
            <em>{row.numberSystem === "sm8" ? "ServiceM8" : "HeyTiff"}</em>
          </>
        ) : (
          <em>—</em>
        )}
      </span>

      <div className="wb2-trt">
        <b>{row.clientName ?? "Unnamed client"}</b>
        <em>{row.title ?? "No description"}</em>
      </div>

      <span className="wb2-ajmeta">
        {row.categoryName && (
          <i className="wb2-chip">
            {row.categoryColour && (
              <span className="wb2-catdot" style={{ background: row.categoryColour }} aria-hidden />
            )}
            {row.categoryName}
          </i>
        )}
        {row.suburb && <em>{row.suburb}</em>}
      </span>

      <div className="wb2-trd">
        {date ? (
          <>
            <b>{fmtAuWeekdayDayMonth(date)}</b>
            <em>{row.dateLabel}</em>
          </>
        ) : (
          <em>{row.dateLabel}</em>
        )}
      </div>

      <span className="wb2-ajchips">
        {row.tracked && (
          <i className="wb2-chip blue">
            {row.tracked.kind === "visit"
              ? `On the board ${row.tracked.label}`
              : `Project — ${row.tracked.label}`}
          </i>
        )}
        {row.tone !== "" && <i className={`wb2-chip ${row.tone}`}>{row.statusLabel}</i>}
        {/* A quote that was never emailed is an action gap, not a wait — the
            chip says which of the two this row is. Rides the money grant like
            every other fact from the money columns.

            ONLY when ServiceM8 actually said. The flag is absent on every job
            in the live account, and a null read as false put "Not sent yet"
            on 304 quotes that may well have gone out — an action gap invented
            out of silence. */}
        {moneyVisible && row.money && row.statusLabel === "Quote" && row.money.quoteSent !== null && (
          <i className={`wb2-chip${row.money.quoteSent ? "" : " warn"}`}>
            {row.money.quoteSent ? "Quote sent" : "Not sent yet"}
          </i>
        )}
        {/* Done but not paid is the question a finished list is really asked —
            and it is answered from payment ROWS, so it fires on the eleven
            jobs genuinely outstanding rather than on everything (the invoice
            flag never arrives, and a flag read lit the chip nowhere at all).
            A part payment says so, because "some of it came in" is a
            different conversation from "none of it did". */}
        {moneyVisible && row.money?.collection === "awaiting" && (
          <i className="wb2-chip warn">Awaiting payment</i>
        )}
        {moneyVisible && row.money?.collection === "part" && (
          <i className="wb2-chip warn">
            Part paid — {fmtAud(row.money.valueCents! - row.money.paidCents)} to come
          </i>
        )}
        {/* NO chip for a paid job, deliberately. Only 39 completed jobs carry
            a total at all, while 1,819 have payments against no total — so a
            green "Paid" on the few would imply the many were unpaid, which is
            the same false inference in a happier colour. A chip here means
            money is OUT; its absence means nothing to chase. */}
      </span>

      {/* The column has no header to hang the basis off, and repeating it on
          every row would drown the figures — so it rides as the cell's title
          and is stated plainly on the sheet this row opens. */}
      {moneyVisible && (
        <span
          className="wb2-money wb2-ajmoney"
          title={`ServiceM8's job total — ${MONEY_BASIS}`}
        >
          {row.money?.valueCents != null ? <b>{fmtAud(row.money.valueCents)}</b> : <em>—</em>}
        </span>
      )}
    </button>
  );
}

function Rows({
  rows,
  moneyVisible,
  selected,
  onSelect,
  onOpen,
}: {
  rows: AllJobRow[];
  moneyVisible: boolean;
  selected: string | null;
  onSelect: (row: AllJobRow) => void;
  onOpen: (row: AllJobRow) => void;
}) {
  return (
    <>
      {rows.map((r) => (
        <Row
          key={r.key}
          row={r}
          moneyVisible={moneyVisible}
          selected={r.key === selected}
          onSelect={onSelect}
          onOpen={onOpen}
        />
      ))}
    </>
  );
}

/* ── THE LIST'S ONE TOOLBAR ──
   Each panel opened on a head that restated the tab — an icon in a tinted
   square, the tab's own name, and a sentence of counts under it — with, on
   Completed, a second sentence under THAT ("41 of these are invoiced and
   still awaiting payment"). The tab above already names the list, so the row
   says only what the counts are, and where a count is a question somebody
   asks of the list, it is the filter that answers it.

   A chip is for something you tap (law 26), so a count that filters nothing
   is a sentence, not a chip: Quotes has no split the data can make honestly —
   "sent this week" needs a sent date, and the sent flag is absent on every
   quote in the live account — so its row is the sentence alone. */
type Chip<K extends string> = { key: K; label: string; n: number; tone?: "warn" };

function ListBar<K extends string>({
  chips,
  value,
  onChange,
  sentence,
}: {
  chips?: Chip<K>[];
  value?: K;
  onChange?: (k: K) => void;
  sentence?: string;
}) {
  return (
    <div className="wb2-tbar">
      {chips && value !== undefined && onChange ? (
        <div className="wb2-fchips" role="group" aria-label="Show">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              className={"wb2-fchip" + (c.key === value ? " on" : "")}
              aria-pressed={c.key === value}
              onClick={() => onChange(c.key)}
            >
              {c.label}{" "}
              <i className={c.tone}>{c.n}</i>
            </button>
          ))}
        </div>
      ) : (
        sentence && <span className="wb2-tbh2">{sentence}</span>
      )}
    </div>
  );
}

/* ── THE ROW, IN THE INSPECTOR ──
   Everything the row knows, set as the staff card's ledger: what state it is
   in, when, where, what tracks it and what it is worth — and the description
   the row had to truncate, in full. The state is a WORD in its state colour
   (law 26); the chip vocabulary stays on the row for now. The one action is
   the one that exists: the job opens in its sheet, or a native row on the
   board that owns it. Nothing here offers to write back to ServiceM8, because
   nothing can — the mirror is read-only by charter. */
function RowInspector({
  row,
  moneyVisible,
  onOpen,
  onClose,
}: {
  row: AllJobRow;
  moneyVisible: boolean;
  onOpen: (row: AllJobRow) => void;
  onClose: () => void;
}) {
  const date = dayOf(row.date);
  const m = moneyVisible ? row.money : null;
  const openWord =
    row.kind === "sm8" ? "Open job" : row.kind === "visit" ? "Open the visit" : "Open the project";
  const owed = m && isAwaitingPayment(m.collection);

  return (
    <Inspector
      label={`${row.clientName ?? "Unnamed client"}${row.number ? `, #${row.number}` : ""}`}
      kicker={
        row.number ? (
          <>
            <b>#{row.number}</b>
            {row.numberSystem === "sm8" ? "ServiceM8" : "HeyTiff"}
          </>
        ) : undefined
      }
      title={row.clientName ?? "Unnamed client"}
      onClose={onClose}
      actions={
        <button type="button" className="pbtn primary" onClick={() => onOpen(row)}>
          {openWord}
        </button>
      }
    >
      <Ledger>
        <Fact label="Status">
          <span className={"wb2-inspword" + (row.tone ? ` ${row.tone}` : "")}>{row.statusLabel}</span>
        </Fact>
        <Fact label={date ? row.dateLabel.charAt(0).toUpperCase() + row.dateLabel.slice(1) : "Date"}>
          {date ? fmtAuWeekdayDayMonth(date) : <span className="wb2-inspnone">{row.dateLabel}</span>}
        </Fact>
        {row.categoryName && (
          <Fact label="Category">
            <span className="wb2-inspcat">
              {row.categoryColour && (
                <span className="wb2-catdot" style={{ background: row.categoryColour }} aria-hidden />
              )}
              {row.categoryName}
            </span>
          </Fact>
        )}
        {row.suburb && <Fact label="Site">{row.suburb}</Fact>}
        {row.tracked && (
          <Fact label="Tracked">
            {row.tracked.kind === "visit"
              ? `On the board ${row.tracked.label}`
              : `Project — ${row.tracked.label}`}
          </Fact>
        )}
        {m && (
          <Fact label={`Total, ${MONEY_BASIS}`}>
            {m.valueCents != null ? fmtAud(m.valueCents) : <span className="wb2-inspnone">Not recorded</span>}
            {m.collection === "part" && m.valueCents != null ? (
              <small className="wb2-inspword warn">
                Part paid — {fmtAud(m.valueCents - m.paidCents)} to come
              </small>
            ) : owed ? (
              <small className="wb2-inspword warn">Awaiting payment</small>
            ) : null}
          </Fact>
        )}
        {m && row.statusLabel === "Quote" && m.quoteSent !== null && (
          <Fact label="Quote">
            <span className={"wb2-inspword" + (m.quoteSent ? "" : " warn")}>
              {m.quoteSent ? "Sent" : "Not sent yet"}
            </span>
          </Fact>
        )}
      </Ledger>

      <Reading label="Description">
        {row.title ? <p>{row.title}</p> : <p className="wb2-inspnone">No description</p>}
      </Reading>
    </Inspector>
  );
}

/** Selection is per panel, and a row that leaves the list takes the panel with it. */
function useSelection(rows: AllJobRow[]) {
  const [key, setKey] = useState<string | null>(null);
  const row = key ? (rows.find((r) => r.key === key) ?? null) : null;
  return {
    key: row ? key : null,
    row,
    select: (r: AllJobRow) => setKey(r.key),
    clear: () => setKey(null),
  };
}

/** What an empty panel says depends on WHY it's empty — no integration, a
    first sync still running, or genuinely nothing on. Those are three
    different situations and one sentence for all of them helps nobody. The
    two integration answers come from sm8-gap, which the diary shares; the
    search miss moved to the search panel, with the box that causes it. */
function Empty({
  connected,
  syncing,
  manage,
  icon,
  nothing,
  hint,
}: {
  connected: boolean;
  syncing: boolean;
  manage: boolean;
  icon: string;
  nothing: string;
  hint: string;
}) {
  /* An empty list that can be EXPLAINED explains itself, and the explanation
     outranks the panel's own "nothing on" copy: told there is no work when
     nothing has been connected, you learn nothing about why. */
  const gap = sm8Gap({ connected, syncing });
  if (gap) return <Sm8Gap kind={gap} surface="jobs" manage={manage} />;

  return (
    <div className="wb2-empty">
      <Icon name={icon} size={20} />
      <b>{nothing}</b>
      <em>{hint}</em>
    </div>
  );
}

export function WorkOrdersTab(props: Props) {
  const v = props.view;
  const total = v.work.booked.length + v.work.unbooked.length;
  const [show, setShow] = useState<"all" | "booked" | "waiting">("all");
  const booked = show === "waiting" ? [] : v.work.booked;
  const unbooked = show === "booked" ? [] : v.work.unbooked;
  const sel = useSelection([...booked, ...unbooked]);

  return (
    <>
      {total > 0 && (
        <ListBar
          value={show}
          onChange={setShow}
          chips={[
            { key: "all", label: "All", n: total },
            { key: "booked", label: "Booked", n: v.work.booked.length },
            { key: "waiting", label: "Waiting on a day", n: v.work.unbooked.length },
          ]}
        />
      )}
      <Split
        aside={
          sel.row && (
            <RowInspector
              row={sel.row}
              moneyVisible={props.moneyVisible}
              onOpen={props.onOpen}
              onClose={sel.clear}
            />
          )
        }
      >
        {props.truncated && (
          <p className="int-hint">
            Showing the newest jobs — this account has more open than one screen carries. Search
            reaches all of them.
          </p>
        )}

        {total === 0 ? (
          <Empty
            connected={props.connected}
            syncing={props.syncing}
            manage={props.manage}
            icon="wrench"
            nothing="Nothing on"
            hint="Every open job in ServiceM8 lands here, plus the work tracked only in HeyTiff."
          />
        ) : (
          <>
            {/* the group heads only earn their place while both groups show */}
            {show === "all" && booked.length > 0 && (
              <div className="wb2-sect">
                Booked in<em>Somebody is going</em>
              </div>
            )}
            <Rows
              rows={booked}
              moneyVisible={props.moneyVisible}
              selected={sel.key}
              onSelect={sel.select}
              onOpen={props.onOpen}
            />

            {show === "all" && unbooked.length > 0 && (
              <div className="wb2-sect">
                Waiting on a day<em>Open, with nobody rostered yet</em>
              </div>
            )}
            <Rows
              rows={unbooked}
              moneyVisible={props.moneyVisible}
              selected={sel.key}
              onSelect={sel.select}
              onOpen={props.onOpen}
            />
          </>
        )}
      </Split>
    </>
  );
}

export function QuotesTab(props: Props) {
  const v = props.view;
  const sel = useSelection(v.quotes);

  return (
    <>
      {v.quotes.length > 0 && <ListBar sentence={quotesCountLine(v)} />}
      <Split
        aside={
          sel.row && (
            <RowInspector
              row={sel.row}
              moneyVisible={props.moneyVisible}
              onOpen={props.onOpen}
              onClose={sel.clear}
            />
          )
        }
      >
        {v.quotes.length === 0 ? (
          <Empty
            connected={props.connected}
            syncing={props.syncing}
            manage={props.manage}
            icon="file"
            nothing="No quotes out"
            hint="Quotes live in ServiceM8 — anything quoted and unanswered shows here."
          />
        ) : (
          <Rows
            rows={v.quotes}
            moneyVisible={props.moneyVisible}
            selected={sel.key}
            onSelect={sel.select}
            onOpen={props.onOpen}
          />
        )}
      </Split>
    </>
  );
}

export function CompletedJobsTab(props: Props) {
  const v = props.view;
  /* "Didn't go ahead" was a toggle button under the list, and "awaiting
     payment" a sentence above it. Both are ways of narrowing what is shown,
     so both are filters — and a filter with nothing in it is not offered.

     THE CHIP'S COUNT IS THE LENGTH OF THE ROWS IT SHOWS — `awaitingPaymentRows`,
     the one rule (money known, some of it still out) — so the figure on the
     chip and the rows under it cannot disagree. It rides the money grant. */
  const owed = props.moneyVisible ? awaitingPaymentRows(v) : [];
  const [show, setShow] = useState<"all" | "owed" | "unsuccessful">("all");
  const shown = show === "owed" ? owed : show === "unsuccessful" ? v.unsuccessful : v.completed;
  const sel = useSelection(shown);

  const chips: Chip<"all" | "owed" | "unsuccessful">[] = [
    { key: "all", label: "All", n: v.completed.length },
  ];
  if (owed.length > 0) chips.push({ key: "owed", label: "Awaiting payment", n: owed.length, tone: "warn" });
  if (v.unsuccessful.length > 0)
    chips.push({ key: "unsuccessful", label: "Didn't go ahead", n: v.unsuccessful.length });

  return (
    <>
      {(v.completed.length > 0 || v.unsuccessful.length > 0) && (
        <ListBar value={show} onChange={setShow} chips={chips} />
      )}
      <Split
        aside={
          sel.row && (
            <RowInspector
              row={sel.row}
              moneyVisible={props.moneyVisible}
              onOpen={props.onOpen}
              onClose={sel.clear}
            />
          )
        }
      >
        {shown.length === 0 && show === "all" ? (
          <Empty
            connected={props.connected}
            syncing={props.syncing}
            manage={props.manage}
            icon="check"
            nothing="Nothing finished recently"
            hint="The last eight weeks of finished work shows here; search reaches further back."
          />
        ) : (
          <Rows
            rows={shown}
            moneyVisible={props.moneyVisible}
            selected={sel.key}
            onSelect={sel.select}
            onOpen={props.onOpen}
          />
        )}
      </Split>
    </>
  );
}
