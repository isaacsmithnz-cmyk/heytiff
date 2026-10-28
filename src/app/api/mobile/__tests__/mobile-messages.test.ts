/**
 * @jest-environment node
 */

/* A job's texts and emails on the phone (lib/mobile/job-messages): the web's
   All feed, oldest first, the day said where it changes, the latest thing
   said for the job page's row, and a file opening only where the job's own
   read holds it (an invoice's paper only with money). Drawn on 3215's real
   messages: Jay's texts of 8 October, and his YES to the booking of the 15th. */

import type { CustomerItem } from "@/lib/jobs/customer-messages";
import type { JobMediaItem } from "@/lib/workboard/job-media";
import { fileDoors, phoneMessages } from "@/lib/mobile/job-messages";

const bubble = (key: string, side: "them" | "us", name: string | null, words: string, time: string, files: { id: string; name: string | null; type: string | null }[] = []) => ({
  kind: "bubble" as const,
  key,
  side,
  name,
  words,
  last: true,
  time,
  seen: null,
  files,
  full: { subject: null, from: null, to: null, when: `Thu 8 Oct, ${time}`, text: words, files },
});

const quoteFile = { id: "01A11913-86E4-7C94-9D9A-1B8124F559FA", name: "Diamond Air Solutions Pty LTD Quote #3215", type: ".pdf" };

const items: CustomerItem[] = [
  /* newest first, as a feed may hand them over */
  {
    kind: "send",
    key: "send:b",
    day: "2026-10-15",
    at: "2026-10-15 12:56:07",
    sort: "booking",
    icon: "message",
    words: "Booking for Tue 27 Oct, 7:30 am texted",
    detail: null,
    opening: null,
    line: "Booking for Tue 27 Oct, 7:30 am texted",
    reply: "Jay: YES",
    seen: null,
    files: [],
    amountCents: null,
    refs: [],
  },
  {
    kind: "thread",
    key: "thread:2026-10-08",
    day: "2026-10-08",
    at: "2026-10-08 14:32:37",
    icon: "mail",
    title: "Email and text with Jay",
    subject: "Request for Air Conditioning Quote – 29 Wemyss St Enmore NSW 2042",
    lines: [
      bubble("m1", "them", "Jay", "Hi still have not seen your estimate", "10:21 am"),
      bubble("m2", "us", "Luke", "Dear Jay,\nThank you for the opportunity", "12:14 pm", [quoteFile]),
      bubble("m3", "us", null, "Unfortunately we would need to do it as a seperate job in different day.", "2:25 pm"),
      bubble("m4", "them", "Jay", "Oh ok", "2:32 pm"),
    ],
  },
];

const media = (documents: Partial<JobMediaItem>[]) => ({ photos: [], documents: documents as JobMediaItem[] });

describe("a job's messages on the phone", () => {
  it("runs oldest first, saying the day where it changes", () => {
    const out = phoneMessages(items, { today: "2026-10-28", doors: new Map() });
    expect(out.items.map((i) => (i.kind === "day" ? `day ${i.label}` : i.kind))).toEqual(["day Thu 8 Oct", "thread", "day Thu 15 Oct", "send"]);
  });

  it("calls today and yesterday by name", () => {
    const out = phoneMessages(items, { today: "2026-10-16", doors: new Map() });
    expect(out.items.filter((i) => i.kind === "day").map((i) => (i.kind === "day" ? i.label : ""))).toEqual(["Thu 8 Oct", "Yesterday"]);
  });

  it("gives the job page the latest thing said: the customer's answer to a booking", () => {
    expect(phoneMessages(items, { today: null, doors: new Map() }).latest).toEqual({ who: "Jay", day: "2026-10-15", words: "YES" });
  });

  it("names whoever said a thread's last message, from the top of their run", () => {
    const thread = items[1]!;
    const out = phoneMessages([thread], { today: null, doors: new Map() });
    expect(out.latest).toEqual({ who: "Jay", day: "2026-10-08", words: "Oh ok" });
    const ending = { ...(thread as Extract<CustomerItem, { kind: "thread" }>) };
    ending.lines = ending.lines.slice(0, 3);
    expect(phoneMessages([ending], { today: null, doors: new Map() }).latest).toEqual({
      who: "Luke",
      day: "2026-10-08",
      words: "Unfortunately we would need to do it as a seperate job in different day.",
    });
  });

  it("has nothing for a job with no messages", () => {
    expect(phoneMessages([], { today: null, doors: new Map() })).toEqual({ latest: null, items: [] });
  });

  it("opens a file only where the job's read holds it, by its uuid in any case", () => {
    const doors = fileDoors(media([{ remoteId: quoteFile.id.toLowerCase(), url: "https://signed/quote", origin: "Quote", kind: "doc" as JobMediaItem["kind"] }]), false);
    const out = phoneMessages(items, { today: null, doors });
    const thread = out.items.find((i) => i.kind === "thread");
    const withFile = thread?.kind === "thread" ? thread.lines.find((l) => l.kind === "bubble" && l.files.length) : null;
    expect(withFile && withFile.kind === "bubble" ? [withFile.files[0]!.url, withFile.full.files[0]!.url] : null).toEqual(["https://signed/quote", "https://signed/quote"]);
    expect(phoneMessages(items, { today: null, doors: new Map() }).items.flatMap((i) => (i.kind === "thread" ? i.lines.flatMap((l) => (l.kind === "bubble" ? l.files.map((f) => f.url) : [])) : []))).toEqual([null]);
  });

  it("keeps an invoice's paper for someone who sees money", () => {
    const invoice = media([{ remoteId: "inv-1", url: "https://signed/invoice", origin: "Invoice", kind: "doc" as JobMediaItem["kind"] }]);
    expect(fileDoors(invoice, false).get("inv-1")).toBeUndefined();
    expect(fileDoors(invoice, true).get("inv-1")).toBe("https://signed/invoice");
  });
});
