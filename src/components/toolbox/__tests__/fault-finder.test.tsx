/* Fault Finder UI — the guided walk: pick a symptom, answer one question at
   a time, land on an outcome, and step back through the trail. */

import { render, screen, fireEvent, within } from "@testing-library/react";
import { FaultFinder } from "../fault-finder";
import { SYMPTOMS } from "@/lib/toolbox/guided";

const pickSymptom = (name: RegExp) =>
  fireEvent.click(screen.getByRole("button", { name }));
const answer = (name: RegExp | string) =>
  fireEvent.click(screen.getByRole("button", { name }));

describe("FaultFinder — picking a symptom", () => {
  it("opens on the symptom picker with all ten symptoms", () => {
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
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/outdoor unit running/i);
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
    answer(/Yes, it's running/);
    expect(screen.getByText("Question 2")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/noticeably colder/i);
    answer(/No, it's barely cool/);
    expect(screen.getByText("Question 3")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/filters and the indoor coil/i);
  });

  it("builds a trail of the answers given", () => {
    const { container } = render(<FaultFinder />);
    pickSymptom(/Not cooling/);
    answer(/Yes, it's running/);
    answer(/No, it's barely cool/);
    const trail = container.querySelectorAll(".ffg-trail li");
    expect(trail).toHaveLength(2);
    expect(trail[0]).toHaveTextContent(/outdoor unit running/i);
    expect(trail[0]).toHaveTextContent(/Yes, it's running/);
  });

  it("reaches an outcome with a reason and an ordered what-to-do list", () => {
    const { container } = render(<FaultFinder />);
    pickSymptom(/Not cooling/);
    answer(/No, it's dead/);
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
    answer(/Yes, it's running/);
    answer(/No, it's barely cool/);
    answer(/Clean, good airflow/);
    answer(/No ice/);
    answer(/Clean and clear/);
    answer(/Yes, gauges are on/);
    const link = screen.getByRole("link", { name: /Open Running Pressures/ });
    expect(link).toHaveAttribute("href", "/dashboard/toolbox/running-pressures");
  });
});

describe("FaultFinder — going back", () => {
  it("Back returns to the previous question and drops that answer", () => {
    const { container } = render(<FaultFinder />);
    pickSymptom(/Not cooling/);
    answer(/Yes, it's running/);
    answer(/No, it's barely cool/);
    expect(container.querySelectorAll(".ffg-trail li")).toHaveLength(2);
    answer(/^Back$/);
    expect(screen.getByText("Question 2")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/noticeably colder/i);
    expect(container.querySelectorAll(".ffg-trail li")).toHaveLength(1);
  });

  it("clicking a trail step rewinds to it and discards everything after", () => {
    const { container } = render(<FaultFinder />);
    pickSymptom(/Not cooling/);
    answer(/Yes, it's running/);
    answer(/No, it's barely cool/);
    answer(/Clean, good airflow/);
    expect(container.querySelectorAll(".ffg-trail li")).toHaveLength(3);
    // jump back to the very first question
    fireEvent.click(within(container.querySelectorAll(".ffg-trail li")[0] as HTMLElement).getByRole("button"));
    expect(screen.getByText("Question 1")).toBeInTheDocument();
    expect(container.querySelectorAll(".ffg-trail li")).toHaveLength(0);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/outdoor unit running/i);
  });

  it("Back from an outcome returns to the last question", () => {
    render(<FaultFinder />);
    pickSymptom(/Not cooling/);
    answer(/No, it's dead/);
    answer(/Yes, indoor works/);
    expect(screen.getByText("Diagnosis")).toBeInTheDocument();
    answer(/^Back$/);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/indoor unit respond/i);
    expect(screen.queryByText("Diagnosis")).not.toBeInTheDocument();
  });

  it("Start over returns to the symptom picker", () => {
    render(<FaultFinder />);
    pickSymptom(/Not cooling/);
    answer(/Yes, it's running/);
    answer(/^Start over$/);
    expect(screen.getByText("What's it doing?")).toBeInTheDocument();
    expect(screen.queryByText(/^Question /)).not.toBeInTheDocument();
  });

  it("Change swaps symptom without leaving stale answers behind", () => {
    const { container } = render(<FaultFinder />);
    pickSymptom(/Not cooling/);
    answer(/Yes, it's running/);
    answer(/^Change$/);
    pickSymptom(/Won't turn on/);
    expect(screen.getByText("Question 1")).toBeInTheDocument();
    expect(container.querySelectorAll(".ffg-trail li")).toHaveLength(0);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/light, display or beep/i);
  });
});
