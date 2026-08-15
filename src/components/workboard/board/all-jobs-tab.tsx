"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { fmtAud } from "@/lib/workboard/project-money";
import {
  awaitingPaymentCount,
  MONEY_BASIS,
  completedCountLine,
  filterView,
  quotesCountLine,
  workCountLine,
  type AllJobRow,
  type AllJobsView,
} from "@/lib/workboard/all-jobs";

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
  query: string;
  onQuery: (q: string) => void;
  onOpen: (row: AllJobRow) => void;
  /** Rows found by the server search, past the loaded window. */
  extra?: AllJobRow[];
  searching?: boolean;
};

const dayOf = (naive: string | null) => (naive ? naive.slice(0, 10) : null);

function Row({
  row,
  moneyVisible,
  onOpen,
}: {
  row: AllJobRow;
  moneyVisible: boolean;
  onOpen: (row: AllJobRow) => void;
}) {
  const date = dayOf(row.date);
  return (
    <button
      className="wb2-ajr as-btn"
      onClick={() => onOpen(row)}
      aria-label={`Open ${row.clientName ?? "job"}${row.number ? ` — ${row.number}` : ""}`}
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
        {/* Done but not paid is the question a finished list is really asked. */}
        {moneyVisible && row.money?.collection === "awaiting" && (
          <i className="wb2-chip warn">Awaiting payment</i>
        )}
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
  onOpen,
}: {
  rows: AllJobRow[];
  moneyVisible: boolean;
  onOpen: (row: AllJobRow) => void;
}) {
  return (
    <>
      {rows.map((r) => (
        <Row key={r.key} row={r} moneyVisible={moneyVisible} onOpen={onOpen} />
      ))}
    </>
  );
}

function Head({
  icon,
  title,
  sub,
  query,
  onQuery,
}: {
  icon: string;
  title: string;
  sub: string;
  query: string;
  onQuery: (q: string) => void;
}) {
  return (
    <div className="wb2-chd">
      <span className="wb2-ci">
        <Icon name={icon} size={19} />
      </span>
      <div>
        <b>{title}</b>
        <em>{sub}</em>
      </div>
      <label className="wb2-agsearch">
        <Icon name="search" size={14} />
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Job number, client, suburb or words in the job"
          aria-label="Search all jobs"
        />
      </label>
    </div>
  );
}

/** What an empty panel says depends on WHY it's empty — no integration, no
    match, or genuinely nothing on. Those are three different situations and
    one sentence for all three helps nobody. */
function Empty({
  connected,
  query,
  icon,
  nothing,
  hint,
}: {
  connected: boolean;
  query: string;
  icon: string;
  nothing: string;
  hint: string;
}) {
  if (query.trim()) {
    return (
      <div className="wb2-empty">
        <Icon name="search" size={20} />
        <b>Nothing matches “{query.trim()}”</b>
        <em>Search reads the job number, the client, the suburb and the job&apos;s own words.</em>
      </div>
    );
  }
  if (!connected) {
    return (
      <div className="wb2-empty">
        <Icon name="plug" size={20} />
        <b>Showing the work tracked here</b>
        <em>
          Connect ServiceM8 and every job in the account joins this list — service calls and
          installs included.
        </em>
      </div>
    );
  }
  return (
    <div className="wb2-empty">
      <Icon name={icon} size={20} />
      <b>{nothing}</b>
      <em>{hint}</em>
    </div>
  );
}

function Extra({
  rows,
  moneyVisible,
  searching,
  query,
  onOpen,
}: {
  rows: AllJobRow[];
  moneyVisible: boolean;
  searching: boolean;
  query: string;
  onOpen: (row: AllJobRow) => void;
}) {
  if (!query.trim()) return null;
  if (searching) return <p className="int-hint">Looking through the rest of ServiceM8…</p>;
  if (rows.length === 0) return null;
  return (
    <>
      <div className="wb2-sect">
        Found elsewhere in ServiceM8
        <em>Older than this board&apos;s window, or on another tab</em>
      </div>
      <Rows rows={rows} moneyVisible={moneyVisible} onOpen={onOpen} />
    </>
  );
}

