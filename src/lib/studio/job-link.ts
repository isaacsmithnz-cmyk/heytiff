/* Starting a design FROM a ServiceM8 job — pure, client-safe.

   A design is named after a street ("14 Harbour View Rd"), and the job it
   belongs to already knows the street, the client and the site. Typing all
   four again is how a design ends up filed under a slightly different name
   than the job it is for. So the new-design step offers the mirror's own
   search, and picking a job fills the fields the Summary sheet prints.

   THE THREE META FIELDS HAVE ALWAYS BEEN THERE. `DesignMeta.jobNumber`,
   `.client` and `.site` shipped with the document schema and were only ever
   typed by hand on the Summary step — `createDesign` set them to "". This is
   the other end of that wire, not a new field, which is why picking a job
   costs no migration.

   ADDRESSES ARRIVE MULTI-LINE. ServiceM8 stores `job_address` as the label a
   driver reads: "2 Spring St\nPaddington NSW 2021", occasionally with a
   trailing comma on the street line ("260 Birrell St,"). The design NAME
   wants only the street; the SITE field wants the whole thing on one line.
   Both live here so a screen can never invent its own version. */

/** One ServiceM8 job as the studio's picker sees it. Deliberately its own
    type rather than the workboard's `JobSearchHit`: this one crosses to the
    browser, so it carries no company uuid and no project links. */
export type StudioJobHit = {
  remoteId: string;
  jobNumber: string | null;
  clientName: string | null;
  /** Verbatim: 'Quote' | 'Work Order' | 'Completed' | 'Unsuccessful'. */
  status: string | null;
  /** ServiceM8's site address, verbatim — newlines and all. */
  address: string | null;
  suburb: string | null;
  description: string | null;
};

/** What picking a job writes into a fresh design's meta. */
export type JobPrefill = {
  name: string;
  jobNumber: string;
  client: string;
  site: string;
};

/** The street line alone — "12/3 Wallace St" — which is what a design is
    called. Trailing punctuation is ServiceM8's, not the address's. */
export function streetLine(address: string | null): string {
  const first = (address ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return (first ?? "").replace(/[,\s]+$/, "");
}

/** The whole address on one line — "2 Spring St, Paddington NSW 2021" — for
    the Summary sheet's Site field and anything else that prints in a row. */
export function flatAddress(address: string | null): string {
  return (address ?? "")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim().replace(/[,\s]+$/, ""))
    .filter((l) => l.length > 0)
    .join(", ");
}

/** The line under a job in the picker: who it's for, where, and its state.
    Never the job number — that has its own column and saying it twice is how
    a long client name gets pushed off the row. */
export function jobSubtitle(hit: StudioJobHit): string {
  const suburb = (hit.suburb ?? "").trim();
  return [hit.clientName?.trim(), suburb, hit.status?.trim()]
    .filter((s): s is string => Boolean(s))
    .join(" · ");
}

/** What the picked job calls the design, and the three fields it fills.

    The name falls back the way a person would: the street if there is one,
    otherwise who it's for, otherwise the number — and a job with none of the
    three is not something you can name at all, so the caller's own default
    ("Untitled design") stands rather than a blank being written over it. */
export function prefillFromJob(hit: StudioJobHit): JobPrefill {
  const street = streetLine(hit.address);
  const client = (hit.clientName ?? "").trim();
  const number = (hit.jobNumber ?? "").trim();
  const site = flatAddress(hit.address) || (hit.suburb ?? "").trim();

  const name = street || client || (number ? `Job ${number}` : "");

  return { name, jobNumber: number, client, site };
}
