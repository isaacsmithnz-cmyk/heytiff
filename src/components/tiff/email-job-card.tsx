"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/parts/button";
import { StateWord } from "@/components/parts/state";
import { Wrong } from "@/components/settings/parts";
import { NewJobForm } from "@/components/making/new-job-form";
import { jobPageHref } from "@/lib/shell/links";
import { FOUND_WORDS, dueWords, forExistingJob, sureJob, type JobCandidate } from "@/lib/email/proposal";
import { aShare } from "@/lib/email/share-links";
import type { EmailJobView } from "@/lib/email/made-server";
import { createJobFromEmail, emailJobMade, fileEmailOnJob, notAJob, readEmailJob } from "@/app/actions/email-in-job";
import { withCleanup } from "@/lib/ui/with-cleanup";

/* WHAT TIFF PROPOSES FROM A FORWARDED EMAIL, in the Inbox (Isaac, 28 October
   2026, the mock he said "Build it in" to; then "What if I just forward
   documents that were sent to us for an existing job?"; then, 30 October:
   "you have a button that says create job once it has built out the
   information… Or maybe add to job if it's drawings"). Two parts of one
   email: the decision, which stays at the top of the open email
   (EmailJobActions), and what she read, a card (EmailJobFacts, rule 35).

   FOR A JOB ALREADY HERE (proposal.ts, sureJob): one sure job, its number
   in the email, its thread already on it, or the one open job at that site,
   is offered with Add to job N; several are listed, each with its own Add.
   Adding puts the email's files on the job's Documents and its words on the
   job's notes. Make a new job instead turns it into a new job.

   A NEW JOB: who, the contact, where, how it came in, when it's due, the
   scope as written and where the files go; then Create job, Change the
   details (the New job form, filled in) and Not a job.

   A LINK TO THE PLANS (29 October 2026: "She could at least bring the link
   for you to click on straight from the job card"): a tender folder the
   email points to rather than carries opens from here, and from the job's
   Documents once the email is on a job (share-links.ts).

   Its state is the email's own row, read when it is opened, so the Inbox
   never holds a stale decision. */

const Row = ({ k, children }: { k: string; children: ReactNode }) => (
  <div className="cv-job-row">
    <dt>{k}</dt>
    <dd>{children}</dd>
  </div>
);

const firstLine = (s: string | null) => (s ?? "").split("\n")[0]!.trim();
const jobWords = (j: JobCandidate) => [j.number ? `${j.number}` : null, firstLine(j.address) || null].filter(Boolean).join(", ");

type Held = { id: string; view: EmailJobView | null | "none"; busy: boolean; wrong: string | null; form: boolean; makeNew: boolean };

const fresh = (id: string): Held => ({ id, view: null, busy: false, wrong: null, form: false, makeNew: false });

/** One email's card: its row, what can be done to it, and how that went.
    `onChange` hears the row once something is done, so the Inbox's word
    changes with it. */
