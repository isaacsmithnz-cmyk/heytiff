"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/parts/button";
import { Dialog } from "@/components/parts/dialog";
import { Icon } from "@/components/shell/icon";
import { Menu, type MenuItem } from "@/components/parts/menu";
import { JobField, type FormJob } from "@/components/making/job-field";
import { jobPageHref, projectsHref } from "@/lib/shell/links";
import { letterHref } from "@/lib/letters/letter";

/* MAKE A DOCUMENT (the board 5-documents): the page's main button, a menu
   of the kinds, each opening today's way of making that kind.

   - SWMS and Certificate are made on their job, by the job's own wizards
     (Add › SWMS, Add › Certificate). Here the job is asked for first, as a
     field (rule 51), and the job's page opens on Documents doing what Add
     does there: the wizard for its first, its row to revise or reissue
     when it has one.
   - Letter opens today's letter editor, for whoever may write one.
   - Handover sheet: a project's sheet is printed from the project, so it
     goes to the projects, where a job is made a project. */

export type MakeKind = "swms" | "certificate" | "letter" | "handover";

const ON_A_JOB: Record<"swms" | "certificate", { heading: string; go: string }> = {
  swms: { heading: "Make a SWMS", go: "Make the SWMS" },
  certificate: { heading: "Make a certificate", go: "Make the certificate" },
};

/** Where a SWMS or a certificate is made for this job. */
export const makeOnJobHref = (uuid: string, kind: "swms" | "certificate") => `${jobPageHref(uuid, "documents")}&add=${kind}`;

export function MakeDocument({ canWriteLetters }: { canWriteLetters: boolean }) {
  const router = useRouter();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [onJob, setOnJob] = useState<"swms" | "certificate" | null>(null);
  const [job, setJob] = useState<FormJob | null>(null);

  const items: MenuItem[] = [
    { key: "swms", label: "SWMS" },
    { key: "certificate", label: "Certificate" },
    ...(canWriteLetters ? [{ key: "letter", label: "Letter" }] : []),
    { key: "handover", label: "Handover sheet" },
  ];

  const pick = (key: string) => {
    setOpen(false);
    if (key === "swms" || key === "certificate") {
      setJob(null);
      setOnJob(key);
    } else if (key === "letter") router.push(letterHref("new"));
    else if (key === "handover") router.push(projectsHref);
  };

  const words = onJob ? ON_A_JOB[onJob] : null;
  return (
    <>
      <Button
        ref={ref}
        kind="main"
        icon="plus"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        Make a document
        <span className="dc2-chev" aria-hidden="true">
          <Icon name="chevD" size={16} />
        </span>
      </Button>
      <Menu anchor={ref} open={open} onClose={() => setOpen(false)} onSelect={pick} items={items} label="Make a document" align="end" />
      {onJob && words && (
        <Dialog
          heading={words.heading}
          onClose={() => setOnJob(null)}
          width={560}
          foot={
            <>
              <Button kind="second" onClick={() => setOnJob(null)}>
                Cancel
              </Button>
              <Button kind="main" disabled={!job} onClick={() => job && router.push(makeOnJobHref(job.uuid, onJob))}>
                {words.go}
              </Button>
            </>
          }
        >
          <JobField job={job} onChange={setJob} placeholder="Find a job" />
        </Dialog>
      )}
    </>
  );
}
