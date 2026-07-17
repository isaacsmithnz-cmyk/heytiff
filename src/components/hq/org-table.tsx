import type { OrgRow } from "@/lib/hq/overview";
import { formatDate } from "@/lib/hq/format";

/* Organisations table for the HQ overview. Each row links to the org's
   drill-down (/hq/orgs/[id]) for the member list. Presentational — plain props,
   RTL-testable. */

export function OrgTable({ rows }: { rows: OrgRow[] }) {
  if (rows.length === 0) {
    return <div className="hq-empty">No organisations yet.</div>;
  }
  return (
    <div className="hq-card">
      <table className="hq-table">
        <thead>
          <tr>
            <th>Organisation</th>
            <th>Signed up</th>
            <th>Users</th>
            <th>Designs</th>
            <th>Last activity</th>
            <th aria-label="drill in" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="hq-row-link">
              <td className="hq-strong">
                <a href={`/hq/orgs/${r.id}`}>{r.name}</a>
              </td>
              <td className="hq-muted">{formatDate(r.createdAt)}</td>
              <td className="hq-num">{r.memberCount}</td>
              <td className="hq-num">{r.designCount}</td>
              <td className="hq-muted">{formatDate(r.lastActivity)}</td>
              <td>
                <a href={`/hq/orgs/${r.id}`} className="hq-arrow" aria-label={`Open ${r.name}`}>
                  →
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
