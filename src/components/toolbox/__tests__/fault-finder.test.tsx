/* Fault Finder UI — the guided walk: pick a symptom, answer one question at
   a time, land on an outcome, and step back through the trail. */

import { render, screen, fireEvent, within } from "@testing-library/react";
import { FaultFinder } from "../fault-finder";
import { SYMPTOMS } from "@/lib/toolbox/guided";
import { ASK_HANDOFF_KEY } from "@/lib/tiff/ask-handoff";

const push = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const pickSymptom = (name: RegExp) =>
  fireEvent.click(screen.getByRole("button", { name }));
const answer = (name: RegExp | string) =>
  fireEvent.click(screen.getByRole("button", { name }));

describe("FaultFinder — picking a symptom", () => {
  it("opens on the symptom picker with all eleven symptoms", () => {
    render(<FaultFinder />);
    expect(screen.getByText("What's it doing?")).toBeInTheDocument();
    for (const s of SYMPTOMS) {
      expect(screen.getByRole("button", { name: new RegExp(s.label) })).toBeInTheDocument();
    }
    // no question until a symptom is chosen
    expect(screen.queryByText(/Question 1/)).not.toBeInTheDocument();
  });

  it("choosing a symptom asks the first question, not a list of causes", () => {
    render(<FaultFinder />);
    pickSymptom(/Not cooling/);
    expect(screen.getByText("Question 1")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/set to COOL/i);
    // exactly one question on screen at a time
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
  });

  it("shows the symptom's safety note up front where there is one", () => {
    render(<FaultFinder />);
    pickSymptom(/Ice on pipes/);
    expect(screen.getByRole("alert")).toHaveTextContent(/never chip/i);
  });
});

