"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/parts/button";
import { StateWord } from "@/components/parts/state";
import { Wrong } from "@/components/settings/parts";
import { NewJobForm } from "@/components/making/new-job-form";
import { jobPageHref } from "@/lib/shell/links";
import { dueWords } from "@/lib/email/proposal";
import type { EmailJobView } from "@/lib/email/made-server";
import { createJobFromEmail, emailJobMade, notAJob, readEmailJob } from "@/app/actions/email-in-job";
import { withCleanup } from "@/lib/ui/with-cleanup";

/* THE JOB TIFF PROPOSES FROM A FORWARDED EMAIL, in Conversations (Isaac, 28
   October 2026, the mock he said "Build it in" to): a card, because it is
   something you act on (rule 35). Who, the contact, where, how it came in,
   when it's due, the scope as written and where the files go; then Create
   job (the one main button), Change the details (the New job form, filled
   in) and Not a job. Made, it says so with Open job. Its state is the
   email's own row, read when it is drawn, so the thread never holds a stale
   card. */

const Row = ({ k, children }: { k: string; children: ReactNode }) => (
  <div className="cv-job-row">
    <dt>{k}</dt>
    <dd>{children}</dd>
  </div>
);

export function EmailJobCard({ id }: { id: string }) {
  const [view, setView] = useState<EmailJobView | null | "none">(null);
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState<string | null>(null);
  const [form, setForm] = useState(false);

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
  if (!p || !p.isJob) return null;

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

  const putAway = () => {
    setBusy(true);
    void withCleanup(async () => {
      const done = await notAJob(id).catch(() => false);
      if (done) setView({ ...view, state: "not_a_job" });
      else setWrong("That couldn't be saved. Try again.");
    }, () => setBusy(false));
  };

  const contact = [[p.contact.first, p.contact.last].filter(Boolean).join(" "), p.contact.mobile || p.contact.phone, p.contact.email].filter(Boolean).join(", ");
  const made = view.state === "made" && view.jobUuid;
  return (
    <section className="cv-job" aria-label="New job">
      <h3 className="cv-job-head">New job</h3>
      <dl className="cv-job-facts">
        <Row k="Client">
          {p.clientMatch?.name ?? p.client}
          <span className="cv-job-q">{p.clientMatch ? ", already a client" : ", a new client"}</span>
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
        {view.files.length > 0 && <Row k="Files">{`${view.files.map((f) => f.name).join(", ")}, to the job's Documents`}</Row>}
        {view.why && <Row k="Not kept">{view.why.replace(/^Not kept: /, "")}</Row>}
      </dl>
      {wrong && <Wrong>{wrong}</Wrong>}
      <div className="cv-job-foot">
        {made ? (
          <>
            <StateWord tone="good">{view.jobNumber ? `Job ${view.jobNumber} made in ServiceM8` : "Job made in ServiceM8"}</StateWord>
            <span className="cv-job-grow" />
            <Button kind="second" size={32} href={jobPageHref(view.jobUuid!)}>
              {view.jobNumber ? `Open job ${view.jobNumber}` : "Open the job"}
            </Button>
          </>
        ) : view.state === "not_a_job" ? (
          <StateWord tone="info">Not a job</StateWord>
        ) : (
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
