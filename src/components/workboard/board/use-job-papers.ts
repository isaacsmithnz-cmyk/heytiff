"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { readJobFiles } from "@/app/actions/workboard";
import { deleteCertificate, listCertificatesForJob } from "@/app/actions/certificates";
import { listSwmsForJob } from "@/app/actions/swms";
import { attachJobDocument, removeJobDocument } from "@/app/actions/job-documents";
import { addJobPapers, emailJobDocuments, listJobPapers, removeJobPaper, renewJobPaper } from "@/app/actions/job-compliance";
import { readJobSm8, sendJobDocumentsToServiceM8, type JobSm8Read } from "@/app/actions/job-sm8";
import { uploadFile } from "@/lib/documents/upload-client";
import { sendFailure, sendToast } from "@/lib/integrations/sm8-write-plan";
import {
  ourDocumentSendKey,
  paperLabel,
  paperSendable,
  paperSendKey,
  theirFileSendKey,
  type JobPaper,
  type JobPapersRead,
} from "@/lib/compliance/papers";
import type { CertSummary } from "@/lib/certs/query";
import type { SwmsSummary } from "@/lib/swms/query";
import { andList } from "@/lib/swms/library";
import type { JobMediaItem } from "@/lib/workboard/job-media";
import type { JobMediaGroupsRead } from "@/lib/workboard/job-media-query";
import type { OurJobNote } from "@/lib/workboard/job-notes-query";
import { thrownWords } from "@/lib/stale-deploy";

/* THE JOB CARD'S PAPERS, AND WHAT GOES OUT.

   Lifted out of the card (job-sheet) beside the diary (use-job-diary). The
   job's SWMS and certificates, the business's papers put on it, the files
   we filed ourselves, what is ticked to send and whether the letter is
   open, and the two doors out: the email, and ServiceM8. Each read is on
   its own clock, and a read that fails says so rather than drawing an empty
   list that looks true.

   The files are the card's (every face reads them), so they are handed in
   with their setter; a sent email's diary entry is handed back out
   (`onNoteSent`). The wizards stay the card's: they are where you are, and
   these are what they write. */

export type JobPapersInput = {
  /** The job's ServiceM8 uuid, once the card knows which job it is. */
  cardId: string | null;
  /** The job's files, as the card holds them. */
  media: JobMediaGroupsRead | null;
  setMedia: Dispatch<SetStateAction<JobMediaGroupsRead | null>>;
  onToast: (message: string) => void;
  /** The diary entry an email that went leaves, for the diary to show. */
  onNoteSent: (note: OurJobNote) => void;
};

