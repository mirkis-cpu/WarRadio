"use client";

import { useEngineSocket } from "@/hooks/use-engine-socket";

/**
 * Mounts the Socket.io listener and populates the Zustand store.
 * Rendered in the root layout so it is always active.
 */
export function SocketInitializer() {
  useEngineSocket();
  return null;
}
