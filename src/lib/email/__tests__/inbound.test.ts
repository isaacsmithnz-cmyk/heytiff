/* Email to Tiff, the address and the door (28 October 2026): a long random
   address, which business a forwarded email is for, and only a post Resend
   signed, sent just now. */
import { createHmac } from "node:crypto";
import { addressOf, emailInAddress, keptAttachments, nameOf, newEmailToken, senderVouchedFor, signedByResend, textOfEmail, tokenFromRecipients } from "../inbound";

it("makes an address no one could guess or misread", () => {
  const a = newEmailToken();
  const b = newEmailToken();
  expect(a).toMatch(/^[a-hjkmnp-z2-9]{10}$/);
  expect(a).not.toBe(b);
  expect(emailInAddress("k7m2q9xwab", "in.hey-tiff.com")).toBe("tiff-k7m2q9xwab@in.hey-tiff.com");
});

it("finds the business an email was sent to, among its recipients, at our domain only", () => {
  expect(tokenFromRecipients(["isaac@diamondair.com.au", "Tiff <TIFF-K7M2Q9XWAB@in.hey-tiff.com>"], "in.hey-tiff.com")).toBe("k7m2q9xwab");
  expect(tokenFromRecipients(["tiff-k7m2q9xwab@elsewhere.com"], "in.hey-tiff.com")).toBeNull();
  expect(tokenFromRecipients(["jobs@in.hey-tiff.com", null], "in.hey-tiff.com")).toBeNull();
});

it("reads a sender's address and name", () => {
  expect(addressOf("Matt Glass <Matt@Truecut.com.au>")).toBe("matt@truecut.com.au");
  expect(addressOf("isaac@diamondair.com.au")).toBe("isaac@diamondair.com.au");
  expect(nameOf('"Matt Glass" <matt@truecut.com.au>')).toBe("Matt Glass");
  expect(nameOf("matt@truecut.com.au")).toBeNull();
});

describe("a post Resend signed", () => {
  const key = Buffer.from("a-test-signing-key-of-some-length");
  const secret = `whsec_${key.toString("base64")}`;
  const body = JSON.stringify({ type: "email.received", data: { email_id: "e1" } });
  const sign = (id: string, ts: number, b: string, k = key) => `v1,${createHmac("sha256", k).update(`${id}.${ts}.${b}`).digest("base64")}`;
  const now = 1_793_000_000;

  it("is taken: our secret, this body, just now, among the signatures the header carries", () => {
    expect(signedByResend(body, { id: "msg_1", timestamp: String(now), signature: sign("msg_1", now, body) }, secret, now)).toBe(true);
    expect(signedByResend(body, { id: "msg_1", timestamp: String(now), signature: `v1,bm90IGl0 ${sign("msg_1", now, body)}` }, secret, now + 60)).toBe(true);
  });

  it("is refused: another secret, a changed body, an old post, or no headers", () => {
    expect(signedByResend(body, { id: "msg_1", timestamp: String(now), signature: sign("msg_1", now, body, Buffer.from("another")) }, secret, now)).toBe(false);
    expect(signedByResend(body + " ", { id: "msg_1", timestamp: String(now), signature: sign("msg_1", now, body) }, secret, now)).toBe(false);
    expect(signedByResend(body, { id: "msg_1", timestamp: String(now), signature: sign("msg_1", now, body) }, secret, now + 600)).toBe(false);
    expect(signedByResend(body, { id: null, timestamp: String(now), signature: sign("msg_1", now, body) }, secret, now)).toBe(false);
  });
});

it("takes a sender only when their own mail server vouched for them", () => {
  expect(senderVouchedFor({ spf: "pass", dkim: "pass", dmarc: "pass" })).toBe(true);
  expect(senderVouchedFor({ spf: "fail", dkim: "pass", dmarc: "gray" })).toBe(true);
  expect(senderVouchedFor({ spf: "pass", dkim: "fail", dmarc: "fail" })).toBe(false);
  expect(senderVouchedFor({ spf: "gray", dkim: "gray", dmarc: "gray" })).toBe(false);
  expect(senderVouchedFor(null)).toBe(false);
});

it("keeps an email's words, from its text or else its HTML", () => {
  expect(textOfEmail("  Hi,\n\nPlease quote.  ", "<p>ignored</p>")).toBe("Hi,\n\nPlease quote.");
  expect(textOfEmail(null, "<style>p{}</style><p>Hi,</p><p>Modify existing underfloor AC &amp; extend to attic.<br>Thanks</p><ul><li>One</li></ul>")).toBe(
    "Hi,\nModify existing underfloor AC & extend to attic.\nThanks\n• One"
  );
  expect(textOfEmail("x".repeat(70_000), null)).toMatch(/too long to keep\.\]$/);
});

it("keeps the PDFs and pictures a job's Documents take, never a signature's logo, and names the rest", () => {
  const allowed = { "application/pdf": "pdf", "image/png": "png" };
  const { kept, skipped } = keptAttachments(
    [
      { filename: "A-101 Architectural.pdf", content_type: "application/pdf", size: 16_000_000, content_disposition: "attachment" },
      { filename: "logo.png", content_type: "image/png", size: 4_000, content_disposition: "inline" },
      { filename: "Schedule.xlsx", content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 20_000 },
      { filename: "Huge.pdf", content_type: "application/pdf", size: 60_000_000 },
    ],
    allowed,
    50 * 1024 * 1024
  );
  expect(kept.map((k) => [k.filename, k.ext])).toEqual([["A-101 Architectural.pdf", "pdf"]]);
  expect(skipped).toEqual(["Schedule.xlsx", "Huge.pdf"]);
});
