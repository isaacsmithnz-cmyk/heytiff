/* A tab older than the deploy (the walk of 2026-09-28: Cancel booking on a
   tab open across a deploy said "couldn't queue it. Try again"). The
   rejection here is Next's own class, the one its router throws when the
   server answers with the action-not-found header. */

import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import { isStaleDeploy, STALE_DEPLOY_WORDS, thrownWords } from "@/lib/stale-deploy";

const nextsOwn = () =>
  new UnrecognizedActionError(
    'Server Action "7f00" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action'
  );

describe("thrownWords", () => {
  it("says the reload line for Next's rejection of an action this deploy doesn't have", () => {
    expect(isStaleDeploy(nextsOwn())).toBe(true);
    expect(thrownWords(nextsOwn(), "HeyTiff couldn't queue it. Try again.")).toBe(STALE_DEPLOY_WORDS);
  });

  it("knows it by its name too, when the class is another copy", () => {
    const copy = new Error("Server Action \"7f00\" was not found on the server.");
    copy.name = "UnrecognizedActionError";
    expect(thrownWords(copy, "fallback")).toBe(STALE_DEPLOY_WORDS);
  });

  it("leaves every other failure its own words", () => {
    expect(thrownWords(new Error("fetch failed"), "HeyTiff couldn't queue it. Try again.")).toBe(
      "HeyTiff couldn't queue it. Try again."
    );
    expect(thrownWords(new Error("An unexpected response was received from the server."), "x")).toBe("x");
    expect(thrownWords("UnrecognizedActionError", "x")).toBe("x");
    expect(thrownWords(undefined, "x")).toBe("x");
  });

  it("is one plain line", () => {
    expect(STALE_DEPLOY_WORDS).toBe("HeyTiff was updated. Reload the page to carry on.");
  });
});
