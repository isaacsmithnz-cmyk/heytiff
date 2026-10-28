"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/parts/button";
import { StateWord } from "@/components/parts/state";
import { Wrong } from "@/components/settings/parts";
import { NewJobForm } from "@/components/making/new-job-form";
import { jobPageHref } from "@/lib/shell/links";
import { FOUND_WORDS, dueWords, forExistingJob, sureJob, type JobCandidate } from "@/lib/email/proposal";
import type { EmailJobView } from "@/lib/email/made-server";
import { createJobFromEmail, emailJobMade, fileEmailOnJob, notAJob, readEmailJob } from "@/app/actions/email-in-job";
import { withCleanup } from "@/lib/ui/with-cleanup";

/* WHAT TIFF PROPOSES FROM A FORWARDED EMAIL, in Conversations (Isaac, 28
   October 2026, the mock he said "Build it in" to; then "What if I just
   forward documents that were sent to us for an existing job?"). A card,
   because it is acted on (rule 35).

   FOR A JOB ALREADY HERE (proposal.ts, sureJob): one sure job, its number
   in the email, its thread already on it, or the one open job at that site,
   is offered with File on job N; several are listed, each with its own
   File. Filing puts the email's files on the job's Documents and its words
   on the job's notes. Make a new job instead turns it into a new job.

   A NEW JOB: who, the contact, where, how it came in, when it's due, the
   scope as written and where the files go; then Create job, Change the
   details (the New job form, filled in) and Not a job.

   Its state is the email's own row, read when it is drawn, so the thread
   never holds a stale card. */

const Row = ({ k, children }: { k: string; children: ReactNode }) => (
  <div className="cv-job-row">
    <dt>{k}</dt>
    <dd>{children}</dd>
  </div>
);

const firstLine = (s: string | null) => (s ?? "").split("\n")[0]!.trim();
const jobWords = (j: JobCandidate) => [j.number ? `${j.number}` : null, firstLine(j.address) || null].filter(Boolean).join(", ");

export function EmailJobCard({ id }: { id: string }) {
  const [view, setView] = useState<EmailJobView | null | "none">(null);
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState<string | null>(null);
  const [form, setForm] = useState(false);
  /* a job already here, until the person says to make a new one instead */
  const [makeNew, setMakeNew] = useState(false);

  useEffect(() => {
    let live = true;
    void readEmailJob(id)
      .then((v) => live && setView(v ?? "none"))
      .catch(() => live && setView("none"));
    return () => {
      live = false;
    };
  }, [id]);

  if (view === null || view === "none") return null;
  const p = view.proposal;
  if (!p) return null;
  const existing = forExistingJob(p) && !makeNew;
  if (!existing && !p.isJob && !makeNew) return null;

  /* no try here: the compiler can't lower a value block inside one; a
     thrown call is a null answer instead */
  const create = () => {
    setBusy(true);
    setWrong(null);
    void withCleanup(async () => {
      const a = await createJobFromEmail(id).catch(() => null);
      if (!a) return setWrong("The job couldn't be made. Check your connection and try again.");
      if (!a.ok) return setWrong(a.error);
      setView({ ...view, state: "made", jobUuid: a.jobUuid, jobNumber: a.number ?? view.jobNumber });
    }, () => setBusy(false));
  };

  const fileOn = (job: JobCandidate) => {
    setBusy(true);
    setWrong(null);
    void withCleanup(async () => {
      const done = await fileEmailOnJob(id, job.uuid).catch(() => false);
      if (!done) return setWrong("It couldn't be filed on that job. Try again.");
      setView({ ...view, state: "filed", jobUuid: job.uuid, jobNumber: job.number });
    }, () => setBusy(false));
  };

  const putAway = () => {
    setBusy(true);
    void withCleanup(async () => {
      const done = await notAJob(id).catch(() => false);
      if (done) setView({ ...view, state: "not_a_job" });
      else setWrong("That couldn't be saved. Try again.");
    }, () => setBusy(false));
  };

  const files = view.files.length > 0 && <Row k="Files">{`${view.files.map((f) => f.name).join(", ")}, to the job's Documents`}</Row>;
  const notKept = view.why && <Row k="Not kept">{view.why.replace(/^Not kept: /, "")}</Row>;
  const done =
    (view.state === "made" || view.state === "filed") && view.jobUuid ? (
      <>
        <StateWord tone="good">
          {view.state === "filed" ? `Filed on job ${view.jobNumber ?? ""}`.trim() : view.jobNumber ? `Job ${view.jobNumber} made in ServiceM8` : "Job made in ServiceM8"}
        </StateWord>
        <span className="cv-job-grow" />
        <Button kind="second" size={32} href={jobPageHref(view.jobUuid)}>
          {view.jobNumber ? `Open job ${view.jobNumber}` : "Open the job"}
        </Button>
      </>
    ) : view.state === "not_a_job" ? (
      <StateWord tone="info">Not a job</StateWord>
    ) : null;

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
                    {!done && (
                      <Button kind="second" size={32} disabled={busy} onClick={() => fileOn(j)}>
                        {`File on job ${j.number ?? ""}`.trim()}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </Row>
          )}
          {files}
          <Row k="The email">To the job&apos;s notes</Row>
          {notKept}
        </dl>
        {wrong && <Wrong>{wrong}</Wrong>}
        <div className="cv-job-foot">
          {done ?? (
            <>
              {sure && (
                <Button kind="main" size={36} disabled={busy} onClick={() => fileOn(sure)}>
                  {busy ? "Filing it" : `File on job ${sure.number ?? ""}`.trim()}
                </Button>
              )}
              <Button kind="second" size={36} disabled={busy} onClick={() => setMakeNew(true)}>
                Make a new job instead
              </Button>
              <span className="cv-job-grow" />
              <Button kind="quiet" size={36} disabled={busy} onClick={putAway}>
                Not for a job
              </Button>
            </>
          )}
        </div>
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
        {notKept}
      </dl>
      {wrong && <Wrong>{wrong}</Wrong>}
      <div className="cv-job-foot">
        {done ?? (
          <>
            <Button kind="main" size={36} disabled={busy} onClick={create}>
              {busy ? "Making the job" : "Create job"}
            </Button>
            <Button kind="second" size={36} disabled={busy} onClick={() => setForm(true)}>
              Change the details
            </Button>
            <span className="cv-job-grow" />
            <Button kind="quiet" size={36} disabled={busy} onClick={putAway}>
              Not a job
            </Button>
          </>
        )}
      </div>
      {form && (
        <NewJobForm
          onClose={() => setForm(false)}
          initial={{
            pressId: id,
            clientName: p.clientMatch?.name ?? p.client,
            address: p.site,
            first: p.contact.first,
            last: p.contact.last,
            mobile: p.contact.mobile || p.contact.phone,
            email: p.contact.email,
            description: [...p.scope.map((s) => `- ${s}`), ...(p.excluded.length ? ["", "Excluded:", ...p.excluded.map((s) => `- ${s}`)] : [])].join("\n"),
            via: "email",
          }}
          onMade={(jobUuid) => {
            void emailJobMade(id, jobUuid);
            setView({ ...view, state: "made", jobUuid });
          }}
        />
      )}
    </section>
  );
}
