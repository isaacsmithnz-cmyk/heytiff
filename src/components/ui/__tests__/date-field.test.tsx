import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateField, type DateFieldProps } from "../date-field";

/* The point of this component is that there is nothing to type into. Every
   assertion below is really one of two: the calendar is the only way in, and
   what comes out is ISO. */

const TODAY = "2026-07-25"; // a Saturday

function Harness({ initial = null, ...props }: Partial<DateFieldProps> & { initial?: string | null }) {
  const [value, setValue] = useState<string | null>(initial);
  const onChange = (iso: string | null) => {
    setValue(iso);
    props.onChange?.(iso);
  };
  return (
    <label className="mts-f">
      <span>Due</span>
      <DateField {...props} today={props.today ?? TODAY} value={value} onChange={onChange} />
    </label>
  );
}

function setup(props: Partial<DateFieldProps> & { initial?: string | null } = {}) {
  const onChange = jest.fn();
  render(<Harness {...props} onChange={onChange} />);
  return { onChange, user: userEvent.setup(), field: () => screen.getByLabelText("Due") };
}

describe("the field", () => {
  it("renders no text or date input anywhere — open or closed", async () => {
    const { user, field } = setup();
    expect(document.querySelectorAll("input")).toHaveLength(0);

    await user.click(field());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(document.querySelectorAll("input")).toHaveLength(0);
    expect(document.querySelector('input[type="text"]')).toBeNull();
    expect(document.querySelector('input[type="date"]')).toBeNull();
  });

  it("shows dd/mm/yyyy, never the ISO it holds", () => {
    setup({ initial: "2026-01-09" });
    expect(screen.getByLabelText("Due")).toHaveTextContent("09/01/2026");
    expect(screen.queryByText("2026-01-09")).not.toBeInTheDocument();
  });

  it("shows the placeholder when empty", () => {
    setup({ placeholder: "No date" });
    expect(screen.getByLabelText("Due")).toHaveTextContent("No date");
    expect(screen.getByLabelText("Due").className).toContain("empty");
  });

  it("starts closed and opens on click", async () => {
    const { user, field } = setup();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(field()).toHaveAttribute("aria-expanded", "false");

    await user.click(field());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(field()).toHaveAttribute("aria-expanded", "true");
  });

  /* It's a real <button>, so the keyboard already works — this pins that it
     stays one, because the moment it becomes a div the Enter key goes away. */
  it("opens from the keyboard", async () => {
    const { user, field } = setup();
    field().focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  /* The profile cards mark a field the server rejected; this is how the mark
     reaches a control that is a button, not an input. */
  it("wears the invalid mark when told to, and not otherwise", () => {
    const { field } = setup({ invalid: true });
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(field().className).toContain("err");
  });

  it("carries no invalid mark by default", () => {
    const { field } = setup();
    expect(field()).not.toHaveAttribute("aria-invalid");
    expect(field().className).not.toContain("err");
  });

  it("says nothing and opens nothing when disabled", async () => {
    const { user, field } = setup({ disabled: true });
    expect(field()).toBeDisabled();
    await user.click(field());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("picking", () => {
  it("opens on the value's month, not today's", async () => {
    const { user, field } = setup({ initial: "2026-01-09" });
    await user.click(field());
    expect(screen.getByText("January 2026")).toBeInTheDocument();
  });

  it("opens on today's month when there's no value", async () => {
    const { user, field } = setup();
    await user.click(field());
    expect(screen.getByText("July 2026")).toBeInTheDocument();
  });

  it("reports ISO, closes, and shows the AU format", async () => {
    const { user, onChange, field } = setup();
    await user.click(field());
    await user.click(screen.getByRole("button", { name: "Monday 20 July 2026" }));

    expect(onChange).toHaveBeenCalledWith("2026-07-20");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(field()).toHaveTextContent("20/07/2026");
    expect(field()).toHaveFocus();
  });

  it("pages months without reporting anything", async () => {
    const { user, onChange, field } = setup();
    await user.click(field());
    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByText("August 2026")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Tuesday 4 August 2026" }));
    expect(onChange).toHaveBeenCalledWith("2026-08-04");
  });

  it("honours min and max", async () => {
    const { user, field } = setup({ min: "2026-07-20", max: "2026-07-28" });
    await user.click(field());
    expect(screen.getByRole("button", { name: "Sunday 19 July 2026" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Monday 20 July 2026" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Wednesday 29 July 2026" })).toBeDisabled();
  });
});

describe("the footer", () => {
  it("Today writes the AU day it was given", async () => {
    const { user, onChange, field } = setup();
    await user.click(field());
    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(onChange).toHaveBeenCalledWith(TODAY);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("refuses Today when today is out of bounds", async () => {
    const { user, field } = setup({ min: "2026-08-01" });
    await user.click(field());
    expect(screen.getByRole("button", { name: "Today" })).toBeDisabled();
  });

  it("withholds Clear when the caller never asked for it", async () => {
    const { user, field } = setup({ initial: "2026-07-20" });
    await user.click(field());
    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
  });

  it("withholds Clear when clearable but already empty", async () => {
    const { user, field } = setup({ clearable: true });
    await user.click(field());
    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
  });

  it("Clear empties the field", async () => {
    const { user, onChange, field } = setup({ initial: "2026-07-20", clearable: true });
    await user.click(field());
    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(onChange).toHaveBeenCalledWith(null);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(field()).toHaveTextContent("dd/mm/yyyy");
  });
});

describe("closing", () => {
  it("closes on Escape and hands focus back", async () => {
    const { user, field } = setup();
    await user.click(field());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(field()).toHaveFocus();
  });

  /* The picker lives inside modals that close themselves on a document-level
     Escape (fleet, notices, pay settings). One press must shut the calendar,
     not the form around it — hence the capture-phase listener. */
  it("does not let Escape through to the form around it", async () => {
    const onEsc = jest.fn();
    const user = userEvent.setup();
    render(
      <div onKeyDown={(e) => e.key === "Escape" && onEsc()}>
        <Harness />
      </div>,
    );
    await user.click(screen.getByLabelText("Due"));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onEsc).not.toHaveBeenCalled();
  });

  it("closes on a click outside", async () => {
    const { user, field } = setup();
    await user.click(field());
    await user.click(document.body);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stays open while the calendar itself is clicked", async () => {
    const { user, field } = setup();
    await user.click(field());
    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

/* The shell puts will-change on `.page.in`, which makes it the containing
   block for position:fixed — so the popover has to leave the page entirely,
   inside the `.fg` display:contents wrapper that carries the frame's tokens. */
it("portals the popover to <body> inside a display:contents .fg wrapper", async () => {
  const { user, field } = setup();
  await user.click(field());

  const pop = screen.getByRole("dialog");
  const wrap = pop.parentElement!;
  expect(wrap).toHaveClass("fg");
  expect(wrap.style.display).toBe("contents");
  expect(wrap.parentElement).toBe(document.body);
});
