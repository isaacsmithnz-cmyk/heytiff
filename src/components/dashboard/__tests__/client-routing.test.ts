import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/* NO INTERNAL LINK ON THE DASHBOARD SURFACE MAY BE A PLAIN ANCHOR.

   A raw `<a href="/dashboard/...">` is a full document navigation: no client
   routing, no prefetch, the entire shell torn down and rebuilt to move one
   screen. Home is the most-visited screen in the app and every door out of it
   was one — the four hero counters, the noticeboard card, the payroll rows,
   the action-required tiles, and both "← Home" back links.

   It fails nothing. It renders correctly, passes every test, and simply feels
   like a slower app — which is why it survived a page-load performance pass
   that fixed the server side and never looked at the markup.

   EXTERNAL links stay plain anchors and are meant to: the noticeboard's
   attachments and image lightbox point at short-lived signed storage URLs,
   which are not routes and must not be prefetched. Hence matching on a
   leading slash rather than on `<a` itself. */

const DIR = join(process.cwd(), "src/components/dashboard");

/** `<a ... href="/…">` — an internal route rendered as a plain anchor. */
const INTERNAL_ANCHOR = /<a\b[^>]*\bhref=["'`]\//;

function sources(): { file: string; text: string }[] {
  return readdirSync(DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => ({ file: e.name, text: readFileSync(join(DIR, e.name), "utf8") }));
}

describe("dashboard links", () => {
  it("has files to check", () => {
    expect(sources().length).toBeGreaterThan(3);
  });

  it("routes internally with Link, never a bare anchor", () => {
    const offenders = sources()
      .filter(({ text }) => INTERNAL_ANCHOR.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
