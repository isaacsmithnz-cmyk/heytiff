"use client";

/* WHICH STUDIO FLOW IS RUNNING (Isaac, 29 October 2026: "write the code
   locally in your own section to test out the new flow").

   "next" is the reworked flow on the Studio rework mocks
   (https://claude.ai/artifact/Dohqw25XUuCwkHYcxLeWTU): one scale and north
   for a set, rooms on the plan, the room panel, paper that matches the
   canvas. Since 7 November 2026 it is what ships: the Design page, its PDFs
   and the customer's share link all run it (Isaac: "everyone. Again, we're
   only in testing stage"). "current" is the flow before it, kept for
   /studio-next?flow=current until its screens are taken out. Both run off
   the same document and engines, so a design opens in either; only the
   screens differ. Each piece the next flow replaced goes with this switch. */

import { createContext, useContext } from "react";

export type StudioFlow = "current" | "next";

export const StudioFlowContext = createContext<StudioFlow>("current");

export const useStudioFlow = (): StudioFlow => useContext(StudioFlowContext);
