"use client";

import { Music, Newspaper, Mic2, Megaphone, X, ListMusic } from "lucide-react";
import { useEngineStore } from "@/stores/engine-store";
import { queueApi } from "@/lib/api";
import { cn, formatDuration } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import type { ContentType, QueueItem } from "@/lib/api";

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

export function QueueList() {
  const queue = useEngineStore((s) => s.queue);
  const qc = useQueryClient();

  const handleRemoveOverride = async (item: QueueItem) => {
    if (!item.isOverride) return;
    try {
      await queueApi.removeOverride(item.id);
      qc.invalidateQueries({ queryKey: ["queue"] });
    } catch (e) {
      console.error("Failed to remove override:", e);
    }
  };

  const displayQueue = queue.slice(0, 10);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
      <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">
        Up Next
        {queue.length > 0 && (
          <span className="ml-2 text-zinc-600 font-normal normal-case">
            ({queue.length})
          </span>
        )}
      </h2>

      {displayQueue.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-zinc-700">
          <ListMusic className="w-8 h-8 mb-2" />
          <p className="text-sm">Queue is empty</p>
        </div>
      ) : (
        <ol className="space-y-1">
          {displayQueue.map((item, idx) => {
            const Icon = TYPE_ICONS[item.type];
            const color = TYPE_COLORS[item.type];
            return (
              <li
                key={item.id}
                className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-zinc-800/50 group transition-colors"
              >
                <span className="text-xs text-zinc-600 w-5 text-right tabular-nums shrink-0">
                  {idx + 1}
                </span>
                <Icon className={cn("w-3.5 h-3.5 shrink-0", color)} />
                <span className="flex-1 text-sm text-zinc-300 truncate min-w-0">
                  {item.title}
                  {item.artist && (
                    <span className="text-zinc-500 ml-1">— {item.artist}</span>
                  )}
                </span>
                {item.isOverride && (
                  <span className="text-[9px] font-bold uppercase tracking-wider text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded shrink-0">
                    Override
                  </span>
                )}
                <span className="text-xs text-zinc-600 tabular-nums shrink-0">
                  {formatDuration(item.duration)}
                </span>
                {item.isOverride && (
                  <button
                    onClick={() => handleRemoveOverride(item)}
                    data-testid={`queue-remove-${item.id}`}
                    aria-label={`Remove ${item.title} from queue`}
                    className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-all"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
