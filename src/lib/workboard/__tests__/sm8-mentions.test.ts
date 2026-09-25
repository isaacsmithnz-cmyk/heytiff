import {
  mentionedHandles,
  sm8Handle,
  taskTitleFromNote,
  withoutHandles,
  withoutKnownHandles,
} from "@/lib/workboard/sm8-mentions";

/* The handles are LIVE FACTS, checked against the mirror before the module
   was written: @lukeingold appears 783 times, @michaeldiamond 161,
   @isaacsmith 130, and one account row's surname really is ".". */

describe("sm8Handle", () => {
  it("is first and last run together, lower case", () => {
    expect(sm8Handle("Luke", "Ingold")).toBe("lukeingold");
    expect(sm8Handle("Oleksii", "Khalameida")).toBe("oleksiikhalameida");
  });

  it("strips the spaces ServiceM8 leaves in a name", () => {
    expect(sm8Handle("Brent (Service)", "Gilmore")).toBe("brent(service)gilmore");
    expect(sm8Handle(" Alex ", " Lorenz ")).toBe("alexlorenz");
  });

  it("is null when there is nothing to build one from", () => {
    /* An empty handle would match every bare "@" in the account. */
    expect(sm8Handle(null, null)).toBeNull();
    expect(sm8Handle("", "  ")).toBeNull();
  });
});

describe("mentionedHandles", () => {
  const roster = ["lukeingold", "michaeldiamond", "davidhann", "ross."];

  it("finds the handles a note names, in order, deduped", () => {
    expect(
      mentionedHandles("@lukeingold @michaeldiamond still need another day @lukeingold", roster)
    ).toEqual(["lukeingold", "michaeldiamond"]);
  });

  it("stops at punctuation rather than swallowing it", () => {
    expect(mentionedHandles("@lukeingold, can you look?", roster)).toEqual(["lukeingold"]);
    expect(mentionedHandles("ask @davidhann.", roster)).toEqual(["davidhann"]);
  });

  it("still matches a handle that really ends in a full stop", () => {
    expect(mentionedHandles("@ross. is on it", roster)).toEqual(["ross."]);
  });

  it("ignores an @ that is not one of ours", () => {
    /* An email address in a note is full of "@" and none of it is a mention
       — which is why this matches against the roster instead of the regex. */
    expect(mentionedHandles("email susie@peterson.com about it", roster)).toEqual([]);
    expect(mentionedHandles("@nobodyhere", roster)).toEqual([]);
  });

  it("answers nothing when the roster is empty", () => {
    expect(mentionedHandles("@lukeingold", [])).toEqual([]);
  });
});

describe("taskTitleFromNote", () => {
  it("takes the handles out — a mention is addressing, not content", () => {
    expect(
      taskTitleFromNote("@lukeingold @michaeldiamond still need another day on site to finish")
    ).toBe("Still need another day on site to finish");
  });

  it("clips at the first sentence when there is one worth having", () => {
    expect(
      taskTitleFromNote("Order the return air box for Henry Street. It goes in on Friday.")
    ).toBe("Order the return air box for Henry Street");
  });

  it("keeps the lot when the first sentence is too short to stand alone", () => {
    expect(taskTitleFromNote("Hi mate. Order the return air box please")).toBe(
      "Hi mate. Order the return air box please"
    );
  });

  it("clips a rambling note rather than making a rambling title", () => {
    const long = `Order ${"the return air box ".repeat(12)}`;
    const title = taskTitleFromNote(long);
    expect(title.length).toBeLessThanOrEqual(90);
    expect(title.endsWith("…")).toBe(true);
  });

  it("is empty when the note was nothing but mentions", () => {
    expect(taskTitleFromNote("@lukeingold @michaeldiamond")).toBe("");
  });
});

describe("withoutHandles", () => {
  it("takes the addressing out and leaves the words alone", () => {
    /* A walk on live data drew `Luke Ingold — "@LukeIngold Bill 90%"` — the
       same person named twice in one line, because the row already opens
       with who it is about. */
    expect(withoutHandles("@LukeIngold Bill 90%")).toBe("Bill 90%");
  });

  it("does NOT capitalise or clip — that is the title's job, not a quote's", () => {
    expect(withoutHandles("@lukeingold can you please order the grille")).toBe(
      "can you please order the grille",
    );
  });

  it("leaves a note with no handles exactly as it was", () => {
    expect(withoutHandles("Return air box at henry to be picked up")).toBe(
      "Return air box at henry to be picked up",
    );
  });
});

describe("withoutKnownHandles", () => {
  /* The diary QUOTES a person, so only what is addressing may go. */
  const roster = ["lukeingold", "michaeldiamond", "isaacsmith", "davidhann", "ross."];

  it("keeps an email address whole, where withoutHandles cut it in half", () => {
    const note = "@isaacsmith email susie@peterson.com about it";
    expect(withoutHandles(note)).toBe("email susie about it");
    expect(withoutKnownHandles(note, roster)).toBe("email susie@peterson.com about it");
  });

  it("keeps an address even when what follows its @ is somebody's handle", () => {
    /* an @ inside a word is an address, never a mention */
    expect(withoutKnownHandles("send it to info@isaacsmith today", roster)).toBe(
      "send it to info@isaacsmith today",
    );
  });

  it("takes a known handle out and leaves an unknown @word alone", () => {
    expect(withoutKnownHandles("@lukeingold ask @nobodyhere first", roster)).toBe("ask @nobodyhere first");
  });

  it("closes the gap a handle leaves, without a double space or a space before a comma", () => {
    expect(withoutKnownHandles("@lukeingold @michaeldiamond still need another day", roster)).toBe(
      "still need another day",
    );
    expect(withoutKnownHandles("call @lukeingold about it", roster)).toBe("call about it");
    expect(withoutKnownHandles("hi @lukeingold, call Mary", roster)).toBe("hi, call Mary");
    expect(withoutKnownHandles("thanks @lukeingold", roster)).toBe("thanks");
  });

  it("keeps the full stop a handle ended the sentence with", () => {
    expect(withoutKnownHandles("Thanks @davidhann.", roster)).toBe("Thanks.");
    expect(withoutKnownHandles("Ask @davidhann. He knows", roster)).toBe("Ask. He knows");
    // a handle that really ends in one loses it, as mentionedHandles reads it
    expect(withoutKnownHandles("@ross. is on it", roster)).toBe("is on it");
  });

  it("keeps the note's line breaks and its capitals", () => {
    expect(withoutKnownHandles("@IsaacSmith\nPlease call Mary\nabout the quote", roster)).toBe(
      "Please call Mary\nabout the quote",
    );
  });

  it("leaves a possessive alone, as mentionedHandles does", () => {
    expect(withoutKnownHandles("@lukeingold's van is at the yard", roster)).toBe(
      "@lukeingold's van is at the yard",
    );
  });

  it("changes nothing but the ends when no handle is known", () => {
    expect(withoutKnownHandles("  @lukeingold call Mary ", [])).toBe("@lukeingold call Mary");
  });
});