export function WorkOrdersTab(props: Props) {
  const v = useMemo(() => filterView(props.view, props.query), [props.view, props.query]);
  const total = v.work.booked.length + v.work.unbooked.length;
  const extra = props.extra ?? [];

  return (
    <>
      <Head
        icon="wrench"
        title="Work orders"
        sub={workCountLine(v)}
        query={props.query}
        onQuery={props.onQuery}
      />
      {props.truncated && !props.query.trim() && (
        <p className="int-hint">
          Showing the newest jobs — this account has more open than one screen carries. Search
          reaches all of them.
        </p>
      )}

      {total === 0 && extra.length === 0 ? (
        <Empty
          connected={props.connected}
          query={props.query}
          icon="wrench"
          nothing="Nothing on"
          hint="Every open job in ServiceM8 lands here, plus the work tracked only in HeyTiff."
        />
      ) : (
        <>
          {v.work.booked.length > 0 && (
            <div className="wb2-sect">
              Booked in<em>Somebody is going</em>
            </div>
          )}
          <Rows rows={v.work.booked} moneyVisible={props.moneyVisible} onOpen={props.onOpen} />

          {v.work.unbooked.length > 0 && (
            <div className="wb2-sect">
              Waiting on a day<em>Open, with nobody rostered yet</em>
            </div>
          )}
          <Rows rows={v.work.unbooked} moneyVisible={props.moneyVisible} onOpen={props.onOpen} />
        </>
      )}

      <Extra
        rows={extra}
        moneyVisible={props.moneyVisible}
        searching={!!props.searching}
        query={props.query}
        onOpen={props.onOpen}
      />
    </>
  );
}

export function QuotesTab(props: Props) {
  const v = useMemo(() => filterView(props.view, props.query), [props.view, props.query]);
  const extra = props.extra ?? [];

  return (
    <>
      <Head
        icon="file"
        title="Quotes"
        sub={quotesCountLine(v)}
        query={props.query}
        onQuery={props.onQuery}
      />
      {v.quotes.length === 0 && extra.length === 0 ? (
        <Empty
          connected={props.connected}
          query={props.query}
          icon="file"
          nothing="No quotes out"
          hint="Quotes live in ServiceM8 — anything quoted and unanswered shows here."
        />
      ) : (
        <Rows rows={v.quotes} moneyVisible={props.moneyVisible} onOpen={props.onOpen} />
      )}
      <Extra
        rows={extra}
        moneyVisible={props.moneyVisible}
        searching={!!props.searching}
        query={props.query}
        onOpen={props.onOpen}
      />
    </>
  );
}

export function CompletedJobsTab(props: Props) {
  const [showUnsuccessful, setShowUnsuccessful] = useState(false);
  const v = useMemo(() => filterView(props.view, props.query), [props.view, props.query]);
  const owed = props.moneyVisible ? awaitingPaymentCount(v) : null;
  const extra = props.extra ?? [];

  return (
    <>
      <Head
        icon="check"
        title="Completed"
        sub={completedCountLine(v, showUnsuccessful)}
        query={props.query}
        onQuery={props.onQuery}
      />

      {owed !== null && owed > 0 && (
        <p className="int-hint">
          {owed} of these {owed === 1 ? "is" : "are"} invoiced and still awaiting payment.
        </p>
      )}

      {v.completed.length === 0 && extra.length === 0 ? (
        <Empty
          connected={props.connected}
          query={props.query}
          icon="check"
          nothing="Nothing finished recently"
          hint="The last eight weeks of finished work shows here; search reaches further back."
        />
      ) : (
        <Rows rows={v.completed} moneyVisible={props.moneyVisible} onOpen={props.onOpen} />
      )}

      {v.unsuccessful.length > 0 && (
        <>
          <button
            className="pbtn ghost"
            style={{ marginTop: 10 }}
            onClick={() => setShowUnsuccessful((s) => !s)}
            aria-label={`${showUnsuccessful ? "Hide" : "Show"} ${v.unsuccessful.length} that did not go ahead`}
          >
            <Icon name={showUnsuccessful ? "minus" : "plus"} size={15} />
            {/* `{" "}` or this renders "Show 3that didn't go ahead": a JSX text
                block that wraps AND carries an entity loses the space it starts
                with. Caught by lib/format/__tests__/jsx-entity-spacing, which
                landed in #358 the same morning this shipped. */}
            {showUnsuccessful ? "Hide" : "Show"} {v.unsuccessful.length}{" "}
            that didn&apos;t go ahead
          </button>
          {showUnsuccessful && (
            <Rows rows={v.unsuccessful} moneyVisible={props.moneyVisible} onOpen={props.onOpen} />
          )}
        </>
      )}

      <Extra
        rows={extra}
        moneyVisible={props.moneyVisible}
        searching={!!props.searching}
        query={props.query}
        onOpen={props.onOpen}
      />
    </>
  );
}
