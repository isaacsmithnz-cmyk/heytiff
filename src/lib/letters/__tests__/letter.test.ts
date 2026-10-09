import { blankLetter, letterFileName, normaliseLetterInput, recipientLines, titleOf } from "../letter";

it("reads what the editor sends: trimmed, capped, a real date or none", () => {
  const l = normaliseLetterInput({
    id: " abc ",
    title: "  Sam's   employment ",
    date: "9 October",
    recipient: "Department of Home Affairs\r\n\r\n  GPO Box 9984 \n",
    subject: "Employment confirmation",
    body: { type: "doc", content: [] },
    signerStaffId: "staff-1",
    withSignature: "yes",
  });
  expect(l).toEqual({
    id: "abc",
    title: "Sam's employment",
    date: "",
    recipient: "Department of Home Affairs\nGPO Box 9984",
    subject: "Employment confirmation",
    body: { type: "doc", content: [] },
    signerStaffId: "staff-1",
    withSignature: false,
  });
  expect(normaliseLetterInput({}).id).toBeNull();
  expect(normaliseLetterInput({ date: "2026-10-09" }).date).toBe("2026-10-09");
});

it("names a letter by its title, then its Re line", () => {
  expect(titleOf({ title: "", subject: "Employment confirmation" })).toBe("Employment confirmation");
  expect(titleOf({ title: "", subject: "" })).toBe("Untitled letter");
  expect(letterFileName({ title: "Sam / Taylor", subject: "" }, "Diamond Air Solutions")).toBe("Sam - Taylor – Diamond Air Solutions.pdf");
});

it("starts a new letter dated today and signed by whoever is writing", () => {
  expect(blankLetter("2026-10-09", "staff-1")).toEqual(expect.objectContaining({ id: null, date: "2026-10-09", signerStaffId: "staff-1", withSignature: true }));
  expect(recipientLines("a\n\n b ")).toEqual(["a", "b"]);
});
