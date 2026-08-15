import { mirrorClaimLabel, planMirrorClaims } from "@/lib/workboard/claim-rules";
import type { ClaimJobLink, ClaimMirrorJob, ExistingMirrorClaim } from "@/lib/workboard/claim-rules";

const TODAY = "2026-08-12";
const P1 = "proj-1";
const P2 = "proj-2";

const link = (
  projectId: string,
  remoteId: string,
  jobNumber: string | null = "1234"
): ClaimJobLink => ({
  projectId,
  remoteId,
  jobNumber,
});

const job = (over: Partial<ClaimMirrorJob> & { remoteId: string }): ClaimMirrorJob => ({
  jobNumber: "1234",
  active: 1,
  status: "Completed",
  paidCents: 0,
  lastPaidOn: null,
  totalInvoiceAmount: null,
  invoiceSent: null,
  invoiceDate: null,
  paymentReceived: null,
  paymentReceivedStamp: null,
  ...over,
});

const invoiced = (remoteId: string, over: Partial<ClaimMirrorJob> = {}) =>
  job({
    remoteId,
    totalInvoiceAmount: "3960.0000",
    invoiceSent: 1,
    invoiceDate: "2026-07-30 00:00:00",
    ...over,
  });

const existing = (id: string, projectId: string, remoteRef: string): ExistingMirrorClaim => ({
  id,
  projectId,
  remoteRef,
});

const plan = (over: {
  links?: ClaimJobLink[];
  jobs?: ClaimMirrorJob[];
  existing?: ExistingMirrorClaim[];
}) =>
  planMirrorClaims({
    links: over.links ?? [],
    jobs: over.jobs ?? [],
    existing: over.existing ?? [],
    today: TODAY,
  });

describe("an invoice becomes a claim", () => {
  it("raises one, named after the job it came from", () => {
    const { upserts, deleteIds } = plan({
      links: [link(P1, "j-1", "2198")],
      jobs: [invoiced("j-1", { jobNumber: "2198" })],
    });
    expect(deleteIds).toEqual([]);
    expect(upserts).toEqual([
      {
        projectId: P1,
        remoteRef: "j-1",
        label: "Invoice — job #2198",
        amountCents: 396000,
        claimedOn: "2026-07-30",
        status: "awaiting",
        paidOn: null,
      },
    ]);
  });

  /* Settled from the PAYMENT ROWS, never the flag: `payment_received` is set
     on 45 jobs while 1,819 carry actual payments. */
  it("settles a claim when the payments cover it, and stamps the last one", () => {
    const { upserts } = plan({
      links: [link(P1, "j-1")],
      jobs: [invoiced("j-1", { paidCents: 396000, lastPaidOn: "2026-08-06" })],
    });
    expect(upserts[0]).toMatchObject({ status: "paid", paidOn: "2026-08-06" });
  });

  /* A PART payment leaves the claim awaiting: project_claims is binary, and
     the honest read of "some of it came in" is that this one isn't collected
     — otherwise the money card's paid strip calls a half-paid claim settled. */
  it("leaves a part-paid claim awaiting", () => {
    const { upserts } = plan({
      links: [link(P1, "j-1")],
      jobs: [invoiced("j-1", { paidCents: 100000, lastPaidOn: "2026-08-06" })],
    });
    expect(upserts[0]).toMatchObject({ status: "awaiting", paidOn: null });
  });

  it("counts a paid job even when no invoice flag ever arrived", () => {
    const { upserts } = plan({
      links: [link(P1, "j-1")],
      jobs: [
        job({
          remoteId: "j-1",
          status: "Work Order",
          totalInvoiceAmount: "1200.00",
          invoiceSent: null,
          paidCents: 120000,
          lastPaidOn: "2026-08-06",
        }),
      ],
    });
    expect(upserts[0]).toMatchObject({
      status: "paid",
      // No invoice date to use, so the day the money moved is the claim's day.
      claimedOn: "2026-08-06",
    });
  });

  it("falls back to today only when ServiceM8 dates nothing", () => {
    const { upserts } = plan({
      links: [link(P1, "j-1")],
      jobs: [job({ remoteId: "j-1", totalInvoiceAmount: "500.00", invoiceSent: 1 })],
    });
    expect(upserts[0].claimedOn).toBe(TODAY);
  });

  it("labels a job with no number without pretending it has one", () => {
    expect(mirrorClaimLabel(null)).toBe("Invoice from ServiceM8");
    const { upserts } = plan({
      links: [link(P1, "j-1", null)],
      jobs: [invoiced("j-1", { jobNumber: null })],
    });
    expect(upserts[0].label).toBe("Invoice from ServiceM8");
  });
});

describe("what does NOT earn a claim", () => {
  /* Work still in progress with nothing paid against it. Waiting for the
     invoice flag meant waiting forever — it never arrives — so the trigger is
     the job being FINISHED or money having come in. An open work order is
     neither. */
  it("an unfinished job nobody has paid anything on", () => {
    const { upserts } = plan({
      links: [link(P1, "j-1")],
      jobs: [job({ remoteId: "j-1", status: "Work Order", totalInvoiceAmount: "3960.00" })],
    });
    expect(upserts).toEqual([]);
  });

  /* …but a deposit on that same open job DOES claim: money has moved, and a
     project whose deposit is invisible understates what's been claimed. */
  it("unless a deposit has landed against it", () => {
    const { upserts } = plan({
      links: [link(P1, "j-1")],
      jobs: [
        job({
          remoteId: "j-1",
          status: "Work Order",
          totalInvoiceAmount: "3960.00",
          paidCents: 50000,
          lastPaidOn: "2026-08-02",
        }),
      ],
    });
    expect(upserts[0]).toMatchObject({ amountCents: 396000, status: "awaiting" });
  });

  /* A $0 claim row reads "claimed nothing", which is a different statement
     from "nothing claimed yet" — and the second one is true. */
  it("an invoiced job with no readable amount", () => {
    const { upserts } = plan({
      links: [link(P1, "j-1")],
      jobs: [invoiced("j-1", { totalInvoiceAmount: "0.0000" })],
    });
    expect(upserts).toEqual([]);
  });

  it("a job ServiceM8 has deleted", () => {
    const { upserts } = plan({
      links: [link(P1, "j-1")],
      jobs: [invoiced("j-1", { active: 0 })],
    });
    expect(upserts).toEqual([]);
  });
});

