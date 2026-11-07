import { fireEvent, render, screen } from "@testing-library/react";
import { AddedRows } from "../quote-rail";

/* what's landed on the job since the quote was priced, on the rail */
const items = [
  { text: "New trunking in unit 2", from: "Isaac Smith's note" },
  { text: "Condensate pump in unit 12", from: "Isaac Smith's note" },
];

it("shows nothing when nothing has landed", () => {
  const { container } = render(<AddedRows items={[]} onLeave={jest.fn()} onPrice={jest.fn()} />);
  expect(container).toBeEmptyDOMElement();
});

it("says how many, where each came from, and offers both acts", () => {
  const onLeave = jest.fn();
  const onPrice = jest.fn();
  render(<AddedRows items={items} onLeave={onLeave} onPrice={onPrice} />);
  expect(screen.getByRole("heading", { name: "2 added since it was priced" })).toBeInTheDocument();
  expect(screen.getAllByText("Isaac Smith's note")).toHaveLength(2);
  fireEvent.click(screen.getAllByRole("button", { name: "Leave out" })[1]);
  expect(onLeave).toHaveBeenCalledWith("Condensate pump in unit 12");
  fireEvent.click(screen.getByRole("button", { name: "Price them" }));
  expect(onPrice).toHaveBeenCalledTimes(1);
});

it("after it's sent, offers Update quote in place of Price them", () => {
  const onPrice = jest.fn();
  render(<AddedRows items={items} since="sent" onLeave={jest.fn()} onPrice={onPrice} />);
  expect(screen.getByRole("heading", { name: "2 added since it was sent" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Price them" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Update quote" }));
  expect(onPrice).toHaveBeenCalledTimes(1);
});
