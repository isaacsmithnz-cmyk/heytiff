"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import type { LinkingData, LinkActionResult } from "@/app/actions/xero-links";
import type { LinkingRow } from "@/lib/integrations/linking";
import type { XeroEmployee } from "@/lib/integrations/xero-shape";

/* Matching this workspace's people to Xero's payroll employees.

   Lives inside the Time & Pay settings modal because that is where whoever
   runs pay already goes, and it is already `financials`-gated — which this
   surface has to be, since it decides whose pay attaches to which payroll
   record and reports drift in pay-adjacent fields.

   THE SCREEN NEVER DECIDES. Every suggestion is offered with the reason it was
   made, and a person presses the button. Two people who share a name produce no
   suggestion at all — offering one of two equally-good matches is exactly how
   the wrong person gets linked by someone clicking down a list.

   Data loads on FIRST OPEN, not with the modal: it costs a live call to Xero,
   and most visits to these settings are about breaks or overtime. Actions apply
   immediately rather than joining the settings draft — same as the public
   holidays section next to it, and for the same reason: a link is a fact about
   two systems, not a preference you might cancel out of. */

export type XeroPayrollProps = {
  /** Lazily fetched so the modal's other sections never pay for a Xero call. */
  load: () => Promise<LinkingData>;
  onLink: (staffProfileId: string, remoteId: string, matchedBy: "auto" | "manual") => Promise<LinkActionResult>;
  onUnlink: (staffProfileId: string) => Promise<LinkActionResult>;
  onAdoptEmployment: (staffProfileId: string, value: string) => Promise<LinkActionResult>;
};

