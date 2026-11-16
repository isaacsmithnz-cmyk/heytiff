import type { NoteSender } from "@/lib/integrations/links";
import { mentionedHandles } from "@/lib/workboard/sm8-mentions";

/* WHICH NOTES THE PHONE OFFERS A REPLY ON (Isaac, 16 November 2026, bug 2 on
   3516: "Unable to reply to comments on this job"). The job sheet's rule
   (board/job-diary-face), for a phone that can't ask "Is <name> you?": a
   note that mentions you, never your own, that ServiceM8 holds, and only
   when you can send as yourself. Each note's key, as the phone keys its
   notes (ServiceM8's uuid for theirs, the row's id for ours), to the
   ServiceM8 uuid the reply answers. Pure. */

type Theirs = { remoteId: string; text: string; authorSm8Uuid?: string | null };
type Ours = { id: string; text: string; sm8Uuid?: string | null; removed?: boolean; mine?: boolean };

export function replyableNotes(sender: NoteSender | null | undefined, theirs: readonly Theirs[], ours: readonly Ours[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!sender || sender.state !== "ready" || !sender.handle) return out;
  const you = sender.handle;
  const asksYou = (text: string) => mentionedHandles(text, [you]).length > 0;
  const me = sender.remoteId.toLowerCase();
  for (const n of theirs) {
    if (n.authorSm8Uuid && n.authorSm8Uuid.toLowerCase() === me) continue;
    if (asksYou(n.text)) out[n.remoteId] = n.remoteId;
  }
  for (const n of ours) {
    if (n.mine || n.removed || !n.sm8Uuid) continue;
    if (asksYou(n.text)) out[n.id] = n.sm8Uuid;
  }
  return out;
}
