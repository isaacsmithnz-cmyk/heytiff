import { fieldSpec } from "@/lib/studio/packs/fields";
import { formatDate, formatDateTime } from "@/lib/hq/format";

/* HQ change log — every manual edit to the universal table, by time and staff
   member (the audit-trail requirement). Presentational: the page reads
   pack_override_log and passes serialisable events; grouped by day, newest
   first. */

export interface ChangeEvent {
  id: string;
  section: string;
  rowKey: string;
  field: string;
  action: "set" | "clear";
  oldValue: number | string | string[] | null;
  newValue: number | string | string[] | null;
  enteredBy: string;
  enteredAt: string;
}

function label(section: string, field: string): string {
  return fieldSpec(section, field)?.label ?? field;
}

function val(v: number | string | string[] | null): string {
  if (v == null) return "—";
  if (Array.isArray(v)) return `[${v.join(", ")}]`; // tag lists
  return String(v);
}

/** Group events (already newest-first) into day buckets, preserving order. */
function byDay(events: ChangeEvent[]): { day: string; items: ChangeEvent[] }[] {
  const groups: { day: string; items: ChangeEvent[] }[] = [];
  for (const e of events) {
    const day = formatDate(e.enteredAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(e);
    else groups.push({ day, items: [e] });
  }
  return groups;
}

export function ChangesList({ events }: { events: ChangeEvent[] }) {
  if (events.length === 0) {
    return <div className="hq-empty">No manual changes yet.</div>;
  }
  return (
    <div className="hq-changes">
      {byDay(events).map((g) => (
        <div className="hq-change-day" key={g.day}>
          <div className="hq-change-daylabel">{g.day}</div>
          {g.items.map((e) => (
            <div className="hq-change" key={e.id}>
              <span className="hq-change-time">{formatDateTime(e.enteredAt)}</span>
              <span className="hq-change-who">{e.enteredBy}</span>
              <span className="hq-change-body">
                <span className={`hq-change-act ${e.action}`}>
                  {e.action === "set" ? "set" : "cleared"}
                </span>{" "}
                <b>{e.rowKey}</b> · {label(e.section, e.field)}
                <span className="hq-change-delta">
                  {" "}
                  {val(e.oldValue)} → {e.action === "clear" ? "pack" : val(e.newValue)}
                </span>
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
