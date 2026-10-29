"use client";

/* WHICH STUDIO FLOW IS RUNNING (Isaac, 29 October 2026: "write the code
   locally in your own section to test out the new flow").

   "current" is the Studio as it ships. "next" is the reworked flow on the
   Studio rework mocks (https://claude.ai/artifact/Dohqw25XUuCwkHYcxLeWTU):
   one scale and north for a set, rooms on the plan, the room panel, paper
   that matches the canvas. Both run off the same document and engines, so a
   design opens in either; only the screens differ. When the next flow is
   approved, each piece it replaces is deleted with this switch. */

import { createContext, useContext } from "react";

export type StudioFlow = "current" | "next";

export const StudioFlowContext = createContext<StudioFlow>("current");

export const useStudioFlow = (): StudioFlow => useContext(StudioFlowContext);
