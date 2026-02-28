"use client";

import { useQuery } from "@tanstack/react-query";
import { pipelineApi } from "@/lib/api";
import { useEngineStore } from "@/stores/engine-store";
import { cn } from "@/lib/utils";
import { Loader2, Play, RefreshCw } from "lucide-react";
import type { PipelineStage } from "@/lib/api";

const STAGE_META: Record<
  PipelineStage,
  { label: string; description: string }
> = {
  rss_fetch: { label: "RSS Fetch", description: "Pulling news feeds" },
  tts: { label: "TTS", description: "Text-to-speech synthesis" },
  audio_process: { label: "Audio", description: "Processing audio files" },
  queue_fill: { label: "Queue Fill", description: "Filling playback queue" },
  stream: { label: "Stream", description: "Streaming to output" },
};

const STAGE_ORDER: PipelineStage[] = [
  "rss_fetch",
  "tts",
  "audio_process",
  "queue_fill",
  "stream",
];

function StatusDot({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "w-2.5 h-2.5 rounded-full shrink-0",
        status === "running"
          ? "bg-green-400 animate-pulse"
          : status === "done"
          ? "bg-green-500"
          : status === "error"
          ? "bg-red-500"
          : "bg-zinc-700"
      )}
    />
  );
}

export function PipelineHealth() {
  const storeJobs = useEngineStore((s) => s.pipelineJobs);
  const { data, isLoading } = useQuery({
    queryKey: ["pipeline"],
    queryFn: pipelineApi.getPipeline,
    refetchInterval: 10_000,
  });

  const handleTriggerSong = async () => {
    try {
      await pipelineApi.triggerSong();
    } catch (e) {
      console.error(e);
    }
  };

  const handleTriggerNews = async () => {
    try {
      await pipelineApi.triggerNews();
    } catch (e) {
      console.error(e);
    }
  };

  // Merge server data with real-time socket updates
  const jobMap = new Map<string, { stage: string; status: string; progress?: number; error?: string }>();
  data?.jobs.forEach((j) => jobMap.set(j.stage, j));
  storeJobs.forEach((j) => jobMap.set(j.stage, j));

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">
          Pipeline
        </h2>
        <div className="flex gap-2">
          <button
            onClick={handleTriggerSong}
            data-testid="pipeline-trigger-song"
            aria-label="Trigger song pipeline"
            className="flex items-center gap-1 text-[10px] font-medium text-violet-400 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/20 px-2 py-1 rounded transition-colors"
          >
            <Play className="w-3 h-3" />
            Song
          </button>
          <button
            onClick={handleTriggerNews}
            data-testid="pipeline-trigger-news"
            aria-label="Trigger news pipeline"
            className="flex items-center gap-1 text-[10px] font-medium text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 px-2 py-1 rounded transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            News
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="w-5 h-5 text-zinc-600 animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {STAGE_ORDER.map((stage) => {
            const meta = STAGE_META[stage];
            const job = jobMap.get(stage);
            const status = job?.status ?? "pending";
            const progress = job?.progress;

            return (
              <div
                key={stage}
                className="flex items-center gap-3 px-3 py-2.5 bg-zinc-950/60 rounded-lg border border-zinc-800/60"
              >
                <StatusDot status={status} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-zinc-300">
                      {meta.label}
                    </span>
                    <span
                      className={cn(
                        "text-[10px] font-medium uppercase tracking-wider",
                        status === "running"
                          ? "text-green-400"
                          : status === "done"
                          ? "text-green-500"
                          : status === "error"
                          ? "text-red-400"
                          : "text-zinc-600"
                      )}
                    >
                      {status === "running" && progress !== undefined
                        ? `${progress}%`
                        : status}
                    </span>
                  </div>
                  {status === "running" && progress !== undefined && (
                    <div className="mt-1.5 h-1 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500 rounded-full transition-all duration-500"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  )}
                  {status === "error" && job?.error && (
                    <p className="text-[10px] text-red-400 mt-0.5 truncate">
                      {job.error}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
