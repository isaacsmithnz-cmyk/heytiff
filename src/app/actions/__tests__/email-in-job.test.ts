/** @jest-environment node */
/* Create job from an email: a builder's job goes on the builder, its address
   on the job, never on a new site named by its address (3533 on JT
   Construct; Isaac, 17 November 2026: "I think Tiff just made the job
   wrong"). */
const createNewJob = jest.fn();
const matchedNow = jest.fn();
jest.mock("@/lib/permissions-server", () => ({ requireOrg: async () => ({ orgId: "org-1", userId: "u-1" }) }));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: async () => null }));
jest.mock("@/lib/email/made-server", () => ({
  emailJobView: jest.fn(),
  markFiled: jest.fn(),
  markNotAJob: jest.fn(),
  markMade: jest.fn(async () => undefined),
  readEmailRow: async () => ({ id: "e-1", state: "read", job_uuid: null, proposal: {}, from_name: "Jo", received_at: "2026-11-15T01:00:00Z" }),
}));
jest.mock("@/lib/email/proposal-server", () => ({ matchedNow: (...a: unknown[]) => matchedNow(...a) }));
jest.mock("../job-new", () => ({ createNewJob: (...a: unknown[]) => createNewJob(...a) }));

import { createJobFromEmail } from "../email-in-job";

const read = (over: Record<string, unknown> = {}) => ({
  isJob: true,
  aboutJob: false,
  client: "JT Construct",
  clientMatch: { uuid: "jt", name: "JT Construct", builder: true },
  siteMatch: null,
  site: "2 Krui Street, Fairlight",
  contact: { first: "", last: "", mobile: "", phone: "", email: "" },
  summary: "Ducted air conditioning.",
  scope: [],
  excluded: [],
  due: null,
  drawings: [],
  jobNumbers: [],
  notJobWhy: "",
  ...over,
});

beforeEach(() => {
  createNewJob.mockReset().mockResolvedValue({ ok: true, jobUuid: "j-1", line: { state: "in", number: "3533", words: "" } });
});

it("puts a builder's new job on the builder, with the site as the job's address", async () => {
  matchedNow.mockResolvedValue(read());
  expect(await createJobFromEmail("e-1")).toEqual({ ok: true, jobUuid: "j-1", number: "3533" });
  const sent = createNewJob.mock.calls[0][0];
  expect(sent.client).toEqual({ kind: "existing", uuid: "jt" });
  expect(sent.jobAddress).toBe("2 Krui Street, Fairlight");
});

it("still puts it on a site of theirs the email's address matches", async () => {
  matchedNow.mockResolvedValue(read({ siteMatch: { uuid: "pagewood", name: "Pagewood Hotel", address: "1 Hotel St, Pagewood", parentName: "JT Construct" } }));
  await createJobFromEmail("e-1");
  const sent = createNewJob.mock.calls[0][0];
  expect(sent.client).toEqual({ kind: "existing", uuid: "pagewood" });
  expect(sent.jobAddress).toBe("1 Hotel St, Pagewood");
});
