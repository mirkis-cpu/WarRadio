"use client";

import { useCallback } from "react";
import { Play, Pause, Square, Music, Newspaper, Mic2, Megaphone } from "lucide-react";
import { useEngineStore } from "@/stores/engine-store";
import { engineApi } from "@/lib/api";
import { cn, formatDuration } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import type { ContentType } from "@/lib/api";

const TYPE_CONFIG: Record<
  ContentType,
  { label: string; color: string; bg: string; Icon: React.ElementType }
> = {
  song: {
    label: "Song",
    color: "text-violet-400",
    bg: "bg-violet-500/20 border-violet-500/30",
    Icon: Music,
  },
  news: {
    label: "News",
    color: "text-amber-400",
    bg: "bg-amber-500/20 border-amber-500/30",
    Icon: Newspaper,
  },
  podcast: {
    label: "Podcast",
    color: "text-blue-400",
    bg: "bg-blue-500/20 border-blue-500/30",
    Icon: Mic2,
  },
  ad: {
    label: "Ad",
    color: "text-green-400",
    bg: "bg-green-500/20 border-green-500/30",
    Icon: Megaphone,
  },
};

export function NowPlayingBar() {
  const nowPlaying = useEngineStore((s) => s.nowPlaying);
  const engineStatus = useEngineStore((s) => s.engineStatus);
  const qc = useQueryClient();

  const isPlaying = engineStatus?.state === "playing";
  const isPaused = engineStatus?.state === "paused";

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["engine-status"] });
  }, [qc]);

  const handlePlay = async () => {
    try {
      await engineApi.start();
      invalidate();
    } catch (e) {
      console.error("Failed to start engine:", e);
    }
  };

  const handlePause = async () => {
    try {
      await engineApi.pause();
      invalidate();
    } catch (e) {
      console.error("Failed to pause engine:", e);
    }
  };

  const handleStop = async () => {
    try {
      await engineApi.stop();
      invalidate();
    } catch (e) {
      console.error("Failed to stop engine:", e);
    }
  };

  const progress =
    nowPlaying && nowPlaying.duration > 0
      ? (nowPlaying.elapsed / nowPlaying.duration) * 100
      : 0;

  const typeConfig = nowPlaying
    ? TYPE_CONFIG[nowPlaying.type]
    : null;

  return (
    <div className="fixed bottom-0 left-[220px] right-0 h-[72px] bg-zinc-950/95 border-t border-zinc-800 backdrop-blur-sm flex items-center px-5 gap-5 z-30">
      {/* Type icon + track info */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {nowPlaying && typeConfig ? (
          <>
            <div
              className={cn(
                "flex items-center justify-center w-10 h-10 rounded-lg border shrink-0",
                typeConfig.bg
              )}
            >
              <typeConfig.Icon
                className={cn("w-5 h-5", typeConfig.color)}
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded border",
                    typeConfig.bg,
                    typeConfig.color
                  )}
                >
                  {typeConfig.label}
                </span>
              </div>
              <div className="text-sm font-semibold text-zinc-100 truncate mt-0.5">
                {nowPlaying.title}
              </div>
              {nowPlaying.artist && (
                <div className="text-xs text-zinc-500 truncate">
                  {nowPlaying.artist}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="text-sm text-zinc-600 italic">Nothing playing</div>
        )}
      </div>

      {/* Progress bar + time */}
      <div className="flex-1 max-w-md hidden sm:block">
        <div className="relative h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className={cn(
              "absolute left-0 top-0 h-full rounded-full transition-all duration-1000",
              typeConfig ? typeConfig.color.replace("text-", "bg-") : "bg-zinc-600"
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[10px] text-zinc-500 tabular-nums">
            {nowPlaying ? formatDuration(nowPlaying.elapsed) : "0:00"}
          </span>
          <span className="text-[10px] text-zinc-500 tabular-nums">
            {nowPlaying ? formatDuration(nowPlaying.duration) : "0:00"}
          </span>
        </div>
      </div>

      {/* Engine controls */}
      <div className="flex items-center gap-2 shrink-0">
        {isPlaying ? (
          <button
            onClick={handlePause}
            data-testid="engine-pause-btn"
            aria-label="Pause engine"
            className="flex items-center justify-center w-9 h-9 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-zinc-100 transition-colors"
          >
            <Pause className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={handlePlay}
            data-testid="engine-play-btn"
            aria-label="Start engine"
            className="flex items-center justify-center w-9 h-9 rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition-colors"
          >
            <Play className="w-4 h-4 fill-current" />
          </button>
        )}

        {(isPlaying || isPaused) && (
          <button
            onClick={handleStop}
            data-testid="engine-stop-btn"
            aria-label="Stop engine"
            className="flex items-center justify-center w-9 h-9 rounded-lg bg-zinc-800 hover:bg-red-900/60 text-zinc-400 hover:text-red-400 transition-colors"
          >
            <Square className="w-4 h-4 fill-current" />
          </button>
        )}
      </div>
    </div>
  );
}