export function useJobPapers({ cardId, media, setMedia, onToast, onNoteSent }: JobPapersInput) {
  /* THE JOB'S SWMS. Null until the read lands, like the files. */
  const [swms, setSwms] = useState<SwmsSummary[] | null>(null);
  const [swmsFailed, setSwmsFailed] = useState(false);
  /* THE JOB'S CERTIFICATES. */
  const [certs, setCerts] = useState<CertSummary[] | null>(null);
  const [certsFailed, setCertsFailed] = useState(false);
  /* THE BUSINESS'S PAPERS ON THIS JOB, and what this viewer may do with them
     — its own read on its own clock, like the SWMS. */
  const [papers, setPapers] = useState<JobPapersRead | null>(null);
  const [papersFailed, setPapersFailed] = useState(false);
  /* WHAT IS TICKED TO SEND, by send key (lib/compliance/papers), and whether
     the email is open in the footer: the ticks live on the Documents face
     and the letter in the footer below it. */
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [writing, setWriting] = useState(false);
  /* SERVICEM8, THE OTHER DOOR: what has gone from this job and whether this
     viewer gets the button, and why the last press left files behind. */
  const [sm8Read, setSm8Read] = useState<JobSm8Read | null>(null);
  const [sm8Note, setSm8Note] = useState<string | null>(null);
  /* An answer that lands after the card has gone draws nothing. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /* The job's certificates, on their own clock like the SWMS. A failed read
     says so rather than offering Create on a job that may have one. */
  useEffect(() => {
    if (!cardId) return;
    let live = true;
    void listCertificatesForJob(cardId)
      .then((list) => {
        if (!live) return;
        setCerts(list);
        setCertsFailed(list === null);
      })
      .catch(() => {
        if (live) setCertsFailed(true);
      });
    return () => {
      live = false;
    };
  }, [cardId]);

  /* The job's SWMS — ours, written by the wizard. Its own clock like the
     files; a read that fails reads as none rather than taking the card down,
     and the wizard can still be opened. */
  useEffect(() => {
    if (!cardId) return;
    let live = true;
    void listSwmsForJob(cardId)
      .then((list) => {
        if (!live) return;
        setSwms(list);
        setSwmsFailed(false);
      })
      .catch(() => {
        /* NOT an empty list: that offered Create SWMS on a job that may
           already have one, and a second press was a second SWMS */
        if (live) setSwmsFailed(true);
      });
    return () => {
      live = false;
    };
  }, [cardId]);

  /* PAPER WE FILE OURSELVES — the Documents face's upload. The bytes take the
     shared slot flow, the row is pointed at this job, and the files are read
     again so the row is on the face by the time its button says it's done.
     The face runs a batch one file at a time and says which of them didn't
     land. */
  const uploadDocument = async (file: File): Promise<string | null> => {
    if (!cardId) return "This card doesn't know its job yet.";
    try {
      const up = await uploadFile(file, "job_document");
      if (!up.ok) return up.error;
      if (up.file.previewUrl) URL.revokeObjectURL(up.file.previewUrl);
      /* a file that lands on no job is taken back out by the server */
      const put = await attachJobDocument(up.file.documentId, cardId);
      if (!put.ok) return put.error;
      const fresh = await readJobFiles(cardId).catch(() => null);
      /* two guards rather than one `&&`, because React Compiler 1.0 cannot
         lower a value block inside a try/catch — and one it can't lower
         skips the whole card */
      if (fresh) {
        if (alive.current) setMedia(fresh);
      }
      return null;
    } catch (e) {
      return thrownWords(e, "That upload didn't finish.");
    }
  };

  /* One of OURS off the job. Off the face at once — the read would only
     confirm what the answer already said. */
  const removeDocument = async (item: JobMediaItem): Promise<string | null> => {
    if (!item.documentId) return "ServiceM8's files stay in ServiceM8.";
    try {
      const res = await removeJobDocument(item.documentId);
      if (!res.ok) return res.error;
      if (alive.current)
        setMedia((m) =>
          m ? { ...m, documents: m.documents.filter((d) => d.remoteId !== item.remoteId) } : m
        );
      return null;
    } catch (e) {
      return thrownWords(e, "Couldn't remove that file.");
    }
  };

  /* A CERTIFICATE DELETED takes its PDFs off the job with it: both lists
     drop it now, and a tick on its PDF goes too */
  const removeCertificate = async (c: CertSummary): Promise<string | null> => {
    /* no try: React Compiler can't lower the branches below inside one */
    const res = await deleteCertificate(c.certificateId).catch((e: unknown) => ({
      ok: false as const,
      error: thrownWords(e, "Couldn't delete the certificate."),
    }));
    if (!res.ok) return res.error;
    if (!alive.current) return null;
    setCerts((list) => (list ? list.filter((x) => x.certificateId !== c.certificateId) : list));
    if (c.documentId) tick(ourDocumentSendKey(c.documentId), false);
    if (cardId) {
      const fresh = await readJobFiles(cardId).catch(() => null);
      if (fresh && alive.current) setMedia(fresh);
    }
    return null;
  };

  const reloadSwms = () => {
    if (!cardId) return;
    void listSwmsForJob(cardId)
      .then((list) => {
        if (!alive.current) return;
        setSwms(list);
        setSwmsFailed(false);
      })
      .catch(() => {
        if (alive.current) setSwmsFailed(true);
      });
  };

  /* The job's licences and insurance — ours, put on it from the Documents
     face. A read that fails says so on the face rather than drawing an empty
     Compliance group that looks true. */
  useEffect(() => {
    if (!cardId) return;
    let live = true;
    void listJobPapers(cardId)
      .then((read) => {
        if (!live) return;
        setPapers(read);
        setPapersFailed(false);
      })
      .catch(() => {
        if (live) setPapersFailed(true);
      });
    /* what has gone to ServiceM8 from here; a read that fails leaves the
       rows without their ServiceM8 words and the footer without the door */
    void readJobSm8(cardId)
      .then((read) => {
        if (live) setSm8Read(read);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [cardId]);

  const reloadPapers = async (): Promise<JobPapersRead | null> => {
    if (!cardId) return null;
    const read = await listJobPapers(cardId).catch(() => null);
    if (alive.current && read) {
      setPapers(read);
      setPapersFailed(false);
    }
    return read;
  };

  const tick = (key: string, on: boolean) => {
    /* the footer's "wasn't sent" was about the ticks as they were */
    setSm8Note(null);
    setPicked((cur) => {
      const next = new Set(cur);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  /* Put ticked papers on the job. What was just added is most often what is
     about to be sent, so it arrives ticked — the footer's Email documents is
     the next press, not a hunt back down the list. */
  const addPapers = async (keys: string[]): Promise<string | null> => {
    if (!cardId) return "This card doesn't know its job yet.";
    const res = await addJobPapers(cardId, keys).catch((e: unknown) => ({
      ok: false as const,
      error: thrownWords(e, "Couldn't add them to the job."),
    }));
    if (!res.ok) return res.error;
    const fresh = await reloadPapers();
    if (alive.current && fresh?.may.send && res.added.length > 0)
      setPicked((cur) => new Set([...cur, ...res.added.map(paperSendKey)]));
    return null;
  };

  /* Off the face at once — the read would only confirm what the answer said. */
  const removePaper = async (paper: JobPaper): Promise<string | null> => {
    const res = await removeJobPaper(paper.id).catch((e: unknown) => ({
      ok: false as const,
      error: thrownWords(e, "Couldn't take that off the job."),
    }));
    if (!res.ok) return res.error;
    if (alive.current) {
      setPapers((cur) => (cur ? { ...cur, papers: cur.papers.filter((p) => p.id !== paper.id) } : cur));
      tick(paperSendKey(paper.id), false);
    }
    return null;
  };

  const renewPaper = async (paper: JobPaper): Promise<string | null> => {
    const res = await renewJobPaper(paper.id).catch((e: unknown) => ({
      ok: false as const,
      error: thrownWords(e, "Couldn't switch to the renewal."),
    }));
    if (!res.ok) return res.error;
    await reloadPapers();
    return null;
  };

  /* THE TICKS AS THE LETTER WILL NAME THEM — read off what the face holds
     now, so a paper taken off or a file that went away is simply not sent
     rather than sent as a name with nothing behind it. */
  const pickedList = useMemo(() => {
    const out: { key: string; name: string }[] = [];
    for (const p of papers?.papers ?? []) {
      const key = paperSendKey(p.id);
      if (picked.has(key) && paperSendable(p)) out.push({ key, name: paperLabel(p) });
    }
    for (const d of media?.documents ?? []) {
      const key = d.documentId ? ourDocumentSendKey(d.documentId) : theirFileSendKey(d.remoteId);
      if (picked.has(key) && d.url) out.push({ key, name: d.name });
    }
    return out;
  }, [picked, papers, media]);

  const sendDocuments = async (input: { to: string[]; subject: string; message: string }): Promise<string | null> => {
    if (!cardId) return "This card doesn't know its job yet.";
    const res = await emailJobDocuments({
      jobUuid: cardId,
      keys: pickedList.map((p) => p.key),
      ...input,
    }).catch((e: unknown) => ({ ok: false as const, error: thrownWords(e, "The email didn't send. Try again in a minute.") }));
    if (!res.ok) return res.error;
    if (alive.current) {
      setPicked(new Set());
      setWriting(false);
      /* the diary says what went, the moment it went */
      const note = res.note;
      if (note) onNoteSent(note);
      onToast(`Email sent to ${andList(res.to)}`);
    }
    return null;
  };

  /* SEND TO SERVICEM8. The press waits for its files; what went is unticked
     and said in a toast, and what didn't keeps its tick and says why in the
     footer — pressing again tries it again. Every row's words come from the
     sends the answer carries, so the face is true the moment it returns. */
  const sendKeysToServiceM8 = async (keys: string[], nameOf: (key: string) => string): Promise<void> => {
    if (!cardId) return;
    setSm8Note(null);
    const res = await sendJobDocumentsToServiceM8({ jobUuid: cardId, keys }).catch((e: unknown) => ({
      ok: false as const,
      error: thrownWords(e, "Couldn't reach HeyTiff. Try again."),
    }));
    if (!alive.current) return;
    if (!res.ok) {
      setSm8Note(res.error);
      return;
    }
    setSm8Read((cur) => (cur ? { ...cur, sends: res.sends } : cur));
    const stay = new Set(res.failed.map((f) => f.key));
    setPicked((cur) => new Set([...cur].filter((k) => !keys.includes(k) || stay.has(k))));
    const toast = sendToast(res, nameOf);
    if (toast) onToast(toast);
    setSm8Note(sendFailure(res.failed, nameOf));
  };
  const sendToServiceM8 = (): Promise<void> => {
    const names = new Map(pickedList.map((p) => [p.key, p.name]));
    return sendKeysToServiceM8(
      pickedList.map((p) => p.key),
      (key) => names.get(key) ?? "A document"
    );
  };

  /* A CERTIFICATE ISSUED: its PDF is a file on the job now, so the files and
     the certificates are read again and the PDF arrives ticked — the next
     press is Email or Send, not a hunt down the list. */
  const certRead = useRef<Promise<void> | null>(null);
  const certIssued = (issued: { documentId: string }) => {
    if (!cardId) return;
    certRead.current = (async () => {
      const [fresh, list] = await Promise.all([
        readJobFiles(cardId).catch(() => null),
        listCertificatesForJob(cardId).catch(() => null),
      ]);
      if (!alive.current) return;
      if (fresh) setMedia(fresh);
      if (list) setCerts(list);
      if (papers?.may.send) tick(ourDocumentSendKey(issued.documentId), true);
    })();
  };

  /** Once a certificate just issued has been read back onto the job. */
  const certSettled = async () => {
    await certRead.current;
  };

  return {
    swms,
    swmsFailed,
    certs,
    certsFailed,
    papers,
    papersFailed,
    picked,
    writing,
    setWriting,
    sm8Read,
    sm8Note,
    uploadDocument,
    removeDocument,
    removeCertificate,
    reloadSwms,
    reloadPapers,
    tick,
    addPapers,
    removePaper,
    renewPaper,
    pickedList,
    sendDocuments,
    sendKeysToServiceM8,
    sendToServiceM8,
    certIssued,
    certSettled,
  };
}
