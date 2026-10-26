import {
  bareSubject,
  commsThreads,
  fileTypeWord,
  linkParts,
  isMoneySend,
  bookingWhen,
  customerFeed,
  htmlToText,
  openingPattern,
  pairClaims,
  phoneKey,
  templateMarked,
  withoutEchoes,
  withoutQuoted,
  type CustomerSend,
  type CustomerThread,
  type ThreadBubble,
} from "../customer-messages";
import { fixture3372 } from "../__fixtures__/customer-3372";
import type { StoryEntry } from "@/lib/workboard/job-story";

/* THE CUSTOMER'S TEXTS AND EMAILS IN THE FEED (Isaac, 26 October 2026,
   "Yes build"), on job 3372's shape, anonymised. */

const feed = (money = true) =>
  customerFeed(fixture3372(), { customer: "Marco", money, staffOf: (m) => m.name });
const sends = (items = feed()) => items.filter((i): i is CustomerSend => i.kind === "send");
const threads = (items = feed()) => items.filter((i): i is CustomerThread => i.kind === "thread");

describe("ServiceM8's own sends", () => {
  it("are told by ServiceM8's marks: its link, Track my arrival, a reply-YES booking", () => {
    expect(templateMarked("View your invoice online here: https://sm8.link/fa2w")).toBe(true);
    expect(templateMarked("arriving in 23 minutes. Track my arrival at https://x.example")).toBe(true);
    expect(templateMarked("* 'YES' to confirm the booking.")).toBe(true);
    expect(templateMarked("Reply YES to confirm")).toBe(true);
    expect(templateMarked("Yes, I'll be attending at 2:00 PM today.")).toBe(false);
  });

  it("are known by their opening, whoever they greet, for the five-job question", () => {
    const a = openingPattern("Dear Marco,\n\nThank you for the opportunity to provide a quotation for your air conditioning");
    const b = openingPattern("Dear Priya,\nThank you for the opportunity to provide a quotation for your air conditioning");
    expect(a).toBe(b);
    expect(a).toBe("%Thank%you%for%the%opportunity%to%provide%a%");
    /* too little to know a send by */
    expect(openingPattern("Thanks Marco")).toBeNull();
  });

  it("reads a booking's day and time, and says Booking request where it can't", () => {
    expect(bookingWhen("2:00 PM on Wednesday 14th October 2026 at 1 Example Street", 2026)).toEqual({ day: "2026-10-14", minutes: 14 * 60 });
    expect(bookingWhen("7:30am Fri 16 Oct", 2026)).toEqual({ day: "2026-10-16", minutes: 7 * 60 + 30 });
    expect(bookingWhen("on 16/10/2026 at 12:15 pm", 2026)).toEqual({ day: "2026-10-16", minutes: 12 * 60 + 15 });
    expect(bookingWhen("We have a time for you next week", 2026)).toBeNull();
    const booked = sends().find((s) => s.day === "2026-10-14")!;
    expect(booked.words).toBe("Booking for Wed 14 Oct, 2:00 pm texted");
    const unread = customerFeed(
      [{ ...fixture3372()[3]!, text: "Reply YES to confirm your booking with us" }],
      { customer: "Marco", money: true },
    );
    expect((unread[0] as CustomerSend).words).toBe("Booking request texted");
  });

  it("says a short reply to a booking on the booking's row, never as a bubble of its own", () => {
    const booked = sends().find((s) => s.day === "2026-10-14")!;
    expect(booked.reply).toBe("Marco: YES");
    expect(sends().find((s) => s.day === "2026-10-07")!.reply).toBe("Marco: YES");
    const all = feed().flatMap((i) => (i.kind === "thread" ? i.lines : []));
    expect(all.some((l) => l.kind === "bubble" && /^yes$/i.test(l.words))).toBe(false);
    /* the 6 October booking's answer sits on its line inside the thread */
    const line = threads().find((t) => t.day === "2026-10-06")!.lines.find((l) => l.kind === "line" && l.words.startsWith("Booking"));
    expect(line).toEqual({ kind: "line", key: expect.any(String), words: "Booking for 2:00 pm texted", reply: "Marco: Yes" });
  });

  it("makes one row of an invoice emailed and texted within five minutes, its amount for whoever sees money", () => {
    const invoice = sends().filter((s) => s.sort === "invoice");
    expect(invoice).toHaveLength(1);
    expect(invoice[0]).toMatchObject({ words: "Invoice sent, $13,200", detail: "by email and text", seen: "Seen 12:58 pm" });
    expect(invoice[0]!.files.map((f) => f.name)).toEqual(["Acme Air Invoice #3372"]);
    expect(sends(feed(false)).find((s) => s.sort === "invoice")!.words).toBe("Invoice sent");
  });

  it("says an arrival with who and how long, and a quote with its paper and when it was seen", () => {
    expect(sends().find((s) => s.day === "2026-10-16")).toMatchObject({ words: "On the way texted", detail: "Sam, about 23 minutes", icon: "car" });
    expect(sends().find((s) => s.day === "2026-09-29")).toMatchObject({ words: "Quote emailed", seen: "Seen 9:45 am" });
    expect(sends().find((s) => s.day === "2026-09-29")!.files).toHaveLength(1);
    /* seen another day says the day */
    expect(sends().find((s) => s.day === "2026-10-12")!.seen).toBe("Seen Tue 13 Oct, 6:46 pm");
    /* a send of no known kind nobody answered: Emailed and its first words */
    const alone = customerFeed([fixture3372()[1]!], { customer: "Marco", money: true });
    expect(alone[0]).toMatchObject({ kind: "send", words: "Emailed", seen: "Seen 9:56 am" });
    expect((alone[0] as CustomerSend).opening).toMatch(/^I hope you've been well/);
  });
});

describe("a conversation is a thread", () => {
  /* the walk of 26 October 2026: Piero's 10:03 reply opened a thread whose first half was missing */
  it("starts with the template the customer answered, as the team's first bubble with its Seen", () => {
    const t = threads().find((x) => x.day === "2026-10-06")!;
    expect(t.lines[0]).toMatchObject({ kind: "bubble", side: "us", name: "Dana", time: "9:31 am", seen: "Seen 9:56 am" });
    expect((t.lines[0] as ThreadBubble).words).toMatch(/^Hi Marco!\nI hope you've been well/);
    /* nobody answered the quote of 29 September: it stays a row */
    expect(sends().some((s) => s.day === "2026-09-29" && s.words === "Quote emailed")).toBe(true);
    /* nor an answer another day under another subject */
    const later = customerFeed(
      [fixture3372()[1]!, { ...fixture3372()[2]!, stamp: "2026-10-08 10:00:00", subject: "Something else" }],
      { customer: "Marco", money: true },
    );
    expect(later.map((i) => i.kind)).toEqual(["send", "thread"]);
  });

  it("is the day's own messages, oldest first inside, standing in the feed by its latest moment", () => {
    const t = threads().find((x) => x.day === "2026-10-06")!;
    expect(t.title).toBe("Email with Marco");
    expect(t.subject).toBe("Your Quote from Acme Air (Ref #3372)");
    expect(t.lines.map((l) => (l.kind === "bubble" ? `${l.side}:${l.time}` : `line:${l.words}`))).toEqual([
      "us:9:31 am",
      "them:10:03 am",
      "line:Booking for 2:00 pm texted",
      "them:11:06 am",
      "us:11:51 am",
      "line:On the way texted, about 32 minutes",
    ]);
    /* the latest moment is the arrival text, so it stands there */
    expect(t.at).toBe("2026-10-06 13:32:18");
    /* and the feed comes oldest first, for the days to turn newest first */
    const items = feed();
    expect(items.map((i) => i.at)).toEqual([...items.map((i) => i.at)].sort());
  });

  it("says Text, or Email and text, as its messages were", () => {
    expect(threads().find((x) => x.day === "2026-10-20")!.title).toBe("Text with Marco");
    const mixed = customerFeed(
      [
        { ...fixture3372()[2]! },
        { ...fixture3372()[2]!, id: "x", kind: "sms", stamp: "2026-10-06 12:00:00", text: "Running five minutes late" },
      ],
      { customer: "Marco", money: true },
    );
    expect((mixed[0] as CustomerThread).title).toBe("Email and text with Marco");
  });

  it("says a name only where the speaker changes", () => {
    const run = customerFeed(
      [
        { ...fixture3372()[2]!, id: "a", stamp: "2026-10-06 10:00:00" },
        { ...fixture3372()[2]!, id: "b", stamp: "2026-10-06 10:01:00" },
        { ...fixture3372()[6]!, id: "c", stamp: "2026-10-06 10:02:00" },
      ],
      { customer: "Marco", money: true },
    );
    expect((run[0] as CustomerThread).lines.map((l) => (l as ThreadBubble).name)).toEqual(["Marco", null, "Dana"]);
  });

  /* Isaac, 26 October 2026: filled and grouped like iMessage */
  it("groups back-to-back messages from one speaker into a run: the name above its first, the time on its last", () => {
    const f = fixture3372();
    const run = customerFeed(
      [
        { ...f[2]!, id: "a", stamp: "2026-10-06 10:00:00" },
        { ...f[2]!, id: "b", stamp: "2026-10-06 10:01:00" },
        { ...f[2]!, id: "c", stamp: "2026-10-06 10:02:00" },
        { ...f[6]!, id: "d", stamp: "2026-10-06 10:03:00" },
        { ...f[6]!, id: "e", stamp: "2026-10-06 10:04:00" },
      ],
      { customer: "Marco", money: true },
    );
    const bubbles = (run[0] as CustomerThread).lines as ThreadBubble[];
    expect(bubbles.map((b) => [b.name, b.last])).toEqual([
      ["Marco", false],
      [null, false],
      [null, true],
      ["Dana", false],
      [null, true],
    ]);
  });

  it("ends a run at a ServiceM8 line, and starts the next with its name", () => {
    const t = threads().find((x) => x.day === "2026-10-06")!;
    expect(t.lines.map((l) => (l.kind === "bubble" ? `${l.name ?? "-"}:${l.last}` : "line"))).toEqual([
      "Dana:true",
      "Marco:true",
      "line",
      "Marco:true",
      "Dana:true",
      "line",
    ]);
  });

  it("says Seen only on the team's emails ServiceM8 saw opened", () => {
    const t = threads().find((x) => x.day === "2026-10-06")!;
    const bubbles = t.lines.filter((l): l is ThreadBubble => l.kind === "bubble");
    expect(bubbles.map((b) => b.seen)).toEqual(["Seen 9:56 am", null, null, "Seen 11:56 am"]);
    const text = customerFeed([{ ...fixture3372()[16]!, seenStamp: "2026-10-20 12:00:00" }], { customer: "Marco", money: true });
    expect(((text[0] as CustomerThread).lines[0] as ThreadBubble).seen).toBeNull();
    const theirs = customerFeed([{ ...fixture3372()[2]!, seenStamp: "2026-10-06 12:00:00" }], { customer: "Marco", money: true });
    expect(((theirs[0] as CustomerThread).lines[0] as ThreadBubble).seen).toBeNull();
  });

  it("strips Re: and Fwd: off the subject", () => {
    expect(bareSubject("Re: RE: Fwd: Your Quote")).toBe("Your Quote");
    expect(bareSubject("  ")).toBeNull();
  });
});

describe("the feed's own rows", () => {
  const milestone = (label: "Quote sent" | "Invoice raised", day: string): StoryEntry => ({ kind: "milestone", key: `m:${label}`, day, at: null, label });

  it("says a quote sent once, where ServiceM8's send already says it", () => {
    const story = [milestone("Quote sent", "2026-09-29"), milestone("Invoice raised", "2026-10-20"), milestone("Quote sent", "2026-08-01")];
    expect(withoutEchoes(story, feed()).map((e) => e.day)).toEqual(["2026-08-01"]);
  });
});

describe("the words", () => {
  /* the walk of 26 October 2026: ServiceM8's text part read "Luke Ingold61457301636" */
  it("keeps a signature's lines apart, as its HTML has them", () => {
    expect(
      htmlToText(
        'Regards,</span><br /><br /><font size="2">Luke Ingold</font><div><font size="2"><span>61457301636</span><br /><span>Operations Manager</span></font></div><img src="x">',
      ),
    ).toBe("Regards,\n\nLuke Ingold\n61457301636\nOperations Manager");
  });

  it("reads the source's own line breaks as spaces, entities as their characters, and three breaks as two", () => {
    expect(htmlToText("<p>I hope you&rsquo;ve been\r\nwell.</p>\r\n\r\n<p><br />\r\n<br />\r\nAll the best,<br />\r\nAcme&nbsp;Air &#8211; &#x2713;</p>")).toBe(
      "I hope you’ve been well.\n\nAll the best,\nAcme Air – ✓",
    );
  });

  it("cuts a reply's quote of what came before it, as a mail program heads it", () => {
    const reply = htmlToText(
      '<div>Thanks, Dana, just got the text.</div><div><br /></div><div>Marco</div><hr /><div><b>From:</b> Marco Rossi <br /><b>Sent:</b> Tuesday, 6 October 2026 10:03<br /><b>Subject:</b> Re: Your Quote</div><div><p>Hi Dana,</p></div>',
    );
    expect(withoutQuoted(reply)).toBe("Thanks, Dana, just got the text.\n\nMarco");
    expect(withoutQuoted("Sounds good\n\nOn Tue, 6 Oct 2026 at 9:31 am, Dana Lee <dana@example.com> wrote:\n> Hi Marco")).toBe("Sounds good");
    expect(withoutQuoted("From: the shop floor, all good")).toBe("From: the shop floor, all good");
  });

  it("reads an email's HTML as text only, never as HTML", () => {
    expect(htmlToText('<p>Hi&nbsp;Marco,</p><p>See <b>below</b><br>Thanks &amp; regards</p><script>alert(1)</script><img src="x" onerror="y">')).toBe(
      "Hi Marco,\n\nSee below\nThanks & regards",
    );
  });

  it("matches a contact's number however it is written", () => {
    expect(phoneKey("+61410585813")).toBe("0410585813");
    expect(phoneKey("0410 585 813")).toBe("0410585813");
    expect(phoneKey(null)).toBeNull();
  });
});

describe("an invoice said once (the walk of 26 October 2026)", () => {
  const claim = (over: Partial<Extract<StoryEntry, { kind: "claim" }>> = {}): StoryEntry => ({
    kind: "claim",
    key: "claim:c2:raised",
    day: "2026-10-20",
    at: null,
    event: "raised",
    remoteId: "c2",
    title: "Payment 2, Final",
    jobNumber: "3372",
    amountCents: 1320000,
    isFinal: true,
    ...over,
  });
  const invoice = () => sends().find((s) => s.sort === "invoice")!;

  it("is the send's row when the claim raised that day is worth the same", () => {
    const story = [claim()];
    expect(pairClaims(story, feed()).get(invoice().key)?.remoteId).toBe("c2");
    expect(withoutEchoes(story, feed())).toEqual([]);
  });

  it("matches by the claim's number where the send says no amount, or another", () => {
    const f = fixture3372();
    const emailOnly = customerFeed([f[14]!], { customer: "Marco", money: true });
    expect((emailOnly[0] as CustomerSend).amountCents).toBeNull();
    expect((emailOnly[0] as CustomerSend).refs).toContain("3372");
    expect(pairClaims([claim()], emailOnly).size).toBe(1);
    expect(pairClaims([claim({ amountCents: 900000 })], feed()).size).toBe(1);
  });

  it("leaves both where neither the amount nor the number agrees, or the day differs", () => {
    expect(pairClaims([claim({ amountCents: 900000, jobNumber: "3372A" })], feed()).size).toBe(0);
    expect(pairClaims([claim({ day: "2026-10-21" })], feed()).size).toBe(0);
    const story = [claim({ amountCents: 900000, jobNumber: "3372A" })];
    expect(withoutEchoes(story, feed())).toEqual(story);
  });
});

describe("Comms (Isaac, 26 October 2026)", () => {
  const threads = () => commsThreads(fixture3372(), { customer: "Marco", today: "2026-10-22" });

  it("is every message, oldest first, a thread a run of one channel and one subject", () => {
    const t = threads();
    const bubbles = t.flatMap((x) => x.lines.filter((l): l is ThreadBubble => l.kind === "bubble"));
    expect(bubbles).toHaveLength(17);
    expect(t.map((x) => `${x.channel}:${x.subject ?? ""}`).slice(0, 4)).toEqual([
      "email:Request for Air Conditioning Quote – 1 Example Street",
      "email:Your Quote from Acme Air (Ref #3372)",
      "sms:",
      "email:Your Quote from Acme Air (Ref #3372)",
    ]);
  });

  it("says the day once where it changes, across threads", () => {
    const labels = threads().flatMap((x) => x.lines.filter((l) => l.kind === "day").map((l) => (l as { label: string }).label));
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toContain("Tue 6 Oct");
  });

  it("makes a run of one person in one thread on one day, each message keeping its own files", () => {
    const f = fixture3372();
    const file = (id: string) => ({ id, name: `${id}.pdf`, type: ".pdf" });
    const t = commsThreads(
      [
        { ...f[16]!, id: "a", stamp: "2026-10-20 11:00:00", files: [file("one")] },
        { ...f[16]!, id: "b", stamp: "2026-10-20 11:01:00", files: [file("two"), file("three")] },
        { ...f[16]!, id: "c", stamp: "2026-10-21 09:00:00" },
      ],
      { customer: "Marco", today: null },
    );
    expect(t).toHaveLength(1);
    expect(t[0]!.lines.map((l) => (l.kind === "day" ? "day" : `${l.name ?? "-"}:${l.last}:${l.files.length}`))).toEqual([
      "day",
      "Dana:false:1",
      "-:true:2",
      "day",
      "Dana:true:0",
    ]);
  });

  it("knows ServiceM8's quotes and invoices, which a reader without money doesn't get", () => {
    const f = fixture3372();
    expect(f.filter(isMoneySend).map((m) => m.stamp)).toEqual(["2026-09-29 08:31:06", "2026-10-12 16:19:53", "2026-10-20 11:49:46", "2026-10-20 11:53:01"]);
  });
});

describe("links and files (the walk of 26 October 2026)", () => {
  it("makes an http or https address a link, its full stop left outside", () => {
    expect(linkParts("View it at https://sm8.link/fa2w. Thanks")).toEqual([
      { text: "View it at " },
      { text: "https://sm8.link/fa2w", href: "https://sm8.link/fa2w" },
      { text: ". Thanks" },
    ]);
    expect(linkParts("(see http://example.com/a_(b))")).toEqual([
      { text: "(see " },
      { text: "http://example.com/a_(b)", href: "http://example.com/a_(b)" },
      { text: ")" },
    ]);
  });

  it("leaves javascript: and mailto: as words", () => {
    expect(linkParts("javascript:alert(1) or mailto:marco@example.com")).toEqual([{ text: "javascript:alert(1) or mailto:marco@example.com" }]);
  });

  it("names a file's type in capitals", () => {
    expect(fileTypeWord(".pdf")).toBe("PDF");
    expect(fileTypeWord(null)).toBeNull();
  });
});
