"use client";

import { useRef, useState, useEffect } from "react";
import { useDroppable } from "@dnd-kit/core";
import { Music, Newspaper, Mic2, Megaphone, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ContentType, ScheduleSlot } from "@/lib/api";

const TRACK_HEIGHT = 56;
const PIXELS_PER_HOUR = 120;

const TRACK_ORDER: ContentType[] = ["song", "news", "podcast", "ad"];

const TRACK_META: Record<
  ContentType,
  { label: string; color: string; bg: string; border: string; icon: React.ElementType }
> = {
  song: {
    label: "Songs",
    color: "text-violet-400",
    bg: "bg-violet-500/20",
    border: "border-violet-500/40",
    icon: Music,
  },
  news: {
    label: "News",
    color: "text-amber-400",
    bg: "bg-amber-500/20",
    border: "border-amber-500/40",
    icon: Newspaper,
  },
  podcast: {
    label: "Podcasts",
    color: "text-blue-400",
    bg: "bg-blue-500/20",
    border: "border-blue-500/40",
    icon: Mic2,
  },
  ad: {
    label: "Ads",
    color: "text-green-400",
    bg: "bg-green-500/20",
    border: "border-green-500/40",
    icon: Megaphone,
  },
};

function timeToPixels(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h + m / 60) * PIXELS_PER_HOUR;
}

function durationToPixels(startTime: string, endTime: string): number {
  const start = timeToPixels(startTime);
  const end = timeToPixels(endTime);
  return Math.max(end - start, 20);
}

interface SlotBlockProps {
  slot: ScheduleSlot;
  trackType: ContentType;
  onDelete: (id: string) => void;
}

function SlotBlock({ slot, trackType, onDelete }: SlotBlockProps) {
  const meta = TRACK_META[trackType];
  const left = timeToPixels(slot.startTime);
  const width = durationToPixels(slot.startTime, slot.endTime);

  return (
    <div
      className={cn(
        "absolute top-1 bottom-1 rounded border flex items-center px-2 gap-1 group overflow-hidden cursor-default select-none",
        meta.bg,
        meta.border
      )}
      style={{ left, width }}
      title={slot.label ?? `${slot.startTime} – ${slot.endTime}`}
    >
      <meta.icon className={cn("w-3 h-3 shrink-0", meta.color)} />
      <span className={cn("text-[10px] font-medium truncate", meta.color)}>
        {slot.label ?? `${slot.startTime}–${slot.endTime}`}
      </span>
      <button
        onClick={() => onDelete(slot.id)}
        data-testid={`slot-delete-${slot.id}`}
        aria-label="Delete slot"
        className="ml-auto opacity-0 group-hover:opacity-100 text-current/60 hover:text-red-400 transition-all shrink-0"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

interface TimelineTrackProps {
  type: ContentType;
  slots: ScheduleSlot[];
  onDelete: (id: string) => void;
}

function TimelineTrack({ type, slots, onDelete }: TimelineTrackProps) {
  const meta = TRACK_META[type];
  const { setNodeRef, isOver } = useDroppable({ id: `track-${type}`, data: { type } });
  const totalWidth = 24 * PIXELS_PER_HOUR;

  return (
    <div className="flex" style={{ height: TRACK_HEIGHT }}>
      {/* Track label */}
      <div className="w-28 shrink-0 flex items-center gap-2 px-3 border-r border-zinc-800 bg-zinc-950/60">
        <meta.icon className={cn("w-3.5 h-3.5", meta.color)} />
        <span className="text-xs font-medium text-zinc-400">{meta.label}</span>
      </div>
      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className={cn(
          "relative border-b border-zinc-800/60 transition-colors",
          isOver ? "bg-zinc-800/40" : "bg-zinc-900/30"
        )}
        style={{ width: totalWidth }}
      >
        {slots
          .filter((s) => s.contentType === type)
          .map((slot) => (
            <SlotBlock key={slot.id} slot={slot} trackType={type} onDelete={onDelete} />
          ))}
      </div>
    </div>
  );
}

interface CurrentTimeLineProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
}

function CurrentTimeLine({ containerRef }: CurrentTimeLineProps) {
  const [left, setLeft] = useState(0);

  useEffect(() => {
    function update() {
      const now = new Date();
      const hours = now.getHours() + now.getMinutes() / 60;
      const px = hours * PIXELS_PER_HOUR;
      setLeft(px);
      // Scroll current time into view
      if (containerRef.current) {
        containerRef.current.scrollLeft = Math.max(0, px - 200);
      }
    }
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [containerRef]);

  return (
    <div
      className="absolute top-0 bottom-0 w-px bg-red-500 z-10 pointer-events-none"
      style={{ left }}
      aria-hidden
    >
      <div className="absolute -top-0 -translate-x-1/2 w-2 h-2 rounded-full bg-red-500" />
    </div>
  );
}

interface TimelineCanvasProps {
  slots: ScheduleSlot[];
  onDeleteSlot: (id: string) => void;
}

export function TimelineCanvas({ slots, onDeleteSlot }: TimelineCanvasProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const totalWidth = 24 * PIXELS_PER_HOUR;

  return (
    <div className="flex-1 overflow-hidden flex flex-col bg-zinc-950">
      {/* Scrollable area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-x-auto overflow-y-hidden"
      >
        <div className="relative" style={{ width: totalWidth + 112 }}>
          {/* Offset for track labels (112px = w-28) */}
          <div className="flex">
            <div className="w-28 shrink-0" />
            <div className="relative" style={{ width: totalWidth }}>
              <CurrentTimeLine containerRef={scrollRef} />
            </div>
          </div>
          {/* Tracks */}
          {TRACK_ORDER.map((type) => (
            <TimelineTrack
              key={type}
              type={type}
              slots={slots}
              onDelete={onDeleteSlot}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
