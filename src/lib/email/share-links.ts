/* THE LINKS A BUILDER SENDS INSTEAD OF FILES (Isaac, 29 October 2026: "Lots
   of builders send things that way. She could at least bring the link for
   you to click on straight from the job card"). The Krui Street tender's
   plans sat behind "260917 Tender Issue", an architect's OneDrive folder.

   Found in code, never by Tiff: a link is copied from the email exactly as
   it was written, so no read can mangle or invent one. Only the places
   plans are kept (file shares and tender sites); a map, a website or a
   social page in a signature is left where it was. Opening one is the
   person's own click; nothing here fetches it.

   Pure: tested without a network. */

export type ShareLink = {
  url: string;
  /** what the email called it ("260917 Tender Issue"), else what it is */
  name: string;
  /** what it is: "OneDrive folder", "Dropbox file", "EstimateOne" */
  what: string;
};

/** The hosts plans are shared from, each with how to tell a folder from a
    file by its path. A host matches itself and anything under it. */
const HOSTS: { host: string; what: string; folder?: RegExp; file?: RegExp }[] = [
  { host: "sharepoint.com", what: "SharePoint", folder: /^\/:f:\//, file: /^\/:[a-z]:\// },
  { host: "onedrive.live.com", what: "OneDrive" },
  { host: "1drv.ms", what: "OneDrive", folder: /^\/f\//, file: /^\/[a-z]\// },
  { host: "dropbox.com", what: "Dropbox", folder: /^\/(scl\/fo|sh)\//, file: /^\/(scl\/fi|s)\// },
  { host: "drive.google.com", what: "Google Drive", folder: /^\/drive\/(u\/\d+\/)?folders\//, file: /^\/file\// },
  { host: "docs.google.com", what: "Google Drive", file: /^\/(document|spreadsheets|presentation)\// },
  { host: "wetransfer.com", what: "WeTransfer" },
  { host: "we.tl", what: "WeTransfer" },
  { host: "box.com", what: "Box" },
  { host: "estimateone.com", what: "EstimateOne" },
  { host: "procore.com", what: "Procore" },
  { host: "aconex.com", what: "Aconex" },
];

/** A link on a job's Documents: which email it came in on, and whose that
    email was (the builder's contact or company; never the person who
    forwarded it). */
export type JobShareLink = ShareLink & { emailId: string; from: string | null };

const MAX_LINKS = 6;

const onHost = (hostname: string, host: string) => hostname === host || hostname.endsWith(`.${host}`);

/** Outlook's Safe Links wraps a link in its own; the link is its `url`. */
function unwrapped(u: URL): URL {
  if (!onHost(u.hostname, "safelinks.protection.outlook.com")) return u;
  const inner = u.searchParams.get("url");
  if (!inner) return u;
  try {
    return new URL(inner);
  } catch {
    return u;
  }
}

/** What a link is, or null when it isn't where plans are kept. */
export function shareWhat(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const hostname = u.hostname.toLowerCase();
  const h = HOSTS.find((x) => onHost(hostname, x.host));
  if (!h) return null;
  /* a personal SharePoint site is the person's OneDrive */
  const what = h.host === "sharepoint.com" && hostname.endsWith("-my.sharepoint.com") ? "OneDrive" : h.what;
  if (h.folder?.test(u.pathname)) return `${what} folder`;
  if (h.file?.test(u.pathname)) return `${what} file`;
  return what;
}

/** What the email called a link: Gmail writes a link as its words then the
    address in angle brackets, on the next line when the words run long
    ("Tender link: 260917 Tender Issue\n<https://…>"). The words after a
    label's colon; nothing when the address stood alone. */
function nameBefore(text: string, at: number): string {
  if (text[at - 1] !== "<") return "";
  const before = text.slice(0, at - 1);
  const lines = before.split("\n");
  let line = lines.pop()!.trim();
  if (!line && lines.length) line = lines.pop()!.trim();
  if (!line || /https?:\/\//i.test(line)) return "";
  const words = line
    .replace(/^[-*•>\s]+/, "")
    .replace(/\*/g, "")
    .split(/:\s+/)
    .pop()!
    .replace(/[\s:–-]+$/, "")
    .trim();
  return words.length >= 2 && words.length <= 100 ? words : "";
}

/** The plan links in an email's text, each once, in the order written. */
export function shareLinksIn(text: string | null | undefined): ShareLink[] {
  const body = text ?? "";
  const out: ShareLink[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(/https?:\/\/[^\s<>"'()[\]]+/gi)) {
    const raw = m[0].replace(/[.,;:!?]+$/, "");
    let u: URL;
    try {
      u = unwrapped(new URL(raw));
    } catch {
      continue;
    }
    const url = u.toString();
    const what = shareWhat(url);
    if (!what || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, name: nameBefore(body, m.index ?? 0) || what, what });
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

/** A job's links from the emails on it, newest email first, each link
    once. */
export function jobShareLinks(
  emails: readonly { id: string; body: string | null; proposal: { client?: string; contact?: { first?: string; last?: string } } | null }[]
): JobShareLink[] {
  const out: JobShareLink[] = [];
  const seen = new Set<string>();
  for (const e of emails) {
    const c = e.proposal?.contact;
    const from = [c?.first, c?.last].filter(Boolean).join(" ") || e.proposal?.client || null;
    for (const l of shareLinksIn(e.body)) {
      if (seen.has(l.url)) continue;
      seen.add(l.url);
      out.push({ ...l, emailId: e.id, from });
    }
  }
  return out;
}

/** "a OneDrive folder" (said "won"), "an EstimateOne". */
export const aShare = (what: string) => `${/^[aeiou]/i.test(what) && !/^one/i.test(what) ? "an" : "a"} ${what}`;
