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
