"use client";

import { useContext, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/parts/dialog";
import { Button } from "@/components/parts/button";
import { Field, TextInput } from "@/components/parts/field";
import { Tray } from "@/components/parts/tabs";
import { Dot } from "@/components/parts/state";
import { WindowsContext } from "@/components/records/records-context";
import { createInvite, lookupInvitee, type InviteeLookup } from "@/app/actions/invite";
import { ROLE_COPY, ROLE_ORDER, type Role } from "@/lib/roles-shared";

/* ADD A PERSON (v2 forms board, form 7): Team's Add a person, and a card's
   Invite to join from its row. Today's invite under a new layout: the name,
   the address, the role and what the role means, and the invitation sent by
   today's action, createInvite, with every safeguard it had.

   Which roles appear is decided on the server (invitableRoles) and passed
   in; the action re-checks it, because a tray is not a permission. What
   each role means comes from ROLE_COPY, the sentences the staff card's
   Access panel shows, because the choice is made here, often by someone
   who has never opened a staff card.

   THE ADDRESS RESOLVES AS IT IS TYPED. An unclaimed card holding that
   address (imported from ServiceM8, or pre-seeded) is named under the
   field, and the invite carries that card's id, so the two doors (this
   button and a card's own row) never make a duplicate person. `prefill` is
   the row's door: it carries the card id up front. The address stays
   editable either way, since remote systems hold stale ones, and editing it
   re-resolves.

   Saving keeps you on Team with a toast. It has no Undo: the letter has
   gone, and an invitation is withdrawn on the Pending tab, where its link
   is. A letter that did NOT go keeps the form open and says what to do. */

/** Debounce for the resolution: one query per typed address, and the answer
    there before a hand reaches the role. */
const LOOKUP_MS = 400;

const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

/* One line, in the reader's terms, about what pressing the button will do.
   `look` is the ambiguity and the two dead ends, where the button is about
   to do something other than what the reader expects. */
function resolutionOf(found: InviteeLookup): { tone: "good" | "look"; text: string } | null {
  switch (found.kind) {
    case "card":
      return {
        tone: "good",
        text: found.name
          ? `Attaches to ${found.name}'s card${found.importedFrom ? ` (from ${found.importedFrom})` : ""}, no second record.`
          : "Attaches to the card already holding this address, no second record.",
      };
    case "member":
      return {
        tone: "look",
        text: found.name ? `${found.name} already has an account here.` : "That person already has an account here.",
      };
    case "pending":
      return { tone: "look", text: "An invitation is already open for this address. Renew it from the Pending tab." };
    case "ambiguous":
      return {
        tone: "look",
        text: `${found.count} unclaimed cards hold this address, so none will be attached. Merge them first, or this makes a third record.`,
      };
    default:
      return null;
  }
}

export type InvitePrefill = {
  email?: string;
  /** The unclaimed card this invite should claim on acceptance. */
  staffProfileId?: string;
  /** Whose card it attaches to, said under the title. */
  name?: string;
};

export function PersonForm({ roles, onClose, prefill }: { roles: string[]; onClose: () => void; prefill?: InvitePrefill }) {
  const router = useRouter();
  const host = useContext(WindowsContext);
  const [name, setName] = useState("");
  const [email, setEmail] = useState(prefill?.email ?? "");
  const [role, setRole] = useState(roles.includes("staff") ? "staff" : (roles[0] ?? "staff"));
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [found, setFound] = useState<InviteeLookup | null>(null);

  /* Resolve the address, debounced, and DROP A LATE ANSWER: a slow reply for
     a half-typed address must never land after the finished one's and
     describe somebody else. Clearing the stale line is the field's own act,
     in its onChange. */
  useEffect(() => {
    const typed = email.trim();
    if (!looksLikeEmail(typed)) return;
    let live = true;
    const t = setTimeout(() => {
      void lookupInvitee(typed).then((res) => {
        if (live) setFound(res);
      });
    }, LOOKUP_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [email]);

  /* THE CARD, IF THERE IS ONE, DECIDES THE NAME, so the field goes rather
     than being ignored: the action discards a name typed for a card. */
  const attachTo = prefill?.staffProfileId ?? (found?.kind === "card" ? found.staffProfileId : undefined);

  const submit = () => {
    if (!email.trim() || busy) return;
    setError(null);
    start(async () => {
      /* The resolved card rides the submit, so the line that says "attaches
         to Dan's card" is the button that does it; the row's card wins where
         both exist. No name is undefined, never "". */
      const res = await createInvite({
        email,
        role,
        name: name.trim() || undefined,
        staffProfileId: attachTo,
      });
      if (!res.ok) return setError(res.error);

      /* The invitation exists either way; a letter that didn't go changes
         what the inviter does next, so the form stays and says so. */
      if (res.delivery && !res.delivery.sent) {
        setError(
          res.delivery.reason === "unconfigured"
            ? "Invite created. Email isn't set up in this environment, so copy the link from the Pending invites tab."
            : `Invite created, but the email to ${res.delivery.to} didn't send. Copy the link from the Pending invites tab.`,
        );
        router.refresh();
        return;
      }

      onClose();
      router.refresh();
      host?.toast(`Invite sent to ${res.delivery?.to ?? email.trim().toLowerCase()}`);
    });
  };

  const resolution = found ? resolutionOf(found) : null;
  const offered = ROLE_ORDER.filter((r) => roles.includes(r));
  const meaning = ROLE_COPY[role as Role]?.blurb;

  return (
    <Dialog
      heading="Add a person"
      width={560}
      onClose={onClose}
      foot={
        <>
          <Button kind="second" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="main" onClick={submit} disabled={busy || !email.trim()}>
            {busy ? "Sending the invite" : "Send invite"}
          </Button>
        </>
      }
    >
      <form
        className="mk-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onKeyDown={(e) => {
          /* Enter in a field sends, as the old form's did */
          if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
            e.preventDefault();
            submit();
          }
        }}
      >
        {prefill?.name && <p className="mk-records-lead">Their account attaches to {prefill.name}&apos;s card when they accept.</p>}
        {!attachTo && (
          <Field label="Name">
            <TextInput value={name} autoComplete="off" data-autofocus onChange={(e) => setName(e.target.value)} />
          </Field>
        )}
        <Field label="Email address" error={error}>
          <TextInput
            type="email"
            value={email}
            autoComplete="off"
            invalid={!!error}
            data-autofocus={attachTo ? true : undefined}
            onChange={(e) => {
              setEmail(e.target.value);
              // the line described the OLD address; it is wrong from this key on
              setFound(null);
            }}
          />
          {resolution && (
            <p className={`mk-records-res mk-records-res--${resolution.tone}`}>
              <Dot hue={resolution.tone === "good" ? "green" : "orange"} />
              {resolution.text}
            </p>
          )}
        </Field>
        <div className="pt-field">
          <span className="pt-field-label">Role</span>
          <Tray options={offered.map((r) => ({ value: r, label: ROLE_COPY[r].label }))} value={role as Role} onChange={setRole} ariaLabel="Role" />
          {meaning && <p className="mk-records-sub">{meaning}</p>}
        </div>
      </form>
    </Dialog>
  );
}

/** Team's Add a person: a server page can't hold the form's open state. */
export function AddPersonButton({ roles }: { roles: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button kind="main" icon="plus" onClick={() => setOpen(true)}>
        Add a person
      </Button>
      {open && <PersonForm roles={roles} onClose={() => setOpen(false)} />}
    </>
  );
}
