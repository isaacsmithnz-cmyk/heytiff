import {
  mentionedHandles,
  sm8Handle,
  taskTitleFromNote,
  withoutHandles,
  namedNote,
  quotedNote,
  withoutKnownHandles,
} from "@/lib/workboard/sm8-mentions";

/* The handles are LIVE FACTS, checked against the mirror before the module
   was written: one handle appears 783 times, two others 161 and 130,
   and one account row's surname really is ".". */

describe("sm8Handle", () => {
  it("is first and last run together, lower case", () => {
    expect(sm8Handle("Lyle", "Irving")).toBe("lyleirving");
    expect(sm8Handle("Oleh", "Kovalenko")).toBe("olehkovalenko");
  });

  it("strips the spaces ServiceM8 leaves in a name", () => {
    expect(sm8Handle("Brent (Service)", "Gilmore")).toBe("brent(service)gilmore");
    expect(sm8Handle(" Alex ", " Lomond ")).toBe("alexlomond");
  });

  it("is null when there is nothing to build one from", () => {
    /* An empty handle would match every bare "@" in the account. */
    expect(sm8Handle(null, null)).toBeNull();
    expect(sm8Handle("", "  ")).toBeNull();
  });
});

describe("mentionedHandles", () => {
  const roster = ["lyleirving", "michaeldixon", "davidhanby", "ross."];

  it("finds the handles a note names, in order, deduped", () => {
    expect(
      mentionedHandles("@lyleirving @michaeldixon still need another day @lyleirving", roster)
    ).toEqual(["lyleirving", "michaeldixon"]);
  });

  it("stops at punctuation rather than swallowing it", () => {
    expect(mentionedHandles("@lyleirving, can you look?", roster)).toEqual(["lyleirving"]);
    expect(mentionedHandles("ask @davidhanby.", roster)).toEqual(["davidhanby"]);
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
    expect(mentionedHandles("@lyleirving", [])).toEqual([]);
  });
});

