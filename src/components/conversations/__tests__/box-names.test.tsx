import { cleanup, render, screen } from "@testing-library/react";
import { CvBox } from "../box";
import { LiveWords } from "@/components/notes/dictation";
import { forgetPeople } from "@/components/notes/use-people";
import { personWords } from "@/lib/staff/people-named";

/* A PERSON ON THE WORKSPACE TURNS BLUE IN THE BOX, as the phone's (Isaac,
   11 November 2026). A textarea draws its words in one colour, so the box
   draws them again behind it with the name in a `.cv-named` span, and the
   textarea's own letters go clear (`.cv-words--named`). Without a name there
   is no second drawing at all. Said words wear `.cv-named` themselves. */

const people = [
  { id: "1", name: "Luke Ingold", words: personWords({ fullName: "Luke Ingold" }) },
  { id: "2", name: "Alex Lorenz", words: personWords({ fullName: "Alex Lorenz" }) },
  { id: "3", name: "Alex Morozoff", words: personWords({ fullName: "Alex Morozoff" }) },
];

beforeEach(() => forgetPeople(people));
afterEach(() => {
  cleanup();
  forgetPeople();
});

const box = (value: string) =>
  render(<CvBox value={value} onChange={() => {}} onSubmit={() => {}} label="Write a note on this job" placeholder="Write a note on this job" sendWord="Tiff" dict={null} />);

it("draws a typed name in blue behind the box's clear letters", () => {
  const { container } = box("Can you let Luke know that Jay Matthews' job is ready to book in?");
  const field = screen.getByRole("textbox", { name: "Write a note on this job" });
  expect(field).toHaveClass("cv-words--named");
  const mirror = container.querySelector(".cv-mirror");
  expect(mirror).toHaveAttribute("aria-hidden", "true");
  expect(mirror?.textContent).toBe("Can you let Luke know that Jay Matthews' job is ready to book in?");
  expect(Array.from(container.querySelectorAll(".cv-named")).map((n) => n.textContent)).toEqual(["Luke"]);
});

it("draws nothing twice when nobody is named, or the name is two people's", () => {
  const { container } = box("Alex brings the ladder");
  expect(container.querySelector(".cv-mirror")).toBeNull();
  expect(screen.getByRole("textbox")).not.toHaveClass("cv-words--named");
});

it("keeps the textarea the same element as a name arrives, so the cursor stays put", () => {
  const { rerender } = box("Can you let Lu");
  const before = screen.getByRole("textbox");
  rerender(<CvBox value="Can you let Luke" onChange={() => {}} onSubmit={() => {}} label="Write a note on this job" placeholder="Write a note on this job" sendWord="Tiff" dict={null} />);
  expect(screen.getByRole("textbox")).toBe(before);
  expect(before).toHaveClass("cv-words--named");
});

it("colours a name in the words as they're heard, and in what was typed before", () => {
  const { container } = render(<LiveWords said="Ring Alex Lorenz" text="and let Luke know" />);
  expect(Array.from(container.querySelectorAll(".cv-named")).map((n) => n.textContent)).toEqual(["Alex Lorenz", "Luke"]);
  expect(container.querySelector(".wb2-lwsaid")?.textContent).toBe("Ring Alex Lorenz");
});
