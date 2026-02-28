"use client";

import { useEffect, useState } from "react";
import { Music, Newspaper, Mic2, Megaphone, Activity } from "lucide-react";
import { getSocket } from "@/lib/socket-client";
import { cn, formatDuration } from "@/lib/utils";
import type { ContentType, NowPlaying } from "@/lib/api";
import { format } from "date-fns";

interface ActivityEntry {
  id: string;
  type: ContentType;
  title: string;
  artist?: string;
  duration: number;
  playedAt: Date;
}

const TYPE_ICONS: Record<ContentType, React.ElementType> = {
  song: Music,
  news: Newspaper,
  podcast: Mic2,
  ad: Megaphone,
};

const TYPE_COLORS: Record<ContentType, string> = {
  song: "text-violet-400",
  news: "text-amber-400",
  podcast: "text-blue-400",
  ad: "text-green-400",
};

export function ActivityFeed() {
  const [feed, setFeed] = useState<ActivityEntry[]>([]);

  useEffect(() => {
    const socket = getSocket();

    function onNowPlayingChanged(data: NowPlaying) {
      setFeed((prev) => [
        {
          id: `${data.id}-${Date.now()}`,
          type: data.type,
          title: data.title,
          artist: data.artist,
          duration: data.duration,
          playedAt: new Date(),
        },
        ...prev,
      ].slice(0, 30));
    }

    socket.on("now-playing:changed", onNowPlayingChanged);
    return () => {
      socket.off("now-playing:changed", onNowPlayingChanged);
    };
  }, []);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col">
      <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">
        Activity Feed
      </h2>

      {feed.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 py-8 text-zinc-700">
          <Activity className="w-8 h-8 mb-2" />
          <p className="text-sm">Waiting for playback events&hellip;</p>
        </div>
      ) : (
        <ul className="space-y-1 overflow-y-auto max-h-72">
          {feed.map((entry) => {
            const Icon = TYPE_ICONS[entry.type];
            const color = TYPE_COLORS[entry.type];
            return (
              <li
                key={entry.id}
                className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-zinc-800/40 transition-colors"
              >
                <Icon className={cn("w-3.5 h-3.5 shrink-0", color)} />
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-zinc-300 truncate block">
                    {entry.title}
                    {entry.artist && (
                      <span className="text-zinc-500"> — {entry.artist}</span>
                    )}
                  </span>
                </div>
                <span className="text-[10px] text-zinc-600 tabular-nums shrink-0">
                  {formatDuration(entry.duration)}
                </span>
                <span className="text-[10px] text-zinc-700 tabular-nums shrink-0">
                  {format(entry.playedAt, "HH:mm")}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