export function useEmailJob(id: string, onChange?: (view: EmailJobView) => void) {
  const [stored, setHeld] = useState<Held>(() => fresh(id));
  /* another email opened: its own card, from nothing */
  const held = stored.id === id ? stored : fresh(id);
  if (stored.id !== id) setHeld(held);
  const patch = (next: Partial<Held>) => setHeld((h) => (h.id === id ? { ...h, ...next } : h));

  useEffect(() => {
    if (!id) return;
    let live = true;
    void readEmailJob(id)
      .then((v) => {
        if (live) setHeld((h) => (h.id === id ? { ...h, view: v ?? "none" } : h));
      })
      .catch(() => {
        if (live) setHeld((h) => (h.id === id ? { ...h, view: "none" } : h));
      });
    return () => {
      live = false;
    };
  }, [id]);

  const view = held.view === null || held.view === "none" ? null : held.view;
  const done = (next: Partial<EmailJobView>) => {
    if (!view) return;
    const changed = { ...view, ...next };
    patch({ view: changed });
    onChange?.(changed);
  };

  /* no try here: the compiler can't lower a value block inside one; a
     thrown call is a null answer instead */
  const create = () => {
    if (!view) return;
    patch({ busy: true, wrong: null });
    void withCleanup(async () => {
      const a = await createJobFromEmail(id).catch(() => null);
      if (!a) return patch({ wrong: "The job couldn't be made. Check your connection and try again." });
      if (!a.ok) return patch({ wrong: a.error });
      done({ state: "made", jobUuid: a.jobUuid, jobNumber: a.number ?? view.jobNumber });
    }, () => patch({ busy: false }));
  };

  const addTo = (job: JobCandidate) => {
    patch({ busy: true, wrong: null });
    void withCleanup(async () => {
      const added = await fileEmailOnJob(id, job.uuid).catch(() => false);
      if (!added) return patch({ wrong: "It couldn't be added to that job. Try again." });
      done({ state: "filed", jobUuid: job.uuid, jobNumber: job.number });
    }, () => patch({ busy: false }));
  };

  const putAway = () => {
    patch({ busy: true });
    void withCleanup(async () => {
      const put = await notAJob(id).catch(() => false);
      if (put) done({ state: "not_a_job" });
      else patch({ wrong: "That couldn't be saved. Try again." });
    }, () => patch({ busy: false }));
  };

  const p = view?.proposal ?? null;
  const existing = Boolean(p && forExistingJob(p) && !held.makeNew);
  return {
    id,
    /** the email's row, once it has been read */
    view,
    /** it couldn't be read, or isn't this business's */
    missing: held.view === "none",
    busy: held.busy,
    wrong: held.wrong,
    form: held.form,
    existing,
    /** there is a card: a job already here, or a new one */
    hasCard: Boolean(p && (existing || p.isJob || held.makeNew)),
    create,
    addTo,
    putAway,
    openForm: () => patch({ form: true }),
    closeForm: () => patch({ form: false }),
    makeNewInstead: () => patch({ makeNew: true }),
    made: (jobUuid: string) => {
      void emailJobMade(id, jobUuid);
      done({ state: "made", jobUuid });
    },
  };
}

export type EmailJob = ReturnType<typeof useEmailJob>;

const isDone = (v: EmailJobView) => (v.state === "made" || v.state === "filed") && Boolean(v.jobUuid);

/** The decision, at the top of the open email: Create job, or Add to job N;
    once it's decided, what became of it and the way to the job. */
export function EmailJobActions({ job }: { job: EmailJob }) {
  const { view, busy, existing, hasCard } = job;
  if (!view || !view.proposal || !hasCard) return null;
  const p = view.proposal;
  let row: ReactNode;
  if (isDone(view)) {
    row = (
      <>
        <StateWord tone="good">
          {view.state === "filed" ? `Added to job ${view.jobNumber ?? ""}`.trim() : view.jobNumber ? `Job ${view.jobNumber} made in ServiceM8` : "Job made in ServiceM8"}
        </StateWord>
        <span className="cv-job-grow" />
        <Button kind="second" size={32} href={jobPageHref(view.jobUuid!)}>
          {view.jobNumber ? `Open job ${view.jobNumber}` : "Open the job"}
        </Button>
      </>
    );
  } else if (view.state === "not_a_job") {
    row = <StateWord tone="info">Not a job</StateWord>;
  } else if (existing) {
    const sure = sureJob(p);
    row = (
      <>
        {sure && (
          <Button kind="main" size={36} disabled={busy} onClick={() => job.addTo(sure)}>
            {busy ? "Adding it" : `Add to job ${sure.number ?? ""}`.trim()}
          </Button>
        )}
        <Button kind="second" size={36} disabled={busy} onClick={job.makeNewInstead}>
          Make a new job instead
        </Button>
        <span className="cv-job-grow" />
        <Button kind="quiet" size={36} disabled={busy} onClick={job.putAway}>
          Not for a job
        </Button>
      </>
    );
  } else {
    row = (
      <>
        <Button kind="main" size={36} disabled={busy} onClick={job.create}>
          {busy ? "Making the job" : "Create job"}
        </Button>
        <Button kind="second" size={36} disabled={busy} onClick={job.openForm}>
          Change the details
        </Button>
        <span className="cv-job-grow" />
        <Button kind="quiet" size={36} disabled={busy} onClick={job.putAway}>
          Not a job
        </Button>
      </>
    );
  }
  return (
    <>
      <div className="cv-job-foot">{row}</div>
      {job.wrong && <Wrong>{job.wrong}</Wrong>}
      {job.form && (
        <NewJobForm
          onClose={job.closeForm}
          initial={{
            pressId: job.id,
            clientName: p.clientMatch?.name ?? p.client,
            address: p.site,
            first: p.contact.first,
            last: p.contact.last,
            mobile: p.contact.mobile || p.contact.phone,
            email: p.contact.email,
            description: [...p.scope.map((s) => `- ${s}`), ...(p.excluded.length ? ["", "Excluded:", ...p.excluded.map((s) => `- ${s}`)] : [])].join("\n"),
            via: "email",
          }}
          onMade={job.made}
        />
      )}
    </>
  );
}

