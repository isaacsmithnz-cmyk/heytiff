"use client";

import { WrongPage } from "@/components/parts/wrong-page";

/* An error on a dashboard screen stops here, under the dashboard layout,
   so the sidebar and the header stay and you can go somewhere else (rule
   42). Without it the root's error.tsx would take the frame with it. */
export default function DashboardError({
  error,
  reset,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  unstable_retry?: () => void;
}) {
  return <WrongPage error={error} retry={unstable_retry ?? reset} as="div" />;
}
