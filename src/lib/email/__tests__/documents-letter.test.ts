/* The letter documents leave a job in, and the name it is sent from.

   What this pins is the edge: everything in the letter was typed by somebody
   — the message, the business's name, the file names — so it is escaped here,
   and the name in front of the verified address can't close its quotes or
   open a second address. */

import { documentsLetter } from "../documents-letter";
import { fromFor } from "../send";

const letter = (over: Partial<Parameters<typeof documentsLetter>[0]> = {}) =>
  documentsLetter({
    baseUrl: "https://go.hey-tiff.com/",
    business: "Smith & Sons Air",
    sender: "Isaac Smith",
    message: "Hi Jane,\n\nPlease find our documents attached.\nThe ARC one is new.",
    files: ["Public liability.pdf", "ARC licence, Dane Whitmore.jpg"],
    ...over,
  });

describe("the documents letter", () => {
  it("carries the person's words as paragraphs, then the files, then who a reply reaches", () => {
    const html = letter();
    expect(html).toContain("Documents from Smith &amp; Sons Air");
    expect(html).toContain("Hi Jane,");
    expect(html).toContain("Please find our documents attached.<br />The ARC one is new.");
    expect(html).toContain("Public liability.pdf<br />ARC licence, Dane Whitmore.jpg");
    expect(html).toContain("Reply to this email to reach Isaac Smith.");
  });

  it("escapes everything that was typed", () => {
    const html = letter({
      business: "<b>Evil</b>",
      sender: "<script>x</script>",
      message: "<img src=x onerror=alert(1)>",
      files: ['"><svg onload=1>.pdf'],
    });
    expect(html).not.toMatch(/<img src=x/);
    expect(html).not.toMatch(/<script>x/);
    expect(html).not.toMatch(/<svg onload/);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("stands up without a business or a sender", () => {
    const html = letter({ business: null, sender: null });
    expect(html).toContain("Your documents");
    expect(html).toContain("Reply to this email to reach the person who sent it.");
  });
});

describe("who it is from", () => {
  const configured = "HeyTiff <no-reply@mail.hey-tiff.com>";

  it("puts the business's name in front of the verified address", () => {
    expect(fromFor("Smith & Sons Air via HeyTiff", configured)).toBe(
      '"Smith & Sons Air via HeyTiff" <no-reply@mail.hey-tiff.com>'
    );
  });

  it("keeps the configured sender when there is no name", () => {
    expect(fromFor(undefined, configured)).toBe(configured);
    expect(fromFor("   ", configured)).toBe(configured);
  });

  it("can't be made to close its quotes or name a second address", () => {
    const from = fromFor('Evil" <attacker@evil.com>\r\nBcc: x@y.z', configured);
    expect(from).toBe('"Evil attacker@evil.com Bcc: x@y.z" <no-reply@mail.hey-tiff.com>');
    expect(from.match(/</g)).toHaveLength(1);
  });

  it("reads a bare configured address too", () => {
    expect(fromFor("Acme", "no-reply@mail.hey-tiff.com")).toBe('"Acme" <no-reply@mail.hey-tiff.com>');
  });
});