export function XeroPayroll({ load, onLink, onUnlink, onAdoptEmployment }: XeroPayrollProps) {
  const router = useRouter();
  const [data, setData] = useState<LinkingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    setLoading(true);
    load()
      .then(setData)
      .catch(() => setError("Couldn't load the Xero payroll list."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    let live = true;
    load()
      .then((d) => live && setData(d))
      .catch(() => live && setError("Couldn't load the Xero payroll list."))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // once, on mount — the section is only mounted when its menu row is open
  }, [load]);

  const run = (action: () => Promise<LinkActionResult>) => {
    setError(null);
    start(async () => {
      const res = await action();
      if (res.ok) {
        refresh();
        // employment_type drives timesheet presumption elsewhere
        router.refresh();
      } else setError(res.error);
    });
  };

  if (loading) return <p className="xp-note">Reading your Xero payroll…</p>;
  if (!data) return <p className="xp-note">{error ?? "Couldn't load the Xero payroll list."}</p>;

  if (!data.connected) {
    return (
      <p className="xp-note">
        Xero isn&apos;t connected. An owner can connect it in Admin → Integrations, and these
        people can be matched afterwards.
      </p>
    );
  }

  /* A read failure must not render as an empty roster — "nobody is on payroll"
     and "we couldn't ask" look identical in a list and mean opposite things. */
  if (data.error) {
    return (
      <div className="xp">
        <p className="xp-note bad">{data.error}</p>
      </div>
    );
  }

  const linked = data.rows.filter((r) => r.state.kind === "linked" || r.state.kind === "linked_left");

  return (
    <div className="xp">
      {error && <p className="xp-note bad">{error}</p>}

      <p className="xp-note">
        {linked.length} of {data.rows.length} matched to{" "}
        <b>{data.tenantName ?? "Xero"}</b>. Nothing is changed in Xero — matching only tells
        HeyTiff who is who.
      </p>

      {data.calendar?.note && (
        <p className="xp-advisory">
          <Icon name="info" size={15} />
          {data.calendar.note}
        </p>
      )}

      {data.elsewhere > 0 && (
        <p className="xp-note">
          {`${data.elsewhere} ${data.elsewhere === 1 ? "match belongs" : "matches belong"} to a different Xero organisation. They're kept, and apply again if you switch back.`}
        </p>
      )}

      <div className="xp-rows">
        {data.rows.map((row) => (
          <StaffRow
            key={row.staffProfileId}
            row={row}
            busy={busy}
            employees={data.unaccounted}
            onLink={(remoteId, how) => run(() => onLink(row.staffProfileId, remoteId, how))}
            onUnlink={() => run(() => onUnlink(row.staffProfileId))}
            onAdopt={(value) => run(() => onAdoptEmployment(row.staffProfileId, value))}
          />
        ))}
      </div>

      {data.unaccounted.length > 0 && (
        <div className="xp-extra">
          <b>In Xero, not here</b>
          <em>
            On the Xero payroll with nobody in this workspace matched to them. Add them as staff
            first if they should be.
          </em>
          <ul>
            {data.unaccounted.map((e) => (
              <li key={e.employeeId}>
                {e.name}
                {e.jobTitle ? <span> · {e.jobTitle}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StaffRow({
  row,
  employees,
  busy,
  onLink,
  onUnlink,
  onAdopt,
}: {
  row: LinkingRow;
  /** Employees still free to link to — never one somebody else already has. */
  employees: XeroEmployee[];
  busy: boolean;
  onLink: (remoteId: string, matchedBy: "auto" | "manual") => void;
  onUnlink: () => void;
  onAdopt: (value: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [pick, setPick] = useState("");
  const s = row.state;
  const suggested = row.employment?.kind === "suggest_subbie" ? row.employment.suggested : "";

  return (
    <div className="xp-row">
      <div className="xp-who">
        <b>{row.name}</b>
        <em>{describe(s)}</em>
      </div>

      <div className="xp-act">
        {s.kind === "suggested" && (
          /* The reason rides on the button. "Matched by email" and "matched by
             name" are very different levels of evidence, and whoever presses
             this should be told which one they're trusting. */
          <button className="xp-btn go" disabled={busy} onClick={() => onLink(s.employee.employeeId, "auto")}>
            Match by {s.reason}
          </button>
        )}

        {(s.kind === "linked" || s.kind === "linked_left" || s.kind === "linked_missing") && (
          <button className="xp-btn" disabled={busy} onClick={onUnlink}>
            Unmatch
          </button>
        )}

        {(s.kind === "unmatched" || s.kind === "ambiguous" || s.kind === "suggested") &&
          (picking ? (
            <span className="xp-pick">
              <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label={`Xero employee for ${row.name}`}>
                <option value="">Choose…</option>
                {employees.map((e) => (
                  <option key={e.employeeId} value={e.employeeId}>
                    {e.name}
                  </option>
                ))}
              </select>
              <button className="xp-btn go" disabled={busy || !pick} onClick={() => onLink(pick, "manual")}>
                Match
              </button>
            </span>
          ) : (
            <button className="xp-btn" disabled={busy} onClick={() => setPicking(true)}>
              {s.kind === "suggested" ? "Someone else" : "Choose"}
            </button>
          ))}
      </div>

      {/* Drift, never resolved on our own: HeyTiff owns employment_type, so
          Xero's answer is a suggestion with a button, and the contradiction
          case gets no button at all because neither side is obviously right. */}
      {row.employment?.kind === "suggest_subbie" && (
        <div className="xp-drift">
          <span>
            Xero pays them as a contractor; here they&apos;re{" "}
            {row.employmentType ? <b>{row.employmentType}</b> : <i>not set</i>}.
          </span>
          <button
            className="xp-btn go"
            disabled={busy}
            onClick={() => onAdopt(suggested)}
          >
            Set to {suggested}
          </button>
        </div>
      )}
      {row.employment?.kind === "contradiction" && (
        <div className="xp-drift">
          <span>{row.employment.note}</span>
        </div>
      )}
    </div>
  );
}

/** What a row's state says, in one line. Exported for the tests, which assert
    on the sentences rather than on class names. */
export function describe(s: LinkingRow["state"]): string {
  switch (s.kind) {
    case "linked":
      return `Matched to ${s.employee.name}`;
    case "linked_left":
      return `Matched to ${s.employee.name}, who has left in Xero`;
    case "linked_missing":
      return s.remoteLabel
        ? `Matched to ${s.remoteLabel}, who is no longer in Xero`
        : "Matched to someone no longer in Xero";
    case "suggested":
      return s.reason === "email"
        ? `Looks like ${s.employee.name} — same email address`
        : `Looks like ${s.employee.name} — same name`;
    case "ambiguous":
      return "More than one Xero employee could be them — choose which";
    case "unmatched":
      return "Not on the Xero payroll, or not matched yet";
  }
}
