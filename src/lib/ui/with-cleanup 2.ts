/* `try { … } finally { … }` written as a call, because React Compiler 1.0
   cannot lower a try with a finalizer and gives up on the WHOLE component
   when it meets one — a busy flag around one `await` was quietly costing a
   dozen screens their memoization.

   Spelling the cleanup out on both exits instead works, but it stops working
   the first time someone adds an early `return` inside the try, and half of
   these bodies already have one. Here the `finally` is REAL — it lives in a
   plain module the compiler never has to lower — so every exit still runs it,
   including a `return` from `work` and a throw.

   A `return` inside `work` leaves `work`, not the caller. That is the same
   thing only while nothing follows the old try/finally in the caller; every
   site converted so far ended there. Check before you convert another. */
export async function withCleanup(
  work: () => Promise<void>,
  cleanup: () => void
): Promise<void> {
  try {
    await work();
  } finally {
    cleanup();
  }
}