describe("FaultFinder — walking the tree", () => {
  it("each answer advances to the next question and counts the step", () => {
    render(<FaultFinder />);
    pickSymptom(/Not cooling/);
    answer(/Yes, definitely cooling/);
    expect(screen.getByText("Question 2")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/what's actually happening/i);
    answer(/Running, but the air is barely cool/);
    expect(screen.getByText("Question 3")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/filters and indoor coil/i);
  });

  it("builds a trail of the answers given", () => {
    const { container } = render(<FaultFinder />);
    pickSymptom(/Not cooling/);
    answer(/Yes, definitely cooling/);
    answer(/Running, but the air is barely cool/);
    const trail = container.querySelectorAll(".ffg-trail li");
    expect(trail).toHaveLength(2);
    expect(trail[1]).toHaveTextContent(/what's actually happening/i);
    expect(trail[1]).toHaveTextContent(/barely cool/);
  });

  it("reaches an outcome with a reason and an ordered what-to-do list", () => {
    const { container } = render(<FaultFinder />);
    pickSymptom(/Not cooling/);
    answer(/Yes, definitely cooling/);
    answer(/The outdoor unit isn't running/);
    answer(/Yes, indoor works/);
    expect(screen.getByText("Diagnosis")).toBeInTheDocument();
    expect(container.querySelector(".ffg-outcome h2")).toHaveTextContent(/outdoor unit isn't/i);
    expect(screen.getByText("What to do")).toBeInTheDocument();
    expect(container.querySelectorAll(".ffg-actions li").length).toBeGreaterThanOrEqual(2);
    // no question remains once diagnosed
    expect(screen.queryByText(/^Question /)).not.toBeInTheDocument();
  });

  it("flags specialist work on the outcome", () => {
    const { container } = render(<FaultFinder />);
    pickSymptom(/Trips the breaker/);
    answer(/Instantly, the moment it starts/);
    expect(container.querySelector(".ffg-outcome .esc")).toHaveTextContent(/specialist/i);
    expect(container.querySelector(".ffg-outcome h2")).toHaveTextContent(/short or earth fault/i);
  });

  it("hands off to Running Pressures when pressures decide it", () => {
    render(<FaultFinder />);
    pickSymptom(/Not cooling/);
    answer(/Yes, definitely cooling/);
    answer(/Running, but the air is barely cool/);
    answer(/Clean, good airflow/);
    answer(/No ice/);
    answer(/Clean and clear/);
    const link = screen.getByRole("link", { name: /Open Running Pressures/ });
    expect(link).toHaveAttribute("href", "/dashboard/toolbox/running-pressures");
  });
});

describe("FaultFinder — how much further", () => {
  it("shows what's left to answer, so a long branch doesn't read as endless", () => {
    const { container } = render(<FaultFinder />);
    pickSymptom(/Not cooling/);
    expect(container.querySelector(".ffg-head .left")).toHaveTextContent(/up to 4 more/i);
  });

  it("names the last question as the last one", () => {
    const { container } = render(<FaultFinder />);
    pickSymptom(/Bad smell/);
    expect(container.querySelector(".ffg-head .left")).toHaveTextContent(/last question/i);
  });

  it("drops the counter once there's a diagnosis", () => {
    const { container } = render(<FaultFinder />);
    pickSymptom(/Bad smell/);
    answer(/Musty or mouldy/);
    expect(screen.getByText("Diagnosis")).toBeInTheDocument();
    expect(container.querySelector(".ffg-head .left")).toBeNull();
  });
});

describe("FaultFinder — multi and VRF", () => {
  it("asks scope first, then diagnoses a mode clash as design", () => {
    const { container } = render(<FaultFinder />);
    pickSymptom(/Multi or VRF/);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/how much of the system/i);
    answer(/Some heads heat while others want cool/);
    answer(/Two-pipe, or not sure/);
    expect(container.querySelector(".ffg-outcome h2")).toHaveTextContent(/mode conflict/i);
    // it isn't a fault, so it shouldn't be flagged as specialist work
    expect(container.querySelector(".ffg-outcome .esc")).toBeNull();
  });

  it("a head conditioning while it's off is one question deep", () => {
    const { container } = render(<FaultFinder />);
    pickSymptom(/Multi or VRF/);
    answer(/A head is warm or cold when it's off/);
    expect(screen.getByText("Diagnosis")).toBeInTheDocument();
    expect(container.querySelector(".ffg-outcome h2")).toHaveTextContent(/creeping/i);
  });
});

describe("FaultFinder — going back", () => {
  it("Back returns to the previous question and drops that answer", () => {
    const { container } = render(<FaultFinder />);
    pickSymptom(/Not cooling/);
    answer(/Yes, definitely cooling/);
    answer(/Running, but the air is barely cool/);
    expect(container.querySelectorAll(".ffg-trail li")).toHaveLength(2);
    answer(/^Back$/);
    expect(screen.getByText("Question 2")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/what's actually happening/i);
    expect(container.querySelectorAll(".ffg-trail li")).toHaveLength(1);
  });

  it("clicking a trail step rewinds to it and discards everything after", () => {
    const { container } = render(<FaultFinder />);
    pickSymptom(/Not cooling/);
    answer(/Yes, definitely cooling/);
    answer(/Running, but the air is barely cool/);
    answer(/Clean, good airflow/);
    expect(container.querySelectorAll(".ffg-trail li")).toHaveLength(3);
    // jump back to the very first question
    fireEvent.click(within(container.querySelectorAll(".ffg-trail li")[0] as HTMLElement).getByRole("button"));
    expect(screen.getByText("Question 1")).toBeInTheDocument();
    expect(container.querySelectorAll(".ffg-trail li")).toHaveLength(0);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/set to COOL/i);
  });

  it("Back from an outcome returns to the last question", () => {
    render(<FaultFinder />);
    pickSymptom(/Not cooling/);
    answer(/Yes, definitely cooling/);
    answer(/The outdoor unit isn't running/);
    answer(/Yes, indoor works/);
    expect(screen.getByText("Diagnosis")).toBeInTheDocument();
    answer(/^Back$/);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/indoor unit respond/i);
    expect(screen.queryByText("Diagnosis")).not.toBeInTheDocument();
  });

  it("Start over returns to the symptom picker", () => {
    render(<FaultFinder />);
    pickSymptom(/Not cooling/);
    answer(/Yes, definitely cooling/);
    answer(/Running, but the air is barely cool/);
    answer(/^Start over$/);
    expect(screen.getByText("What's it doing?")).toBeInTheDocument();
    expect(screen.queryByText(/^Question /)).not.toBeInTheDocument();
  });

  it("Change swaps symptom without leaving stale answers behind", () => {
    const { container } = render(<FaultFinder />);
    pickSymptom(/Not cooling/);
    answer(/Yes, definitely cooling/);
    answer(/Running, but the air is barely cool/);
    answer(/^Change$/);
    pickSymptom(/Won't turn on/);
    expect(screen.getByText("Question 1")).toBeInTheDocument();
    expect(container.querySelectorAll(".ffg-trail li")).toHaveLength(0);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/light, display or beep/i);
  });
});

/* The code branch used to end at "read that unit's service manual", which is
   the one outcome in fifteen trees that told a tech to go somewhere the app
   couldn't take them. The manuals are in the workspace's library, so the walk
   now finishes with the code in a box. */
describe("FaultFinder — a diagnosis that lands on a code", () => {
  beforeEach(() => {
    push.mockClear();
    sessionStorage.clear();
  });

  /** Error light or code → recorded → still there after a power cycle. */
  const walkToCode = () => {
    pickSymptom(/Error light or code/);
    answer(/Yes, I've got it/);
    answer(/Yes, it returns/);
  };

  it("offers the library instead of stopping at the manual", () => {
    render(<FaultFinder library="ready" />);
    walkToCode();

    expect(screen.getByText("The fault is still present")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Look the code up" })).toBeInTheDocument();
    expect(screen.getByLabelText("Code or blink pattern")).toBeInTheDocument();
  });

  it("won't look up an empty box", () => {
    render(<FaultFinder library="ready" />);
    walkToCode();

    expect(screen.getByRole("button", { name: /Look it up/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Look it up/ }));
    expect(push).not.toHaveBeenCalled();
  });

  it("carries the code to the composer as a question, and sends nothing", () => {
    render(<FaultFinder library="ready" />);
    walkToCode();

    fireEvent.change(screen.getByLabelText("Code or blink pattern"), {
      target: { value: "E5" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Look it up/ }));

    expect(sessionStorage.getItem(ASK_HANDOFF_KEY)).toContain("“E5”");
    // the caret lands after the question so the brand and model can go on
    expect(sessionStorage.getItem(ASK_HANDOFF_KEY)?.endsWith("? ")).toBe(true);
    expect(push).toHaveBeenCalledWith("/dashboard/tiff");
  });

  it("points at the empty Library rather than searching it", () => {
    render(<FaultFinder library="empty" />);
    walkToCode();

    expect(screen.queryByLabelText("Code or blink pattern")).not.toBeInTheDocument();
    const note = screen.getByRole("link", { name: "Library" }).closest("p");
    expect(note).toHaveTextContent(/Add this unit’s manual/);
  });

  it("says nothing about a library this tech can't reach", () => {
    render(<FaultFinder />);
    walkToCode();

    expect(screen.getByText("The fault is still present")).toBeInTheDocument();
    expect(screen.queryByLabelText("Code or blink pattern")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Library" })).not.toBeInTheDocument();
  });

  it("stays out of outcomes that don't end on a code", () => {
    render(<FaultFinder library="ready" />);
    pickSymptom(/Not cooling/);
    answer(/Yes, definitely cooling/);
    answer(/The outdoor unit isn't running/);
    answer(/Yes, indoor works/);

    expect(screen.getByText("Diagnosis")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Look the code up" })).not.toBeInTheDocument();
  });
});
