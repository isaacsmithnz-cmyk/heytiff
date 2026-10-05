"use client";

import { attachJobDocument } from "@/app/actions/job-documents";
import { thrownWords } from "@/lib/stale-deploy";
import { uploadFile } from "./upload-client";

/** A file onto a job's documents, as the Documents face files one: uploaded,
    then put on the job. A plain function, not inside a component, because
    React Compiler 1.0 can't lower a conditional inside a component's try. */
export async function fileOnJob(file: File, jobUuid: string): Promise<{ ok: true; documentId: string } | { ok: false; error: string }> {
  try {
    const up = await uploadFile(file, "job_document");
    if (!up.ok) return { ok: false, error: up.error };
    if (up.file.previewUrl) URL.revokeObjectURL(up.file.previewUrl);
    const put = await attachJobDocument(up.file.documentId, jobUuid);
    if (!put.ok) return { ok: false, error: put.error };
    return { ok: true, documentId: up.file.documentId };
  } catch (e) {
    return { ok: false, error: thrownWords(e, "That upload didn't finish.") };
  }
}