describe("clearing itself", () => {
  /* Reopened over there and nothing paid: the work isn't finished after all,
     so the claim it earned goes with it. */
  it("drops the claim when a finished job is reopened", () => {
    const { upserts, deleteIds } = plan({
      links: [link(P1, "j-1")],
      jobs: [job({ remoteId: "j-1", status: "Work Order", totalInvoiceAmount: "3960.00" })],
      existing: [existing("c-1", P1, "j-1")],
    });
    expect(upserts).toEqual([]);
    expect(deleteIds).toEqual(["c-1"]);
  });

  /* But not if money has already changed hands on it — a payment is a fact
     about the customer, and reopening the job doesn't unspend it. */
  it("keeps it when the reopened job has been paid against", () => {
    const { upserts, deleteIds } = plan({
      links: [link(P1, "j-1")],
      jobs: [
        job({
          remoteId: "j-1",
          status: "Work Order",
          totalInvoiceAmount: "3960.00",
          paidCents: 396000,
          lastPaidOn: "2026-08-06",
        }),
      ],
      existing: [existing("c-1", P1, "j-1")],
    });
    expect(deleteIds).toEqual([]);
    expect(upserts[0]).toMatchObject({ status: "paid" });
  });

  it("drops the claim when the job is unlinked from the project", () => {
    const { deleteIds } = plan({
      links: [],
      jobs: [],
      existing: [existing("c-1", P1, "j-1")],
    });
    expect(deleteIds).toEqual(["c-1"]);
  });

  it("drops the claim when ServiceM8 deletes the job", () => {
    const { deleteIds } = plan({
      links: [link(P1, "j-1")],
      jobs: [invoiced("j-1", { active: 0 })],
      existing: [existing("c-1", P1, "j-1")],
    });
    expect(deleteIds).toEqual(["c-1"]);
  });

  /* THE ONE THAT MATTERS. A job missing from the mirror means the cache is
     warming — a fresh backfill, a wipe mid-sync, a disconnect. Reading absence
     as "no longer invoiced" would delete a project's whole payment history at
     the worst possible moment. */
  it("keeps every claim when the mirror simply has no rows yet", () => {
    const { upserts, deleteIds } = plan({
      links: [link(P1, "j-1"), link(P1, "j-2")],
      jobs: [],
      existing: [existing("c-1", P1, "j-1"), existing("c-2", P1, "j-2")],
    });
    expect(upserts).toEqual([]);
    expect(deleteIds).toEqual([]);
  });

  it("judges each job on its own when only some are readable", () => {
    const { upserts, deleteIds } = plan({
      links: [link(P1, "j-1"), link(P1, "j-2")],
      // j-2 is absent from the mirror; j-1 is present and no longer invoiced.
      jobs: [job({ remoteId: "j-1", invoiceSent: 0 })],
      existing: [existing("c-1", P1, "j-1"), existing("c-2", P1, "j-2")],
    });
    expect(upserts).toEqual([]);
    expect(deleteIds).toEqual(["c-1"]);
  });
});

describe("re-running and sharing", () => {
  it("is idempotent — the same facts plan the same single row", () => {
    const facts = {
      links: [link(P1, "j-1")],
      jobs: [invoiced("j-1")],
      existing: [existing("c-1", P1, "j-1")],
    };
    const a = plan(facts);
    const b = plan(facts);
    expect(a).toEqual(b);
    expect(a.upserts).toHaveLength(1);
    expect(a.deleteIds).toEqual([]);
  });

  it("rewrites the amount when ServiceM8's invoice changes", () => {
    const { upserts } = plan({
      links: [link(P1, "j-1")],
      jobs: [invoiced("j-1", { totalInvoiceAmount: "4500.0000" })],
      existing: [existing("c-1", P1, "j-1")],
    });
    expect(upserts[0].amountCents).toBe(450000);
  });

  /* project_jobs lets one job sit on two projects and the UI warns rather than
     refuses. Each project's money must then be honest on its own terms — and
     nothing rolls the two up, so nothing double-counts. */
  it("mirrors one job onto each project that links it", () => {
    const { upserts } = plan({
      links: [link(P1, "j-1"), link(P2, "j-1")],
      jobs: [invoiced("j-1")],
    });
    expect(upserts.map((u) => u.projectId).sort()).toEqual([P1, P2]);
    expect(new Set(upserts.map((u) => u.remoteRef))).toEqual(new Set(["j-1"]));
  });

  it("leaves one project's claim alone when the other unlinks the job", () => {
    const { upserts, deleteIds } = plan({
      links: [link(P1, "j-1")],
      jobs: [invoiced("j-1")],
      existing: [existing("c-1", P1, "j-1"), existing("c-2", P2, "j-1")],
    });
    expect(upserts.map((u) => u.projectId)).toEqual([P1]);
    expect(deleteIds).toEqual(["c-2"]);
  });
});