/** What Tiff read: the job it's for, or the job she'd make. */
export function EmailJobFacts({ job }: { job: EmailJob }) {
  const { view, busy, existing, hasCard } = job;
  if (!view || !view.proposal || !hasCard) return null;
  const p = view.proposal;

  const files = view.files.length > 0 && <Row k="Files">{`${view.files.map((f) => f.name).join(", ")}, to the job's Documents`}</Row>;
  const links = view.links.length > 0 && (
    <Row k={view.links.length === 1 ? "Link" : "Links"}>
      <ul className="cv-job-links">
        {view.links.map((l) => (
          <li key={l.url}>
            <Button kind="quiet" size={32} href={l.url} target="_blank" rel="noopener noreferrer">
              {l.name}
            </Button>
            {` ${l.name === l.what ? "" : `${aShare(l.what)}, `}to the job's Documents`}
          </li>
        ))}
      </ul>
    </Row>
  );
  const notKept = view.why && <Row k="Not kept">{view.why.replace(/^Not kept: /, "")}</Row>;

  if (existing) {
    const sure = sureJob(p);
    const jobs = p.jobs ?? [];
    return (
      <section className="cv-job" aria-label={sure ? `For job ${sure.number ?? ""}` : "Which job?"}>
        <h3 className="cv-job-head">{sure ? `For job ${sure.number ?? jobWords(sure)}` : "Which job?"}</h3>
        <dl className="cv-job-facts">
          {sure ? (
            <>
              <Row k="Job">{jobWords(sure)}</Row>
              {sure.client && <Row k="Client">{sure.client}</Row>}
              {sure.status && <Row k="Stage">{sure.status}</Row>}
              <Row k="Found by">{FOUND_WORDS[sure.found]}</Row>
            </>
          ) : (
            <Row k="Jobs">
              <ul className="cv-job-picks">
                {jobs.map((j) => (
                  <li key={j.uuid} className="cv-job-pick">
                    <span>
                      {jobWords(j)}
                      <span className="cv-job-q">{[j.client, j.status].filter(Boolean).map((w) => `, ${w}`).join("")}</span>
                    </span>
                    {!isDone(view) && view.state !== "not_a_job" && (
                      <Button kind="second" size={32} disabled={busy} onClick={() => job.addTo(j)}>
                        {`Add to job ${j.number ?? ""}`.trim()}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </Row>
          )}
          {files}
          {links}
          <Row k="The email">To the job&apos;s notes</Row>
          {notKept}
        </dl>
      </section>
    );
  }

  const contact = [[p.contact.first, p.contact.last].filter(Boolean).join(" "), p.contact.mobile || p.contact.phone, p.contact.email].filter(Boolean).join(", ");
  return (
    <section className="cv-job" aria-label="New job">
      <h3 className="cv-job-head">New job</h3>
      <dl className="cv-job-facts">
        <Row k="Client">
          {p.clientMatch?.name ?? (p.client || "Not given")}
          <span className="cv-job-q">{p.clientMatch ? ", already a client" : p.client ? ", a new client" : ""}</span>
        </Row>
        {contact && <Row k="Contact">{contact}</Row>}
        <Row k="Site">
          {p.site || "Not given"}
          {p.site && p.clientMatch?.builder && !p.siteMatch && <span className="cv-job-q">, a new site for them</span>}
        </Row>
        <Row k="Came in by">Email</Row>
        {p.due && <Row k="Quote due">{dueWords(p.due)}</Row>}
        {p.scope.length > 0 && (
          <Row k="Scope">
            <ul>
              {p.scope.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </Row>
        )}
        {p.excluded.length > 0 && (
          <Row k="Excluded">
            <ul>
              {p.excluded.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </Row>
        )}
        {files}
        {links}
        {notKept}
      </dl>
    </section>
  );
}
