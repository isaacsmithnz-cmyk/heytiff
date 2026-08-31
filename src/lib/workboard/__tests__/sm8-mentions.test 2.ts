import {
  mentionedHandles,
  sm8Handle,
  taskTitleFromNote,
  withoutHandles,
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
