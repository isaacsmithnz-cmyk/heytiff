"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/parts/button";
import { Loading, Wrong } from "@/components/parts/states";
import { Chooser } from "@/components/parts/chooser";
import { StateWord } from "@/components/parts/state";
import { Setting, Wrong as WrongLine } from "@/components/settings/parts";
import Link from "next/link";
import type {
  LinkingData,
  LinkActionResult,
  PayRatesResult,
  WagePayRow,
} from "@/app/actions/xero-links";
import type { WageDrift } from "@/lib/integrations/wage";
import { payBasisDrift, type LinkingRow } from "@/lib/integrations/linking";
import type { XeroEmployee } from "@/lib/integrations/xero-shape";

/* Matching this workspace's people to Xero's payroll employees.

   Lives in Settings › Pay and holidays (it was the Time & Pay settings
   modal's) because that is where whoever runs pay already goes, and it is
   already `financials`-gated — which this surface has to be, since it decides
   whose pay attaches to which payroll record and reports drift in
   pay-adjacent fields.

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
  /** Xero's pay template knows who is salaried — the suggestion it feeds is
      adopted the same way: explicitly, per person. */
  onAdoptBasis: (staffProfileId: string, value: string) => Promise<LinkActionResult>;
  /** Pay rates are a separate, explicit fetch — see the note above the button. */
  onCheckPay: () => Promise<PayRatesResult>;
  onAdoptWage: (staffProfileId: string) => Promise<LinkActionResult>;
};

