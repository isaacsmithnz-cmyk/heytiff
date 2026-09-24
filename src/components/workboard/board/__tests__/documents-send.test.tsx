/* Sending what's ticked — the job card's footer while the Documents face has
   ticks, and the email that opens in it. What this pins: Send to ServiceM8 is
   offered only where an owner switched it on, says what it is doing while it
   waits, and leaves the reason a file didn't go where the count was; the
   email starts from the job's own people and words; nothing is sent to nobody
   or to something that isn't an address; and a deployment with no mail key
   says so instead of pretending. */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { EmailDraft } from "@/app/actions/job-compliance";
import { DocumentsSend } from "../documents-send";

const picked = [
  { key: "p:p1", name: "Public liability" },
  { key: "d:u1", name: "Certificate of compliance.pdf" },
];

const draft: EmailDraft = {
  contacts: [
    { name: "Jane Citizen", email: "jane@abc.com.au", role: "Job contact" },
    { name: null, email: "accounts@abc.com.au", role: "Billing contact" },
  ],
  subject: "Documents for job 2380, 12 Smith St",
  message: "Hi,\n\nPlease find our documents for this job attached.",
  ready: true,
};

const footer = (over: Partial<Parameters<typeof DocumentsSend>[0]> = {}) => {
  const props = {
    picked,
    writing: false,
    onWriting: jest.fn(),
    onLoadDraft: jest.fn(async () => draft),
    onSend: jest.fn(async () => null as string | null),
    ...over,
  };
  render(<DocumentsSend {...props} />);
  return props;
};

describe("the bar", () => {
  it("counts what's ticked and offers email, and no ServiceM8 where it isn't switched on", async () => {
    const props = footer();
    expect(screen.getByText("2 documents ticked")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send to ServiceM8" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Email documents" }));
    expect(props.onWriting).toHaveBeenCalledWith(true);
  });

  /* Isaac: "remove the tick button". A tick comes off where it went on, in
     its box; a send clears its own; and the footer keeps to the ways out. */
  it("has no Clear ticks button", () => {
    footer({ sm8: "live", onSendToSm8: jest.fn(async () => {}) });
    expect(screen.queryByRole("button", { name: "Clear ticks" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Send to ServiceM8", "Email documents"]);
  });

  it("offers Send to ServiceM8 where it's on, and says what it's doing while it waits", async () => {
    let finish: () => void = () => {};
    const onSendToSm8 = jest.fn(() => new Promise<void>((done) => (finish = done)));
    footer({ sm8: "live", onSendToSm8 });
    await userEvent.click(screen.getByRole("button", { name: "Send to ServiceM8" }));
    expect(onSendToSm8).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Sending to ServiceM8…" })).toBeDisabled();
    // nothing else leaves the footer while it waits
    expect(screen.getByRole("button", { name: "Email documents" })).toBeDisabled();
    finish();
    expect(await screen.findByRole("button", { name: "Send to ServiceM8" })).toBeEnabled();
  });

  it("puts why a file didn't go where the count was, in the state's colour", () => {
    footer({ sm8: "live", onSendToSm8: jest.fn(async () => {}), sm8Note: "Plan.pdf wasn't sent. ServiceM8 refused the file." });
    const note = screen.getByText("Plan.pdf wasn't sent. ServiceM8 refused the file.");
    expect(note).toHaveClass("sw-state", "bad");
    expect(screen.queryByText("2 documents ticked")).not.toBeInTheDocument();
  });

  it("is the card's footer, not something floating over the list", () => {
    footer();
    expect(screen.getByText("2 documents ticked").closest(".wb2-shft")).not.toBeNull();
  });
});

describe("the email", () => {
  it("starts from the job's people and its own words, and lists what it attaches", async () => {
    footer({ writing: true });
    expect(await screen.findByRole("checkbox", { name: /Jane Citizen/ })).not.toBeChecked();
    expect(screen.getByText("jane@abc.com.au, job contact")).toBeInTheDocument();
    /* a contact with no name is their address, with what they are */
    expect(screen.getByRole("checkbox", { name: /accounts@abc.com.au/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Subject")).toHaveValue("Documents for job 2380, 12 Smith St");
    expect(screen.getByLabelText("Message")).toHaveValue("Hi,\n\nPlease find our documents for this job attached.");
    expect(screen.getByText("Public liability and Certificate of compliance.pdf")).toBeInTheDocument();
  });

  it("sends to nobody only after saying who", async () => {
    const props = footer({ writing: true });
    await screen.findByLabelText("Subject");
    await userEvent.click(screen.getByRole("button", { name: "Send email" }));
    expect(await screen.findByText("Say who it's going to.")).toBeInTheDocument();
    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("refuses a typed address that isn't one, naming it", async () => {
    const props = footer({ writing: true });
    await userEvent.type(await screen.findByLabelText("Email addresses"), "jane at abc");
    await userEvent.click(screen.getByRole("button", { name: "Send email" }));
    expect(await screen.findByText("jane isn't an email address.")).toBeInTheDocument();
    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("sends to the ticked people and anyone typed, once each, with the words as edited", async () => {
    const props = footer({ writing: true });
    await userEvent.click(await screen.findByRole("checkbox", { name: /Jane Citizen/ }));
    await userEvent.type(screen.getByLabelText("Email addresses"), "mark@abc.com.au, JANE@abc.com.au");
    await userEvent.clear(screen.getByLabelText("Subject"));
    await userEvent.type(screen.getByLabelText("Subject"), "Our insurance");
    await userEvent.click(screen.getByRole("button", { name: "Send email" }));
    expect(props.onSend).toHaveBeenCalledWith({
      to: ["jane@abc.com.au", "mark@abc.com.au"],
      subject: "Our insurance",
      message: "Hi,\n\nPlease find our documents for this job attached.",
    });
  });

  it("keeps the letter and says why when it didn't send", async () => {
    footer({ writing: true, onSend: jest.fn(async () => "The email didn't send. Try again in a minute.") });
    await userEvent.click(await screen.findByRole("checkbox", { name: /Jane Citizen/ }));
    await userEvent.click(screen.getByRole("button", { name: "Send email" }));
    expect(await screen.findByText("The email didn't send. Try again in a minute.")).toBeInTheDocument();
    expect(screen.getByLabelText("Subject")).toBeInTheDocument();
  });

  it("says a deployment with no mail key can't send, rather than pretending", async () => {
    footer({ writing: true, onLoadDraft: jest.fn(async () => ({ ...draft, ready: false })) });
    expect(await screen.findByText("Email isn't set up on this deployment, so nothing can be sent from it.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send email" })).toBeDisabled();
  });

  it("goes back to the bar on Cancel", async () => {
    const props = footer({ writing: true });
    await screen.findByLabelText("Subject");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onWriting).toHaveBeenCalledWith(false);
  });
});
