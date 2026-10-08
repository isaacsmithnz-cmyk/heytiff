import "server-only";
import { imageForClaude } from "@/lib/images/for-claude";
import { familyMediaSources } from "@/lib/workboard/all-jobs-query";
import type { JobMediaItem } from "@/lib/workboard/job-media";
import { readJobMediaGroups } from "@/lib/workboard/job-media-query";
import type { MediaBlock } from "./model";
import type { JobFile } from "./tools-run";

/* WHAT TIFF LOOKS AT (slice 4.6): the job's photos and documents, as the
   job card has them (its claims' too), and one of them handed to her: a
   picture made the size the plate reader sends, a PDF as a document. Only
   what's cached here, read through its signed address: nothing is fetched
   from ServiceM8 for her. Service role, by org; the route gates. */

const MAX_FILES = 40;
/** A PDF she reads at most: a plan set, not an archive. */
const MAX_PDF_BYTES = 10 * 1024 * 1024;

async function filesOf(orgId: string, jobUuid: string): Promise<JobMediaItem[]> {
  const claims = await familyMediaSources(orgId, jobUuid).catch(() => []);
  const g = await readJobMediaGroups(orgId, jobUuid, claims);
  return [...g.photos.filter((p) => p.kind === "photo"), ...g.documents].filter((f) => !!f.url).slice(0, MAX_FILES);
}

const isPdf = (f: JobMediaItem) => /pdf/i.test(f.fileType ?? "") || /\.pdf$/i.test(f.name);

export async function jobFiles(orgId: string, jobUuid: string): Promise<JobFile[]> {
  return (await filesOf(orgId, jobUuid)).map((f) => ({ id: f.remoteId, name: f.name, kind: f.kind === "photo" ? "photo" : "document", taken: f.takenAt, from: f.origin }));
}

export async function lookAt(orgId: string, jobUuid: string, id: string): Promise<MediaBlock[] | string> {
  const f = (await filesOf(orgId, jobUuid)).find((x) => x.remoteId === id);
  if (!f?.url) return "That file isn't on the job, or isn't here yet.";
  const res = await fetch(f.url).catch(() => null);
  if (!res?.ok) return "That file couldn't be opened just now.";
  const bytes = Buffer.from(await res.arrayBuffer());
  if (isPdf(f)) {
    if (bytes.length > MAX_PDF_BYTES) return "That PDF is too big to read whole.";
    return [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: bytes.toString("base64") } }];
  }
  if (f.kind !== "photo" && !/image|jpe?g|png|webp|heic/i.test(f.fileType ?? "")) return "She can look at pictures and PDFs only.";
  const image = await imageForClaude(bytes, res.headers.get("content-type"));
  if (!image) return "That picture couldn't be read.";
  return [{ type: "image", source: { type: "base64", media_type: image.mime, data: image.bytes.toString("base64") } }];
}
