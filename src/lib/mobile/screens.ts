/* WHERE A WEB ADDRESS OPENS ON THE PHONE. Tiff's "take me there" names the
   web's pages (/dashboard/…); the phone has its own screens for some of
   them. One with no phone screen opens nothing: her words still say where
   it is. Pure. */

const SAME: [RegExp, string][] = [
  [/^\/dashboard\/?$/, "/"],
  [/^\/dashboard\/schedule\/?$/, "/schedule"],
  [/^\/dashboard\/jobs\/?$/, "/jobs"],
  [/^\/dashboard\/tiff\/library\/?$/, "/library"],
  [/^\/dashboard\/conversations\/?$/, "/conversations"],
  [/^\/dashboard\/profile\/?$/, "/card"],
  [/^\/dashboard\/my-timesheet\/?$/, "/timesheet"],
  [/^\/dashboard\/my-leave\/?$/, "/leave"],
  [/^\/dashboard\/studio\/?$/, "/designs"],
];

/** The phone's screen for a web address, or null where it has none. */
export function phonePath(href: string): string | null {
  const [path, query = ""] = href.split("?");
  const job = /^\/dashboard\/jobs\/([^/]+)\/?$/.exec(path ?? "");
  if (job) return `/job?id=${job[1]}`;
  const jobs = /^\/dashboard\/jobs\/?$/.test(path ?? "") ? new URLSearchParams(query).get("q") : null;
  if (jobs) return `/jobs?q=${encodeURIComponent(jobs)}`;
  for (const [re, to] of SAME) if (re.test(path ?? "")) return to;
  return null;
}
