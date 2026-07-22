import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SystemMap } from "../system-map";

/* Board + inspector behaviour. Wire geometry itself is jsdom-invisible (all
   rects are 0×0), so these tests cover what the DOM can prove: every registry
   node renders, selection drives the inspector, and lineage jumps work.
   Node names can also appear as group headers or inspector rows, so board
   queries pin to the card-name span. */

const cardName = (name: string) =>
  screen.getByText(name, { selector: ".hq-map-node-name" });

describe("SystemMap", () => {
  it("renders every layer column and node card", () => {
    render(<SystemMap />);
    expect(screen.getByText("Features & surfaces")).toBeInTheDocument();
    expect(screen.getByText("Engines & shared logic")).toBeInTheDocument();
    expect(screen.getByText("Data & services")).toBeInTheDocument();
    expect(cardName("Design Studio")).toBeInTheDocument();
    expect(cardName("Rate Calculator")).toBeInTheDocument();
    expect(cardName("Heat-load engine")).toBeInTheDocument();
    expect(cardName("rate_calc_state")).toBeInTheDocument();
  });

  it("starts with the legend and the standalone list", () => {
    render(<SystemMap />);
    expect(screen.getByText("How to read this")).toBeInTheDocument();
    expect(screen.getByText("Standalone pieces")).toBeInTheDocument();
    // Fault Finder shows on the board and in the standalone list
    expect(screen.getAllByText("Fault Finder").length).toBe(2);
  });

  it("selecting a node opens its inspector with lineage", async () => {
    const user = userEvent.setup();
    render(<SystemMap />);
    await user.click(cardName("Rate Calculator"));
    // inspector shows the lineage lists with labelled edges
    expect(screen.getByText("Draws from")).toBeInTheDocument();
    expect(screen.getByText("cost build-up → charge-out rates")).toBeInTheDocument();
    // the planned Time & Pay pull is present and marked planned
    expect(screen.getByText("pull real wages & hours into rate inputs")).toBeInTheDocument();
    expect(screen.getAllByText(/planned/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Open Rate Calculator ↗")).toBeInTheDocument();
  });

  it("jumping via a connection re-selects the other node", async () => {
    const user = userEvent.setup();
    render(<SystemMap />);
    await user.click(cardName("Rate Calculator"));
    await user.click(
      screen.getByRole("button", { name: /pull real wages & hours into rate inputs/ })
    );
    expect(screen.getByText("Open Time & Pay ↗")).toBeInTheDocument();
  });

  it("a standalone selection says so", async () => {
    const user = userEvent.setup();
    render(<SystemMap />);
    await user.click(cardName("Fault Finder"));
    expect(screen.getByText(/no wires in or out/i)).toBeInTheDocument();
  });
});
