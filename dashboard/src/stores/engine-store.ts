import { create } from "zustand";
import type { EngineStatus, NowPlaying, QueueItem, BufferStatus } from "@/lib/api";

export type AlertSeverity = "info" | "warning" | "error";

export interface Alert {
  id: string;
  severity: AlertSeverity;
  message: string;
  timestamp: number;
}

export interface PipelineJobUpdate {
  id: string;
  stage: string;
  status: "pending" | "running" | "done" | "error";
  progress?: number;
  error?: string;
}

interface EngineState {
  // Server state
  engineStatus: EngineStatus | null;
  nowPlaying: NowPlaying | null;
  queue: QueueItem[];
  bufferStatus: BufferStatus | null;
  alerts: Alert[];
  pipelineJobs: PipelineJobUpdate[];
  socketConnected: boolean;

  // Actions
  setEngineStatus: (status: EngineStatus) => void;
  setNowPlaying: (track: NowPlaying | null) => void;
  setQueue: (queue: QueueItem[]) => void;
  setBufferStatus: (status: BufferStatus) => void;
  setSocketConnected: (connected: boolean) => void;
  updatePipelineJob: (job: PipelineJobUpdate) => void;
  addAlert: (severity: AlertSeverity, message: string) => void;
  dismissAlert: (id: string) => void;
}

export const useEngineStore = create<EngineState>()((set) => ({
  engineStatus: null,
  nowPlaying: null,
  queue: [],
  bufferStatus: null,
  alerts: [],
  pipelineJobs: [],
  socketConnected: false,

  setEngineStatus: (status) => set({ engineStatus: status }),

  setNowPlaying: (track) => set({ nowPlaying: track }),

  setQueue: (queue) => set({ queue }),

  setBufferStatus: (status) => set({ bufferStatus: status }),

  setSocketConnected: (connected) => set({ socketConnected: connected }),

  updatePipelineJob: (job) =>
    set((state) => {
      const existing = state.pipelineJobs.findIndex((j) => j.id === job.id);
      if (existing >= 0) {
        const updated = [...state.pipelineJobs];
        updated[existing] = job;
        return { pipelineJobs: updated };
      }
      return { pipelineJobs: [...state.pipelineJobs, job] };
    }),

  addAlert: (severity, message) =>
    set((state) => ({
      alerts: [
        ...state.alerts,
        {
          id: `alert-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          severity,
          message,
          timestamp: Date.now(),
        },
      ].slice(-50), // keep at most 50
    })),

  dismissAlert: (id) =>
    set((state) => ({
      alerts: state.alerts.filter((a) => a.id !== id),
    })),
}));
