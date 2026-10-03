"use client";

import { useCallback, useState } from "react";
import type { PreValidation } from "@/lib/staff/pre-validate";
import { withCleanup } from "@/lib/ui/with-cleanup";
import type { SaveResult } from "./types";

/* One card's save cycle: pre-flight, in-flight, and what came back.

   It deliberately owns NO field values. The draft lives in SectionCard, so a
   failed save leaves what the user typed exactly where it was — the old
   handler read values out of DOM nodes that a re-render had already replaced,
   which is how a rejected save used to lose them. */

export type SectionSave = {
  saving: boolean;
  error: string | null;
  /** column names the save choked on — the fields to mark */
  fieldErrors: string[];
  /** true when it saved; false when the card should stay in edit mode */
  submit: (fields: Record<string, string>) => Promise<boolean>;
  clear: () => void;
};

const NETWORK_ERROR = "Couldn’t save — check your connection and try again.";

/* out here, not inside submit's try: React Compiler 1.0 cannot lower a `??`
   inside a try/catch, and gives up on the whole hook when it meets one */
const fieldsOf = (res: Extract<SaveResult, { ok: false }>) => res.fields ?? [];

export function useSectionSave(
  onSave?: (fields: Record<string, string>) => Promise<SaveResult>,
  /** the same pure builder the action runs — see lib/staff/pre-validate */
  validate?: (fields: Record<string, string>) => PreValidation | null
): SectionSave {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);

  const clear = useCallback(() => {
    setError(null);
    setFieldErrors([]);
  }, []);

  const submit = useCallback(
    async (fields: Record<string, string>): Promise<boolean> => {
      const bad = validate?.(fields) ?? null;
      if (bad) {
        // never left the browser — the action is not called at all
        setError(bad.error);
        setFieldErrors(bad.fields);
        return false;
      }
      clear();
      if (!onSave) return true;

      setSaving(true);
      return withCleanup(async () => {
        try {
          const res = await onSave(fields);
          if (res.ok) return true;
          setError(res.error);
          setFieldErrors(fieldsOf(res));
          return false;
        } catch {
          setError(NETWORK_ERROR);
          return false;
        }
      }, () => setSaving(false));
    },
    [onSave, validate, clear]
  );

  return { saving, error, fieldErrors, submit, clear };
}
