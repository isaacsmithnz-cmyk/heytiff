/* WHERE A RECORD OPENS — one set of links for every door into a record.

   The ⌘K palette built these inline; Tiff's `open_record` needs the same
   ones, and two copies of a link drift (a job opened from one door would
   land somewhere else from the other). Each part is encoded, so a client
   named "Smith & Sons" or an id with a slash stays one part of the address. */

/** A person opens on their staff card. */
export const staffHref = (id: string) => `/dashboard/team/${encodeURIComponent(id)}`;

/** A job opens where its card lives: the Workboard, with its sheet up, found
    in the board's window or past it (the page reads the whole mirror). */
export const jobHref = (uuid: string) => `/dashboard/workboard?job=${encodeURIComponent(uuid)}`;

/** A client has no page of their own: the Workboard's search, run on their
    name, is every job, visit, project and photo that names them. */
export const clientHref = (name: string) => `/dashboard/workboard?q=${encodeURIComponent(name)}`;

export const projectHref = (id: string) => `/dashboard/workboard/projects/${encodeURIComponent(id)}`;
