/**
 * @jest-environment node
 */
import { readQuoteTicket, signQuoteTicket } from "../pdf-ticket";
import { signLetterTicket } from "@/lib/letters/pdf-ticket";

/* The quote's PDF ticket (Isaac, 21 October 2026: "We also need to be able
   to turn this into a PDF"): it prints one job's quote, for two minutes, and
   nothing else's ticket prints it. */

beforeAll(() => {
  process.env.AUTH0_SECRET = process.env.AUTH0_SECRET || "a-test-secret-that-is-long-enough-1234567890";
});

it("reads back what it was signed with", () => {
  const t = signQuoteTicket({ orgId: "org-1", jobUuid: "job-1", by: "auth0|u1" });
  expect(readQuoteTicket(t)).toEqual({ orgId: "org-1", jobUuid: "job-1", by: "auth0|u1" });
});

it("is refused once stale, altered, or a letter's", () => {
  const t = signQuoteTicket({ orgId: "org-1", jobUuid: "job-1", by: "u" }, Date.now() - 3 * 60_000);
  expect(readQuoteTicket(t)).toBeNull();
  const good = signQuoteTicket({ orgId: "org-1", jobUuid: "job-1", by: "u" });
  expect(readQuoteTicket(good.replace(/^./, (c) => (c === "a" ? "b" : "a")))).toBeNull();
  expect(readQuoteTicket(signLetterTicket({ orgId: "org-1", letterId: "job-1" }))).toBeNull();
  expect(readQuoteTicket(undefined)).toBeNull();
});
