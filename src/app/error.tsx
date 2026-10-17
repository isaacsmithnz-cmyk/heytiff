"use client";

import { WrongPage } from "@/components/parts/wrong-page";

/* An error outside the dashboard (rule 42); the dashboard has its own, so
   its frame stays. Next 16 hands a boundary `unstable_retry`, which fetches
   the segment again, where `reset` only draws it again: retry when it is
   there. An error in the root layout itself would need global-error. */
export default function RootError({
  error,
  reset,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  unstable_retry?: () => void;
}) {
  return <WrongPage error={error} retry={unstable_retry ?? reset} />;
}
