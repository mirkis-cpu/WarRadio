"use client";

import { Music, Newspaper, Mic2, Megaphone, Radio } from "lucide-react";
import { useEngineStore } from "@/stores/engine-store";
import { cn, formatDuration } from "@/lib/utils";
import type { ContentType } from "@/lib/api";

const TYPE_CONFIG: Record<
  ContentType,
  { label: string; color: string; border: string; bg: string; Icon: React.ElementType }
> = {
  song: {
    label: "Song",
    color: "text-violet-400",
    border: "border-violet-500/40",
    bg: "bg-violet-500/10",
    Icon: Music,
  },
  news: {
    label: "News",
    color: "text-amber-400",
    border: "border-amber-500/40",
    bg: "bg-amber-500/10",
    Icon: Newspaper,
  },
  podcast: {
    label: "Podcast",
    color: "text-blue-400",
    border: "border-blue-500/40",
    bg: "bg-blue-500/10",
    Icon: Mic2,
  },
  ad: {
    label: "Ad",
    color: "text-green-400",
    border: "border-green-500/40",
    bg: "bg-green-500/10",
    Icon: Megaphone,
  },
};

export function NowPlayingWidget() {
  const nowPlaying = useEngineStore((s) => s.nowPlaying);
  const engineStatus = useEngineStore((s) => s.engineStatus);

  const typeConfig = nowPlaying ? TYPE_CONFIG[nowPlaying.type] : null;
  const progress =
    nowPlaying && nowPlaying.duration > 0
      ? (nowPlaying.elapsed / nowPlaying.duration) * 100
      : 0;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
      <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">
        Now Playing
      </h2>

      {nowPlaying && typeConfig ? (
        <div>
          {/* Type badge + icon */}
          <div className="flex items-center gap-3 mb-4">
            <div
              className={cn(
                "flex items-center justify-center w-14 h-14 rounded-xl border",
                typeConfig.bg,
                typeConfig.border
              )}
            >
              <typeConfig.Icon className={cn("w-7 h-7", typeConfig.color)} />
            </div>
            <div>
              <span
                className={cn(
                  "text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border",
                  typeConfig.bg,
                  typeConfig.color,
                  typeConfig.border
                )}
              >
                {typeConfig.label}
              </span>
              <div className="text-lg font-bold text-zinc-100 mt-1 leading-tight">
                {nowPlaying.title}
              </div>
              {nowPlaying.artist && (
                <div className="text-sm text-zinc-400">{nowPlaying.artist}</div>
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div className="space-y-1">
            <div className="relative h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={cn(
                  "absolute left-0 top-0 h-full rounded-full transition-all duration-1000",
                  typeConfig.color.replace("text-", "bg-")
                )}
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-zinc-500 tabular-nums">
              <span>{formatDuration(nowPlaying.elapsed)}</span>
              <span>{formatDuration(nowPlaying.duration)}</span>
            </div>
          </div>

          {/* Engine state pill */}
          {engineStatus && (
            <div className="mt-3 flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full",
                  engineStatus.state === "playing"
                    ? "bg-green-500/15 text-green-400"
                    : engineStatus.state === "paused"
                    ? "bg-amber-500/15 text-amber-400"
                    : "bg-zinc-800 text-zinc-500"
                )}
              >
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    engineStatus.state === "playing"
                      ? "bg-green-400 animate-pulse"
                      : engineStatus.state === "paused"
                      ? "bg-amber-400"
                      : "bg-zinc-600"
                  )}
                />
                {engineStatus.state.charAt(0).toUpperCase() +
                  engineStatus.state.slice(1)}
              </span>
              {engineStatus.listeners > 0 && (
                <span className="text-xs text-zinc-500">
                  {engineStatus.listeners} listener
                  {engineStatus.listeners !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-8 text-zinc-600">
          <Radio className="w-10 h-10 mb-3" />
          <p className="text-sm">Engine is idle</p>
        </div>
      )}
    </div>
  );
}
