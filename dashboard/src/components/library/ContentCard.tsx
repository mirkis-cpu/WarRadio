"use client";

import { useState } from "react";
import {
  Music,
  Newspaper,
  Mic2,
  Megaphone,
  Play,
  Pause,
  Trash2,
  MoreVertical,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { contentApi } from "@/lib/api";
import { cn, formatDuration, formatBytes } from "@/lib/utils";
import type { ContentItem, ContentType } from "@/lib/api";

const TYPE_CONFIG: Record<
  ContentType,
  { icon: React.ElementType; color: string; bg: string; border: string; label: string }
> = {
  song: {
    icon: Music,
    color: "text-violet-400",
    bg: "bg-violet-500/15",
    border: "border-violet-500/30",
    label: "Song",
  },
  news: {
    icon: Newspaper,
    color: "text-amber-400",
    bg: "bg-amber-500/15",
    border: "border-amber-500/30",
    label: "News",
  },
  podcast: {
    icon: Mic2,
    color: "text-blue-400",
    bg: "bg-blue-500/15",
    border: "border-blue-500/30",
    label: "Podcast",
  },
  ad: {
    icon: Megaphone,
    color: "text-green-400",
    bg: "bg-green-500/15",
    border: "border-green-500/30",
    label: "Ad",
  },
};

const STATUS_STYLES: Record<string, string> = {
  active: "bg-green-500/15 text-green-400 border-green-500/25",
  inactive: "bg-zinc-800 text-zinc-500 border-zinc-700",
  processing: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  error: "bg-red-500/15 text-red-400 border-red-500/25",
};

interface ContentCardProps {
  item: ContentItem;
  onDeleted: (id: string) => void;
}

export function ContentCard({ item, onDeleted }: ContentCardProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);

  const cfg = TYPE_CONFIG[item.type];

  const handlePreview = () => {
    if (isPlaying && audioEl) {
      audioEl.pause();
      audioEl.currentTime = 0;
      setIsPlaying(false);
      setAudioEl(null);
      return;
    }
    const audio = new Audio(item.fileUrl);
    audio.play();
    audio.onended = () => {
      setIsPlaying(false);
      setAudioEl(null);
    };
    setIsPlaying(true);
    setAudioEl(audio);
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${item.title}"?`)) return;
    try {
      await contentApi.deleteContent(item.id);
      onDeleted(item.id);
    } catch (e) {
      console.error("Delete failed:", e);
    }
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden hover:border-zinc-700 transition-colors group">
      {/* Type color header */}
      <div className={cn("h-1.5", cfg.color.replace("text-", "bg-"))} />

      <div className="p-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div
            className={cn(
              "flex items-center justify-center w-9 h-9 rounded-lg border shrink-0",
              cfg.bg,
              cfg.border
            )}
          >
            <cfg.icon className={cn("w-4.5 h-4.5", cfg.color)} />
          </div>

          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "text-[10px] font-semibold px-1.5 py-0.5 rounded border",
                cfg.bg,
                cfg.color,
                cfg.border
              )}
            >
              {cfg.label}
            </span>
            <span
              className={cn(
                "text-[10px] font-medium px-1.5 py-0.5 rounded border capitalize",
                STATUS_STYLES[item.status]
              )}
            >
              {item.status}
            </span>
          </div>
        </div>

        {/* Title & artist */}
        <div className="mb-3 min-w-0">
          <h3 className="text-sm font-semibold text-zinc-100 truncate">
            {item.title}
          </h3>
          {item.artist && (
            <p className="text-xs text-zinc-500 truncate">{item.artist}</p>
          )}
        </div>

        {/* Meta */}
        <div className="flex items-center justify-between text-[11px] text-zinc-600 mb-4">
          <span className="tabular-nums">{formatDuration(item.duration)}</span>
          <span className="tabular-nums">{formatBytes(item.fileSize)}</span>
          {item.playCount !== undefined && (
            <span>{item.playCount}x played</span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={handlePreview}
            data-testid={`preview-${item.id}`}
            aria-label={isPlaying ? "Stop preview" : "Preview track"}
            className={cn(
              "flex items-center gap-1.5 flex-1 justify-center text-xs font-medium py-1.5 rounded-lg border transition-colors",
              isPlaying
                ? "bg-violet-600/20 border-violet-500/30 text-violet-300"
                : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700"
            )}
          >
            {isPlaying ? (
              <Pause className="w-3.5 h-3.5" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            {isPlaying ? "Stop" : "Preview"}
          </button>

          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                data-testid={`content-menu-${item.id}`}
                aria-label="More options"
                className="flex items-center justify-center w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 transition-colors"
              >
                <MoreVertical className="w-3.5 h-3.5" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={4}
                className="z-50 min-w-[140px] bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl py-1 text-sm"
              >
                <DropdownMenu.Item
                  onSelect={handleDelete}
                  data-testid={`delete-${item.id}`}
                  className="flex items-center gap-2 px-3 py-2 text-red-400 hover:bg-red-500/10 cursor-pointer outline-none"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>
    </div>
  );
}
