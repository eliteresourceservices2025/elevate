"use client";

import type { ReactNode } from "react";
import { CallOverlays } from "./call-overlays";
import { CallProvider } from "./call-provider";

/** The guest's page frame gets the same call support as the staff frame: a guest can be rung for a client group's call and join it. */
export function GuestCallFrame({ userId, children }: { userId: string; children: ReactNode }) {
  return (
    <CallProvider userId={userId}>
      {children}
      <CallOverlays />
    </CallProvider>
  );
}
