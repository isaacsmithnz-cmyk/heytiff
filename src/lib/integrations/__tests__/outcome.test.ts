/* What a finished round trip says: the codes a redirect may carry, and the
   sentences a switch of account or a disconnect leaves behind. */

import {
  nameList,
  sm8ConnectMessage,
  sm8DisconnectNote,
  sm8OffNote,
  sm8RetryNote,
  sm8SwitchedNotice,
  sm8WaitingConsequence,
} from "../outcome";

describe("the connect codes", () => {
  it("an account another workspace holds, one ServiceM8 wouldn't name, and one that isn't paid up", () => {
    expect(sm8ConnectMessage("elsewhere")).toBe(
      "That ServiceM8 account is already connected to another HeyTiff workspace, so nothing changed here. Disconnect it there first, or connect a different account."
    );
    expect(sm8ConnectMessage("account")).toBe(
      "ServiceM8 didn't say which account that was, so nothing changed here. Try again."
    );
    expect(sm8ConnectMessage("billing")).toBe(
      "That ServiceM8 account isn't accepting requests until its plan or invoice is sorted, so nothing changed here."
    );
  });

  it("anything else is the generic line, never the code", () => {
    expect(sm8ConnectMessage("<script>")).toBe("Something went wrong connecting ServiceM8. Try again.");
  });
});

describe("nameList", () => {
  it("reads as a list is read", () => {
    expect(nameList([])).toBe("");
    expect(nameList(["A"])).toBe("A");
    expect(nameList(["A", "B"])).toBe("A and B");
    expect(nameList(["A", "B", "C"])).toBe("A, B and 1 more");
    expect(nameList(["A", "B", "C", "D", "E"])).toBe("A, B and 3 more");
  });

  it("counts the ones with no name to show", () => {
    expect(nameList(["A"], 1)).toBe("A and 1 more");
    expect(nameList(["A", "B"], 2)).toBe("A, B and 2 more");
  });
});

describe("sm8SwitchedNotice", () => {
  it("names both accounts and what went with the old one", () => {
    expect(sm8SwitchedNotice({ to: "Beta Cooling", from: "Acme Air", cancelled: 0 })).toBe(
      "Connected to Beta Cooling. It replaced Acme Air. HeyTiff cleared its copy of Acme Air and switched sending to ServiceM8 off."
    );
  });

  it("one file, and several", () => {
    expect(sm8SwitchedNotice({ to: "Beta Cooling", from: "Acme Air", cancelled: 1 })).toMatch(
      / 1 file waiting to go to Acme Air was cancelled\.$/
    );
    expect(sm8SwitchedNotice({ to: "Beta Cooling", from: "Acme Air", cancelled: 3 })).toMatch(
      / 3 files waiting to go to Acme Air were cancelled\.$/
    );
  });

  it("an old account whose name was never read", () => {
    expect(sm8SwitchedNotice({ to: "Beta Cooling", from: null, cancelled: 2 })).toBe(
      "Connected to Beta Cooling. It replaced another ServiceM8 account. HeyTiff cleared its copy of that account and switched sending to ServiceM8 off. 2 files waiting to go to that account were cancelled."
    );
  });
});

describe("sm8DisconnectNote", () => {
  const TAIL = "To fully revoke access, also remove HeyTiff from your ServiceM8 account's add-ons.";

  it("with nothing waiting, exactly today's sentence", () => {
    expect(sm8DisconnectNote({ cancelled: [], unnamed: 0, inFlight: 0 })).toBe(`Disconnected here. ${TAIL}`);
  });

  it("names what it cancelled", () => {
    expect(sm8DisconnectNote({ cancelled: ["Public liability.pdf"], unnamed: 0, inFlight: 0 })).toBe(
      `Disconnected here. 1 file waiting to go to ServiceM8 was cancelled: Public liability.pdf. ${TAIL}`
    );
    expect(sm8DisconnectNote({ cancelled: ["a.pdf", "b.pdf", "c.pdf"], unnamed: 0, inFlight: 0 })).toBe(
      `Disconnected here. 3 files waiting to go to ServiceM8 were cancelled: a.pdf, b.pdf and 1 more. ${TAIL}`
    );
  });

  it("counts files with no name to show", () => {
    expect(sm8DisconnectNote({ cancelled: [], unnamed: 2, inFlight: 0 })).toBe(
      `Disconnected here. 2 files waiting to go to ServiceM8 were cancelled. ${TAIL}`
    );
  });

  it("says what was already on its way and may still arrive", () => {
    expect(sm8DisconnectNote({ cancelled: [], unnamed: 0, inFlight: 1 })).toBe(
      `Disconnected here. 1 file was already on its way to ServiceM8, and may still arrive. ${TAIL}`
    );
    expect(sm8DisconnectNote({ cancelled: ["a.pdf"], unnamed: 0, inFlight: 2 })).toBe(
      `Disconnected here. 1 file waiting to go to ServiceM8 was cancelled: a.pdf. 2 files were already on their way to ServiceM8, and may still arrive. ${TAIL}`
    );
  });
});

describe("the disconnect confirm's waiting line", () => {
  it("one, several, or nothing to say", () => {
    expect(sm8WaitingConsequence(1)).toBe("1 file still waiting to go to ServiceM8 is cancelled.");
    expect(sm8WaitingConsequence(2)).toBe("2 files still waiting to go to ServiceM8 are cancelled.");
    expect(sm8WaitingConsequence(0)).toBeNull();
  });
});

describe("a connect that couldn't read the settings", () => {
  it("says nothing changed", () => {
    expect(sm8ConnectMessage("settings")).toBe(
      "HeyTiff couldn't read this workspace's ServiceM8 settings, so nothing changed. Try again."
    );
  });
});

describe("what Off cancelled", () => {
  it("says how many files that were waiting won't go", () => {
    expect(sm8OffNote(2)).toBe("Sending is off. 2 files that were waiting won't go.");
    expect(sm8OffNote(1)).toBe("Sending is off. 1 file that was waiting won't go.");
    expect(sm8OffNote(0)).toBeNull();
  });
});

describe("what Retry failed files did", () => {
  it("says how many go again, and how many are left for the next hour", () => {
    expect(sm8RetryNote({ queued: 2, left: 0, capped: false, byHour: false })).toBe("2 files will go again.");
    expect(sm8RetryNote({ queued: 1, left: 0, capped: false, byHour: false })).toBe("1 file will go again.");
    expect(sm8RetryNote({ queued: 2, left: 1, capped: false, byHour: true })).toBe(
      "2 files will go again. 1 more can go after an hour."
    );
    expect(sm8RetryNote({ queued: 200, left: 5, capped: false, byHour: false })).toBe(
      "200 files will go again. 5 more can go with another retry."
    );
  });

  it("says when the hour has no room", () => {
    expect(sm8RetryNote({ queued: 0, left: 3, capped: true, byHour: true })).toBe(
      "60 have gone to ServiceM8 in the last hour. Try again in an hour."
    );
    expect(sm8RetryNote({ queued: 0, left: 0, capped: false, byHour: false })).toBe("Nothing is waiting to go again.");
  });
});
