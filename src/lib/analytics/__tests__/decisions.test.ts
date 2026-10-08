/* The To decide questions: which answers each takes, and the stored rows
   made one map. */
import { answerLabel, answerSaid, cleanupFor, decisionsFrom, isAnswer, isQuestion } from "../decisions";

describe("the questions and their answers", () => {
  it("takes only the answers each question knows", () => {
    expect(isAnswer("quote", "quote")).toBe(true);
    expect(isAnswer("quote", "won")).toBe(false);
    expect(isAnswer("kind", "ducted")).toBe(true);
    expect(isAnswer("kind", "Ducted")).toBe(false);
    expect(isAnswer("outcome", 1)).toBe(false);
    expect(isQuestion("brand")).toBe(false);
  });

  it("makes the stored rows one map, leaving out what it doesn't know", () => {
    const m = decisionsFrom([
      { sm8_job_uuid: "a", question: "quote", answer: "quote" },
      { sm8_job_uuid: "a", question: "kind", answer: "vrf" },
      { sm8_job_uuid: "b", question: "kind", answer: "heat pump" },
      { sm8_job_uuid: "c", question: "brand", answer: "Daikin" },
    ]);
    expect(m.get("a")).toEqual({ quote: "quote", kind: "vrf" });
    expect(m.has("b")).toBe(false);
    expect(m.has("c")).toBe(false);
  });

  it("says each answer as a button and as what it did", () => {
    expect(answerLabel("kind", "split")).toBe("Wall split");
    expect(answerLabel("price", "leave_out")).toBe("Leave it out of prices");
    expect(answerSaid("kind", "ducted")).toBe("Counted as ducted.");
    expect(answerSaid("kind", "vrf")).toBe("Counted as VRF.");
    expect(answerSaid("quote", "not_quote")).toBe("Not a quote. Left out of the win rate.");
  });
});

describe("the clean-up in ServiceM8", () => {
  it("makes a won Quote a work order, and sends the rest of a disagreement to ServiceM8 by hand", () => {
    expect(cleanupFor("outcome", "won", "Quote")).toBe("work_order");
    expect(cleanupFor("outcome", "won", "Unsuccessful")).toBe("by_hand");
    expect(cleanupFor("outcome", "lost", "Quote")).toBe("unsuccessful");
    // ServiceM8 already agrees
    expect(cleanupFor("outcome", "lost", "Unsuccessful")).toBeNull();
    // HeyTiff's own reading: nothing in ServiceM8 to change
    expect(cleanupFor("kind", "ducted", "Completed")).toBeNull();
    expect(cleanupFor("quote", "quote", "Completed")).toBeNull();
  });
});