const money = (n: number) =>
  `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function XeroPayroll({
  load,
  onLink,
  onUnlink,
  onAdoptEmployment,
  onAdoptBasis,
  onCheckPay,
  onAdoptWage,
}: XeroPayrollProps) {
  const router = useRouter();
  const [data, setData] = useState<LinkingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /* Null until somebody asks. Wages are never part of the section's initial
     payload — see the cost/money note on checkPayRates. */
  const [pay, setPay] = useState<Map<string, WagePayRow> | null>(null);
  const [checking, setChecking] = useState(false);
  /** how many linked people the last check couldn't read from Xero */
  const [unread, setUnread] = useState(0);

  const refresh = () => {
    setError(null);
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

  /* Rule 42 for both failures: a red dot and the word, what it means, and
     the one thing to do about it, here and now (the Settings walk, 26
     October 2026: it was a bare red line). */
  const askAgain = (
    <Button kind="second" size={32} disabled={loading} onClick={refresh}>
      Ask Xero again
    </Button>
  );

  if (loading) return <Loading what="Reading your Xero payroll" />;
  if (!data)
    return <Wrong word={error ?? "Couldn't load the Xero payroll list."} means="Nobody can be matched to Xero payroll until it loads." action={askAgain} />;

  if (!data.connected) {
    return (
      <p className="st2-xp-note">
        Xero isn&apos;t connected. An owner can connect it in Settings › Integrations, and these
        people can be matched afterwards.
      </p>
    );
  }

  /* A read failure must not render as an empty roster — "nobody is on payroll"
     and "we couldn't ask" look identical in a list and mean opposite things. */
  if (data.error) {
    return <Wrong word={data.error} means="Nobody can be matched to Xero payroll until it answers." action={askAgain} />;
  }

  const linked = data.rows.filter((r) => r.state.kind === "linked" || r.state.kind === "linked_left");

  const checkPay = () => {
    setChecking(true);
    setError(null);
    onCheckPay()
      .then((res) => {
        if (res.ok) {
          setPay(new Map(res.rows.map((r) => [r.staffProfileId, r])));
          setUnread(res.unreadable);
          // the action updated the stored flag — the banner behind this modal
          // shows it, so pull the fresh server render through
          router.refresh();
        } else setError(res.error);
      })
      .catch(() => setError("Couldn't read pay rates from Xero."))
      .finally(() => setChecking(false));
  };

  return (
    <div className="st2-xp">
      {error && <WrongLine>{error}</WrongLine>}

      {/* Pay rates cost one Xero call PER PERSON, so they are asked for
          explicitly and the line says what it will spend. Everything else on
          this screen is one call for the whole organisation. */}
      <Setting
        name={`${linked.length} of ${data.rows.length} matched to ${data.tenantName ?? "Xero"}`}
        line={
          linked.length === 0
            ? null
            : pay
              ? `Pay rates read from Xero. HeyTiff still owns the wage.${
                  unread > 0 ? ` ${unread} couldn't be read, so the drift flag wasn't trusted — re-check when Xero answers.` : ""
                }`
              : `Compare wages against Xero? ${linked.length} lookup${linked.length === 1 ? "" : "s"}.`
        }
      >
        {linked.length > 0 && (
          <Button kind="second" size={32} disabled={checking || busy} onClick={checkPay}>
            {checking ? "Reading the pay rates" : pay ? "Re-check" : "Check pay rates"}
          </Button>
        )}
      </Setting>

      {data.calendar?.note && (
        <p className="st2-xp-note">
          <StateWord tone="look">{data.calendar.note}</StateWord>
        </p>
      )}

      {data.elsewhere > 0 && (
        <p className="st2-xp-note">
          {`${data.elsewhere} ${data.elsewhere === 1 ? "match belongs" : "matches belong"} to a different Xero organisation. They're kept, and apply again if you switch back.`}
        </p>
      )}

      <ul className="st2-xp-rows" aria-label="People and their Xero payroll match">
        {data.rows.map((row) => (
          <StaffRow
            key={row.staffProfileId}
            row={row}
            busy={busy}
            employees={data.unaccounted}
            wage={pay?.get(row.staffProfileId) ?? null}
            onLink={(remoteId, how) => run(() => onLink(row.staffProfileId, remoteId, how))}
            onUnlink={() => run(() => onUnlink(row.staffProfileId))}
            onAdopt={(value) => run(() => onAdoptEmployment(row.staffProfileId, value))}
            onAdoptBasis={() => run(() => onAdoptBasis(row.staffProfileId, "salary"))}
            onAdoptWage={() => run(() => onAdoptWage(row.staffProfileId))}
          />
        ))}
      </ul>

      {/* A match kept for someone archived here still holds a Xero employee,
          so it can be let go from this list and no other. */}
      {data.archived.length > 0 && (
        <div className="st2-xp-part">
          <h3 className="st2-pay-h3">Matched, but archived here</h3>
          <ul className="st2-xp-rows" aria-label="Matched, but archived here">
            {data.archived.map((a) => (
              <li className="st2-xp-row" key={a.staffProfileId}>
                <span className="st2-xp-who">
                  <b>{a.name}</b>
                  {a.remoteLabel ? <em>{a.remoteLabel}</em> : null}
                </span>
                <span className="st2-xp-act">
                  <Button kind="second" size={32} disabled={busy} onClick={() => run(() => onUnlink(a.staffProfileId))}>
                    Unmatch
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* On the Xero payroll with nobody here matched to them: Integrations
          imports them as staff cards, matched on arrival. */}
      {data.unaccounted.length > 0 && (
        <div className="st2-xp-part">
          <div className="st2-xp-parthead">
            <h3 className="st2-pay-h3">In Xero, not here</h3>
            <Link href="/dashboard/admin/integrations#xero" className="st2-link">
              Import from Xero
            </Link>
          </div>
          <ul className="st2-xp-rows" aria-label="In Xero, not here">
            {data.unaccounted.map((e) => (
              <li className="st2-xp-row" key={e.employeeId}>
                <span className="st2-xp-who">
                  <b>{e.name}</b>
                  {e.jobTitle ? <em>{e.jobTitle}</em> : null}
                </span>
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
  wage,
  onLink,
  onUnlink,
  onAdopt,
  onAdoptBasis,
  onAdoptWage,
}: {
  row: LinkingRow;
  /** Employees still free to link to — never one somebody else already has. */
  employees: XeroEmployee[];
  busy: boolean;
  /** Null until pay rates have been asked for. */
  wage: WagePayRow | null;
  onLink: (remoteId: string, matchedBy: "auto" | "manual") => void;
  onUnlink: () => void;
  onAdopt: (value: string) => void;
  onAdoptBasis: () => void;
  onAdoptWage: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [pick, setPick] = useState("");
  const s = row.state;
  const suggested = row.employment?.kind === "suggest_subbie" ? row.employment.suggested : "";

  return (
    <li className="st2-xp-row">
      <span className="st2-xp-who">
        <b>{row.name}</b>
        <em>{describe(s)}</em>
      </span>

      <span className="st2-xp-act">
        {s.kind === "suggested" && (
          /* The reason rides on the button. "Matched by email" and "matched by
             name" are very different levels of evidence, and whoever presses
             this should be told which one they're trusting. */
          <Button kind="second" size={32} disabled={busy} onClick={() => onLink(s.employee.employeeId, "auto")}>
            Match by {s.reason}
          </Button>
        )}

        {(s.kind === "linked" || s.kind === "linked_left" || s.kind === "linked_missing") && (
          <Button kind="second" size={32} disabled={busy} onClick={onUnlink}>
            Unmatch
          </Button>
        )}

        {(s.kind === "unmatched" || s.kind === "ambiguous" || s.kind === "suggested") &&
          (picking ? (
            <>
              <Chooser
                size={32}
                className="st2-xp-pick"
                aria-label={`Xero employee for ${row.name}`}
                placeholder="Choose an employee"
                options={employees.map((e) => ({ value: e.employeeId, label: e.name }))}
                value={pick || null}
                onChange={setPick}
              />
              <Button kind="second" size={32} disabled={busy || !pick} onClick={() => onLink(pick, "manual")}>
                Match
              </Button>
            </>
          ) : (
            <Button kind="second" size={32} disabled={busy} onClick={() => setPicking(true)}>
              {s.kind === "suggested" ? "Someone else" : "Choose"}
            </Button>
          ))}
      </span>

      {/* Drift, never resolved on our own: HeyTiff owns employment_type, so
          Xero's answer is a suggestion with a button, and the contradiction
          case gets no button at all because neither side is obviously right. */}
      {row.employment?.kind === "suggest_subbie" && (
        <Drift
          says={
            <>
              Xero pays them as a contractor; here they&apos;re {row.employmentType ? <b>{row.employmentType}</b> : "not set"}.
            </>
          }
          act={
            <Button kind="second" size={32} disabled={busy} onClick={() => onAdopt(suggested)}>
              Set to {suggested}
            </Button>
          }
        />
      )}
      {row.employment?.kind === "contradiction" && <Drift says={row.employment.note} />}

      {/* Wage drift, once someone has asked for it. HeyTiff owns the wage, so
          Xero's figure is shown beside ours with an adopt button — and only
          where there is genuinely an hourly rate to adopt. */}
      {wage && <WageRow drift={wage.drift} busy={busy} onAdopt={onAdoptWage} />}

      {/* The pay BASIS, read off the same pay template the wage came from —
          only knowable once rates have been checked. Suggestion, never a
          write: this column decides what their own timesheet asks them for
          every week. */}
      {(() => {
        const basis = payBasisDrift(row.payBasis, wage?.drift ?? null);
        if (!basis) return null;
        if (basis.kind === "contradiction") return <Drift says={basis.note} />;
        return (
          <Drift
            says={
              <>
                Xero pays them a salary; here they&apos;re on an <b>hourly</b> basis, so their timesheet asks for every day.
              </>
            }
            act={
              <Button kind="second" size={32} disabled={busy} onClick={onAdoptBasis}>
                Mark salaried
              </Button>
            }
          />
        );
      })()}
    </li>
  );
}

/** Where Xero and HeyTiff disagree about a person: an orange word for the
    look it needs (rule 17), the sentence, and the one button that settles it
    when there is one. Agreement is a green word. */
function Drift({ says, act, good = false }: { says: ReactNode; act?: ReactNode; good?: boolean }) {
  return (
    <span className="st2-xp-drift">
      <StateWord tone={good ? "good" : "look"}>{says}</StateWord>
      {act}
    </span>
  );
}

function WageRow({
  drift,
  busy,
  onAdopt,
}: {
  drift: WageDrift;
  busy: boolean;
  onAdopt: () => void;
}) {
  if (drift.kind === "match") {
    return (
      <Drift
        good
        says={
          <>
            Wage agrees with Xero — <b>{money(drift.rate)}</b>/hr.
          </>
        }
      />
    );
  }

  if (drift.kind === "differs") {
    /* A salary-derived rate shows its working — annual ÷ 52 ÷ hours, which is
       payroll's own arithmetic (a salary pays every week of the year), so the
       number reads as derived rather than as something Xero typed. */
    const basis = drift.basis
      ? ` (their ${money(drift.basis.annual)}/yr over 52 weeks at ${drift.basis.hoursPerWeek}h)`
      : "";
    return (
      <Drift
        says={
          drift.here === null ? (
            <>
              No wage recorded here; Xero pays them <b>{money(drift.xero)}</b>/hr{basis}.
            </>
          ) : (
            <>
              Xero pays them <b>{money(drift.xero)}</b>/hr{basis}, here they&apos;re <b>{money(drift.here)}</b>/hr (
              {drift.delta > 0 ? "+" : ""}
              {money(drift.delta)}).
            </>
          )
        }
        act={
          <Button kind="second" size={32} disabled={busy} onClick={onAdopt}>
            Use Xero&apos;s
          </Button>
        }
      />
    );
  }

  /* Only the salary Xero states NO weekly hours for lands here — without them
     there's no denominator, so there is no honest hourly figure to offer. */
  if (drift.kind === "salary") {
    return (
      <Drift
        says={
          <>
            Xero has them on a salary of <b>{money(drift.annual)}</b>/yr but doesn&apos;t say their weekly hours
            {drift.here !== null ? (
              <>
                ; here they&apos;re <b>{money(drift.here)}</b>/hr
              </>
            ) : null}
            . Set the hours in Xero and re-check to compare.
          </>
        }
      />
    );
  }

  /* The read failed — which is a different sentence from "Xero has nothing
     comparable". This row didn't make it into any stored count. */
  if (drift.kind === "unreadable") {
    return <Drift says="Couldn't read their pay from Xero — try re-checking in a moment." />;
  }

  if (drift.note) return <Drift says={drift.note} />;
  return null;
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
