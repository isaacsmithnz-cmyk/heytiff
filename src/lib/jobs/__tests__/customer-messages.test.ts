import {
  bareSubject,
  bookingWhen,
  customerFeed,
  htmlToText,
  openingPattern,
  phoneKey,
  templateMarked,
  withoutEchoes,
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
    expect(invoice[0]).toMatchObject({ words: "Invoice sent, $13,200", detail: "by email and text", seen: "Seen 12:58 pm", attachments: 1 });
    expect(sends(feed(false)).find((s) => s.sort === "invoice")!.words).toBe("Invoice sent");
  });

  it("says an arrival with who and how long, and a quote with its paper and when it was seen", () => {
    expect(sends().find((s) => s.day === "2026-10-16")).toMatchObject({ words: "On the way texted", detail: "Sam, about 23 minutes", icon: "car" });
    expect(sends().find((s) => s.day === "2026-09-29")).toMatchObject({ words: "Quote emailed", attachments: 1, seen: "Seen 9:45 am" });
    /* seen another day says the day */
    expect(sends().find((s) => s.day === "2026-10-12")!.seen).toBe("Seen Tue 13 Oct, 6:46 pm");
    /* a send of no known kind: Emailed and its first words */
    const follow = sends().find((s) => s.day === "2026-10-06" && s.sort === "other")!;
    expect(follow.words).toBe("Emailed");
    expect(follow.opening).toMatch(/^I hope you've been well/);
  });
});

describe("a conversation is a thread", () => {
  it("is the day's own messages, oldest first inside, standing in the feed by its latest moment", () => {
    const t = threads().find((x) => x.day === "2026-10-06")!;
    expect(t.title).toBe("Email with Marco");
    expect(t.subject).toBe("Your Quote from Acme Air (Ref #3372)");
    expect(t.lines.map((l) => (l.kind === "bubble" ? `${l.side}:${l.time}` : `line:${l.words}`))).toEqual([
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

  it("says Seen only on the team's emails ServiceM8 saw opened", () => {
    const t = threads().find((x) => x.day === "2026-10-06")!;
    const bubbles = t.lines.filter((l): l is ThreadBubble => l.kind === "bubble");
    expect(bubbles.map((b) => b.seen)).toEqual([null, null, "Seen 11:56 am"]);
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
  it("reads an email's HTML as text only, never as HTML", () => {
    expect(htmlToText('<p>Hi&nbsp;Marco,</p><p>See <b>below</b><br>Thanks &amp; regards</p><script>alert(1)</script><img src="x" onerror="y">')).toBe(
      "Hi Marco,\nSee below\nThanks & regards",
    );
  });

  it("matches a contact's number however it is written", () => {
    expect(phoneKey("+61410585813")).toBe("0410585813");
    expect(phoneKey("0410 585 813")).toBe("0410585813");
    expect(phoneKey(null)).toBeNull();
  });
});
