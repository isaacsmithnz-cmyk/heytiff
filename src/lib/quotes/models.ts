/* The model a job's visit tasks are written with (visit-tasks-server.ts).
   Pure, so a reader of the name loads nothing else. */

export const MODEL = "claude-opus-5-5";
/* If the model declines on policy grounds, the API re-runs the same request
   on this one inside the same call rather than returning nothing. */
export const FALLBACK_MODEL = "claude-opus-4-8";
