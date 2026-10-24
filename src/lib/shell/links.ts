/* WHERE A RECORD OPENS — one set of links for every door into a record.

   The ⌘K palette built these inline; Tiff's `open_record` needs the same
   ones, and two copies of a link drift (a job opened from one door would
   land somewhere else from the other). Each part is encoded, so a client
   named "Smith & Sons" or an id with a slash stays one part of the address. */

/** A person opens on their staff card. */
export const staffHref = (id: string) => `/dashboard/team/${encodeURIComponent(id)}`;

/** A job opens on its own page (the v2 audit, 20 October 2026: the
    Workboard is retired), on the Quote section when the old card's Quote
    face is named. */
export const jobHref = (uuid: string, face?: string) => jobPageHref(uuid, face === "quote" ? "quote" : undefined);

/** A job's own page (v2, step 5), on the section named — Overview when none
    is. */
export const jobPageHref = (uuid: string, section?: string) =>
  `/dashboard/jobs/${encodeURIComponent(uuid)}${section && section !== "overview" ? `?tab=${encodeURIComponent(section)}` : ""}`;

/** A vehicle's own page (v2, "A vehicle's own page"), on the section named,
    Overview when none is. The register's rows open it; the old card still
    opens from the doors that name `/dashboard/assets?v=` (a staff card's
    plate, Home's Renew, the calendar) until Team is rebuilt. */
export const vehiclePageHref = (id: string, section?: string) =>
  `/dashboard/vehicles/${encodeURIComponent(id)}${section && section !== "overview" ? `?tab=${encodeURIComponent(section)}` : ""}`;

/** A client has no page of their own: Jobs' search, run on their name, is
    every job that names them. */
export const clientHref = (name: string) => `/dashboard/jobs?q=${encodeURIComponent(name)}`;

/** The projects: Jobs' Projects view. */
export const projectsHref = "/dashboard/jobs?view=projects";

/** A project's own page, under Jobs (24 October 2026; it was the
    Workboard's, whose old address still lands here). */
export const projectHref = (id: string) => `/dashboard/jobs/projects/${encodeURIComponent(id)}`;

/** A job's quote, full screen, under its job (24 October 2026; it was the
    Workboard's): `start` opens with the reply box ready for the brief, and
    `option` on that option. */
export const quoteHref = (job: string, opts: { start?: boolean; option?: number | null } = {}) => {
  const q = [opts.start ? "start=1" : null, opts.option != null ? `option=${opts.option}` : null].filter(Boolean).join("&");
  return `/dashboard/jobs/${encodeURIComponent(job)}/quote${q ? `?${q}` : ""}`;
};

/** A maintenance visit opens its sheet over Jobs, the record host reading
    `?open=visit.<id>` (records/ref): the Workboard it opened on is retired
    (the old-code audit, 23 October 2026). */
export const visitHref = (id: string) => `/dashboard/jobs?open=${encodeURIComponent(`visit.${id}`)}`;
