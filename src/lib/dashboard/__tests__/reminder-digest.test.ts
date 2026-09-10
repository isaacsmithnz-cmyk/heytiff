import { reminderDigest } from "../reminder-digest";

/* The morning letter. One reminder is addressed as that reminder; several
   are counted; anything a person typed is escaped in the body and left plain
   in the subject; the ones that came due on an earlier day say so. */

const base = { baseUrl: "https://go.hey-tiff.com/", firstName: "Isaac", today: "2026-09-03" };

it("one reminder: the subject is the reminder, and the body greets by name", () => {
  const { subject, html } = reminderDigest({
    ...base,
    items: [
      {
        title: "Renew rego — WORK TRITON (YLI59V)",
        detail: "Expires 29 Sep 2027 · 30 days' notice",
        day: "2026-09-03",
        overdue: false,
      },
    ],
  });
  expect(subject).toBe("Reminder: Renew rego — WORK TRITON (YLI59V)");
  expect(html).toContain("Hi Isaac —");
  expect(html).toContain("Renew rego — WORK TRITON (YLI59V)");
  expect(html).toMatch(/Expires 29 Sep 2027 · 30 days(?:&#39;|&apos;|')? notice/);
  expect(html).toContain("https://go.hey-tiff.com/dashboard");
  expect(html).not.toContain("came due earlier");
});

it("several: counts them, marks the one that came due earlier, escapes what people typed", () => {
  const { subject, html } = reminderDigest({
    ...base,
    firstName: null,
    items: [
      { title: "Call Smith & Sons", detail: null, day: "2026-09-01", overdue: true },
      {
        title: "Renew insurance — ZUCKY (EVD72G)",
        detail: "Expires 23 Sep 2026 · 14 days' notice",
        day: "2026-09-03",
        overdue: false,
      },
    ],
  });
  expect(subject).toMatch(/^2 reminders for /);
  expect(html).toContain("Smith &amp; Sons");
  expect(html).not.toContain("Smith & Sons");
  expect(html).toContain("One of them came due earlier");
  expect(html).toContain("(from ");
  // no name, no half a greeting
  expect(html).not.toContain("Hi  —");
});

/* THE EXPIRING LIST (issue #640, piece 4). The bell's own expiry chips, in
   the same letter. Expiries alone is its own letter; reminders and expiries
   together lead with the reminders — the things a person asked for — and
   file the expiries under their own line. */
const expiring = [
  { label: "ARC refrigerant trading authorisation expired 3 days ago", subject: "Business licence", state: "bad" as const, href: "/dashboard/admin/organization" },
  { label: "Rego expires in 5 days", subject: "WORK TRITON (YLI59V)", state: "warn" as const, href: "/dashboard/assets" },
];

it("expiries only: says what is inside the window, worst first", () => {
  const { subject, html } = reminderDigest({ ...base, items: [], expiring });
  expect(subject).toMatch(/^2 things expiring — /);
  expect(html).toContain("2 things are expiring");
  expect(html).toContain("inside your expiry window");
  expect(html.indexOf("expired 3 days ago")).toBeLessThan(html.indexOf("Rego expires in 5 days"));
  expect(html).toContain("WORK TRITON (YLI59V)");
  expect(html).toContain("Organisation → Your business");
  expect(html).not.toContain("came due earlier");
  expect(html).not.toContain("once per reminder");
});

it("one expiry: the subject is the expiry itself", () => {
  const { subject } = reminderDigest({ ...base, items: [], expiring: [expiring[1]] });
  expect(subject).toBe("Expiring: Rego expires in 5 days");
});

it("both: leads with the reminders, files the expiries under their own line, counts both in the subject", () => {
  const { subject, html } = reminderDigest({
    ...base,
    items: [{ title: "Call Smith & Sons", detail: null, day: "2026-09-03", overdue: false }],
    expiring,
  });
  expect(subject).toMatch(/^1 reminder and 2 expiries for /);
  expect(html).toContain("3 things for today");
  expect(html.indexOf("Smith &amp; Sons")).toBeLessThan(html.indexOf("<b>Expiring</b>"));
  expect(html.indexOf("<b>Expiring</b>")).toBeLessThan(html.indexOf("expired 3 days ago"));
  // both footnotes, because both kinds of thing are in the letter
  expect(html).toContain("once per reminder");
  expect(html).toContain("Organisation → Your business");
});

it("an empty expiring list changes nothing about a reminders letter", () => {
  const a = reminderDigest({ ...base, items: [{ title: "T", detail: null, day: "2026-09-03", overdue: false }] });
  const b = reminderDigest({ ...base, items: [{ title: "T", detail: null, day: "2026-09-03", overdue: false }], expiring: [] });
  expect(b).toEqual(a);
});