describe("taskTitleFromNote", () => {
  it("takes the handles out — a mention is addressing, not content", () => {
    expect(
      taskTitleFromNote("@lyleirving @michaeldixon still need another day on site to finish")
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
    expect(taskTitleFromNote("@lyleirving @michaeldixon")).toBe("");
  });
});

describe("withoutHandles", () => {
  it("takes the addressing out and leaves the words alone", () => {
    /* A walk on live data drew `Lyle Irving — "@LyleIrving Bill 90%"` — the
       same person named twice in one line, because the row already opens
       with who it is about. */
    expect(withoutHandles("@LyleIrving Bill 90%")).toBe("Bill 90%");
  });

  it("does NOT capitalise or clip — that is the title's job, not a quote's", () => {
    expect(withoutHandles("@lyleirving can you please order the grille")).toBe(
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
  const roster = ["lyleirving", "michaeldixon", "isaacsmith", "davidhanby", "ross."];

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
    expect(withoutKnownHandles("@lyleirving ask @nobodyhere first", roster)).toBe("ask @nobodyhere first");
  });

  it("closes the gap a handle leaves, without a double space or a space before a comma", () => {
    expect(withoutKnownHandles("@lyleirving @michaeldixon still need another day", roster)).toBe(
      "still need another day",
    );
    expect(withoutKnownHandles("call @lyleirving about it", roster)).toBe("call about it");
    expect(withoutKnownHandles("hi @lyleirving, call Mary", roster)).toBe("hi, call Mary");
    expect(withoutKnownHandles("thanks @lyleirving", roster)).toBe("thanks");
  });

  it("keeps the full stop a handle ended the sentence with", () => {
    expect(withoutKnownHandles("Thanks @davidhanby.", roster)).toBe("Thanks.");
    expect(withoutKnownHandles("Ask @davidhanby. He knows", roster)).toBe("Ask. He knows");
    // a handle that really ends in one loses it, as mentionedHandles reads it
    expect(withoutKnownHandles("@ross. is on it", roster)).toBe("is on it");
  });

  it("keeps the note's line breaks and its capitals", () => {
    expect(withoutKnownHandles("@IsaacSmith\nPlease call Mary\nabout the quote", roster)).toBe(
      "Please call Mary\nabout the quote",
    );
  });

  it("leaves a possessive alone, as mentionedHandles does", () => {
    expect(withoutKnownHandles("@lyleirving's van is at the yard", roster)).toBe(
      "@lyleirving's van is at the yard",
    );
  });

  it("changes nothing but the ends when no handle is known", () => {
    expect(withoutKnownHandles("  @lyleirving call Mary ", [])).toBe("@lyleirving call Mary");
  });
});

describe("quotedNote", () => {
  /* The diary quotes Lyle to Isaac: only the addressing goes, and anybody
     else Lyle asks about stays in the sentence, by name. */
  const names = new Map([
    ["lyleirving", "Lyle"],
    ["michaeldixon", "Michael"],
    ["isaacsmith", "Isaac"],
    ["ross.", "Ross"],
  ]);
  const toIsaac = (text: string) => quotedNote(text, { names, addressing: ["isaacsmith"] });

  it("keeps a person the note asks about, by name", () => {
    expect(toIsaac("Hi @isaacsmith, can you ask @michaeldixon to bring the ladder")).toBe(
      "Hi, can you ask Michael to bring the ladder",
    );
    expect(toIsaac("@isaacsmith can you ask @michaeldixon.")).toBe("can you ask Michael.");
  });

  it("takes out the run of handles a note opens with, however it is joined", () => {
    expect(toIsaac("@isaacsmith @michaeldixon please sort the invoice")).toBe("please sort the invoice");
    expect(toIsaac("@isaacsmith and @michaeldixon please sort the invoice")).toBe("please sort the invoice");
    expect(toIsaac("@michaeldixon, @IsaacSmith & @lyleirving: roof access Monday")).toBe("roof access Monday");
    expect(toIsaac("@isaacsmith - please call Mary")).toBe("please call Mary");
    expect(toIsaac("@isaacsmith\nPlease call Mary\nabout the quote")).toBe("Please call Mary\nabout the quote");
  });

  it("names the run when the sentence carries on from it — it is who the note is about", () => {
    expect(toIsaac("@michaeldixon and I will sort it @isaacsmith")).toBe("Michael and I will sort it");
    expect(toIsaac("@isaacsmith, @michaeldixon & I are on it")).toBe("Isaac, Michael & I are on it");
  });

  it("ends the run at a handle that carries the full stop", () => {
    expect(toIsaac("@isaacsmith. @michaeldixon has the key")).toBe("Michael has the key");
  });

  it("takes out the reader's own handle wherever it is, closing the gap", () => {
    expect(toIsaac("Thanks @isaacsmith.")).toBe("Thanks.");
    expect(toIsaac("Please call Mary @isaacsmith")).toBe("Please call Mary");
  });

  it("leaves an address, an unknown @word and a possessive as written", () => {
    expect(toIsaac("@isaacsmith email susie@peterson.com about it")).toBe("email susie@peterson.com about it");
    expect(toIsaac("@isaacsmith ask @nobodyhere first")).toBe("ask @nobodyhere first");
    expect(toIsaac("@isaacsmith @michaeldixon's van is at the yard")).toBe("@michaeldixon's van is at the yard");
  });

  it("names a handle that ends in a full stop without losing the sentence's", () => {
    expect(toIsaac("@isaacsmith ask @ross. about it")).toBe("ask Ross about it");
  });
});

describe("namedNote", () => {
  /* What Tiff reads: nothing taken out, so a note written to two people
     keeps who each part is to. The real one, Alex's on 2778 Queenscliff,
     was read without its addressing as one task for Isaac with Lyle's
     half in it. */
  const names = new Map([
    ["lyleirving", "Lyle"],
    ["michaeldixon", "Michael"],
    ["isaacsmith", "Isaac"],
    ["ross.", "Ross"],
  ]);
  const named = (text: string) => namedNote(text, names);

  it("says every handle it knows by name, the opening run and the reader's own included", () => {
    expect(
      named(
        "@lyleirving when you send invoice can you please send through warranty stuff\n\n" +
          "@isaacsmith can you send house by rivers contact to David",
      ),
    ).toBe(
      "Lyle when you send invoice can you please send through warranty stuff\n\n" +
        "Isaac can you send house by rivers contact to David",
    );
    expect(named("@isaacsmith @michaeldixon please sort the invoice")).toBe("Isaac Michael please sort the invoice");
    expect(named("Thanks @IsaacSmith.")).toBe("Thanks Isaac.");
  });

  it("leaves an address, an unknown @word and a possessive as written, and a handle's full stop the sentence's", () => {
    expect(named("@isaacsmith email susie@peterson.com about it")).toBe("Isaac email susie@peterson.com about it");
    expect(named("@isaacsmith ask @nobodyhere first")).toBe("Isaac ask @nobodyhere first");
    expect(named("@michaeldixon's van is at the yard")).toBe("@michaeldixon's van is at the yard");
    expect(named("ask @ross. about it")).toBe("ask Ross about it");
  });

  it("is the note as written when nobody is known", () => {
    expect(namedNote("  @lyleirving call Mary ", new Map())).toBe("@lyleirving call Mary");
  });
});
