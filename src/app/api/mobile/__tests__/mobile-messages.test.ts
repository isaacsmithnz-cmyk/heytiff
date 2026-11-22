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
import { fileDoors, phoneMessages, shortBusinessName } from "@/lib/mobile/job-messages";

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
    subject: "Request for Air Conditioning Quote – 29 Velit St Testmore NSW 2042",
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
    expect(phoneMessages([], { today: null, doors: new Map() })).toEqual({ latest: null, items: [], flow: [] });
  });

  it("keeps the old rows for a phone that hasn't updated, with who sent each send, how and its plain words", () => {
    const send = phoneMessages(items, { today: null, doors: new Map() }).items.find((i) => i.kind === "send");
    expect(send).toMatchObject({ words: "Booking for Tue 27 Oct, 7:30 am texted", reply: "Jay: YES", who: null, via: "text", plain: "Booking for Tue 27 Oct, 7:30 am texted" });
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

/* BUG 20 (Isaac, 17 November 2026: "This looks pretty messy", then "Yes, all
   of it" to the tidied board): one conversation, a heading for each day,
   everything the business sent a green bubble with who sent it and how, the
   customer's answers grey, the time or Seen under the last of a run. Drawn
   on 2359's messages: Isaac's booking and Simon's Yes, Luke's brochures,
   Leonardo on the way, and Luke's invoice emailed, then emailed and texted. */
describe("a job's messages as one conversation", () => {
  const send = (over: Partial<Extract<CustomerItem, { kind: "send" }>> & { key: string; at: string }): CustomerItem => ({
    kind: "send",
    day: over.at.slice(0, 10),
    sort: "other",
    icon: "message",
    words: "",
    detail: null,
    opening: null,
    line: "",
    reply: null,
    seen: null,
    files: [],
    amountCents: null,
    refs: [],
    ...over,
  });
  const invoiceFile = { id: "INV-2359", name: "Invoice 2359", type: ".pdf" };
  const booking = send({
    key: "send:book",
    at: "2026-01-29 09:02:00",
    sort: "booking",
    words: "Booking for Wed 4 Feb, 7:00 am texted",
    reply: "Simon: Yes",
    who: "Isaac",
    via: "text",
    plain: "Booking for Wed 4 Feb, 7:00 am",
    time: "9:02 am",
    answer: { who: "Simon", words: "Yes", time: "9:40 am", at: "2026-01-29 09:40:00" },
  });
  const brochures: CustomerItem = {
    kind: "thread",
    key: "thread:2026-01-29",
    day: "2026-01-29",
    at: "2026-01-29 11:14:00",
    icon: "message",
    title: "Text with Simon",
    subject: null,
    lines: [{ ...bubble("msg:b", "us", "Luke", "brochures", "11:14 am"), who: "Luke", at: "2026-01-29 11:14:00", via: "text" }],
  };
  const way = send({ key: "send:way", at: "2026-02-04 06:41:00", sort: "way", icon: "car", words: "On the way texted", detail: "Leonardo", who: "Leonardo", via: "text", plain: "On the way", time: "6:41 am" });
  const emailed = send({ key: "send:inv1", at: "2026-02-06 10:00:00", sort: "invoice", icon: "mail", words: "Invoice emailed", seen: "Seen 2:23 pm", files: [invoiceFile], who: "Luke", via: "email", plain: "Invoice", time: "10:00 am" });
  const both = send({ key: "send:inv2", at: "2026-02-14 10:00:00", sort: "invoice", icon: "mail", words: "Invoice sent", detail: "by email and text", seen: "Seen 2:01 pm", who: "Luke", via: "both", plain: "Invoice", time: "10:00 am" });
  const all = [both, way, emailed, brochures, booking];
  const doors = new Map([[invoiceFile.id.toLowerCase(), "https://signed/invoice"]]);
  const flow = phoneMessages(all, { today: null, doors }).flow;
  const said = (f: (typeof flow)[number]) => (f.kind === "day" ? `## ${f.label}` : `${f.side} ${f.name ?? "-"} [${f.via ?? ""}] ${f.words} (${f.under ?? ""})`);

  it("runs oldest first under a heading for each day: the business's sends green with who and how, the customer's answers grey", () => {
    expect(flow.map(said)).toEqual([
      "## Thu 29 Jan",
      "us Isaac [text] Booking for Wed 4 Feb, 7:00 am (9:02 am)",
      "them Simon [] Yes (9:40 am)",
      "us Luke [text] brochures (11:14 am)",
      "## Wed 4 Feb",
      "us Leonardo [text] On the way (6:41 am)",
      "## Fri 6 Feb",
      "us Luke [email] Invoice (Seen 2:23 pm)",
      "## Sat 14 Feb",
      "us Luke [both] Invoice (Seen 2:01 pm)",
    ]);
  });

  it("opens a send's file from under its bubble", () => {
    const inv = flow.find((f) => f.kind === "bubble" && f.key === "send:inv1");
    expect(inv?.kind === "bubble" ? inv.files : null).toEqual([{ ...invoiceFile, url: "https://signed/invoice" }]);
  });

  it("says a run's name over its first bubble and its time under its last, and lays a send inside a thread among its bubbles by the clock", () => {
    const thread: CustomerItem = {
      kind: "thread",
      key: "thread:2026-01-30",
      day: "2026-01-30",
      at: "2026-01-30 10:20:00",
      icon: "message",
      title: "Text with Simon",
      subject: null,
      lines: [
        { ...bubble("msg:1", "them", "Simon", "Can you come Friday?", "10:00 am"), who: "Simon", at: "2026-01-30 10:00:00" },
        { ...bubble("msg:2", "us", "Luke", "Friday works", "10:05 am"), who: "Luke", at: "2026-01-30 10:05:00", via: "text" },
        { ...bubble("msg:3", "us", null, "I'll send the booking", "10:06 am"), who: "Luke", at: "2026-01-30 10:06:00", via: "text" },
        {
          kind: "line",
          key: "send:fri",
          words: "Booking for Fri 6 Feb, 7:00 am texted",
          reply: null,
          send: send({ key: "send:fri", at: "2026-01-30 10:20:00", sort: "booking", who: "Luke", via: "text", plain: "Booking for Fri 6 Feb, 7:00 am", time: "10:20 am" }) as Extract<CustomerItem, { kind: "send" }>,
        },
      ],
    };
    expect(phoneMessages([thread], { today: null, doors: new Map() }).flow.map(said)).toEqual([
      "## Fri 30 Jan",
      "them Simon [] Can you come Friday? (10:00 am)",
      "us Luke [text] Friday works ()",
      "us - [text] I'll send the booking ()",
      "us - [text] Booking for Fri 6 Feb, 7:00 am (10:20 am)",
    ]);
  });

  it("reads a feed from before the bubbles: the send's words as they were and the answer read off its row", () => {
    const old = phoneMessages(items, { today: null, doors: new Map() }).flow;
    expect(old.filter((f) => f.kind === "bubble").map(said).slice(-2)).toEqual(["us - [text] Booking for Tue 27 Oct, 7:30 am texted (12:56 pm)", "them Jay [] YES ()"]);
  });

  it("calls a business by its short name", () => {
    expect(shortBusinessName("Diamond Air Solutions Pty LTD")).toBe("Diamond Air");
    expect(shortBusinessName("QX Construct Pty. Ltd.")).toBe("QX Construct");
    expect(shortBusinessName("Acme Air")).toBe("Acme Air");
    expect(shortBusinessName("Plumbing Services")).toBe("Plumbing Services");
    expect(shortBusinessName("  ")).toBeNull();
  });
});
