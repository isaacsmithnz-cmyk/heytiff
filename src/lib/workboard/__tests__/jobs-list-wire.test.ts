import { packRows, unpackRows } from "../jobs-list-wire";
import type { JobsListRow } from "../jobs-list";

/* The Jobs list on the wire (Isaac, 25 October 2026: "trim the row data the
   Jobs page sends"): a row goes as a list, its link only where it isn't the
   job's page, and comes back the same row. */

const job: JobsListRow = {
  key: "sm8:01a11840-8dae-7c94-9d9b-0e57c08f4c3b",
  href: "/dashboard/jobs/01a11840-8dae-7c94-9d9b-0e57c08f4c3b",
  number: "3405",
  numberOurs: false,
  client: "Built Complete",
  site: "Edgecliff",
  kind: "Construction Project",
  hue: "yellow",
  state: "Quote to write",
  tone: "info",
  next: "Raised 8 Oct",
  on: "2026-10-08",
  ahead: false,
  who: ["Luke Ingold"],
  valueCents: null,
  views: ["all", "quotes"],
  words: "3405 built complete edgecliff fw: 48 thorne st - ac quote construction project",
};
/* a visit with no ServiceM8 job: its link is its own */
const visit: JobsListRow = {
  ...job,
  key: "visit:v-1",
  href: "/dashboard/jobs?open=visit.v-1",
  number: "1001",
  numberOurs: true,
  ahead: true,
  valueCents: 85250,
  views: ["all", "to-book", "agreements"],
};

it("brings every row back exactly as it went, every field of it", () => {
  expect(unpackRows(packRows([job, visit]))).toEqual([job, visit]);
});

it("sends a job's link only where it isn't the job's own page", () => {
  const [a, b] = packRows([job, visit]);
  expect(a).not.toContain(job.href);
  expect(b).toContain(visit.href);
});

it("sends a good deal less than the rows as objects", () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({ ...job, key: `sm8:job-${i}`, href: `/dashboard/jobs/job-${i}` }));
  const packed = JSON.stringify(packRows(rows)).length;
  const plain = JSON.stringify(rows).length;
  expect(packed / plain).toBeLessThan(0.7);
});
