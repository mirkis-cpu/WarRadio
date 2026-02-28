"use client";

import { useDraggable } from "@dnd-kit/core";
import { Music, Newspaper, Mic2, Megaphone, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ContentType } from "@/lib/api";

interface PaletteItem {
  type: ContentType;
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
  bg: string;
  border: string;
}

const PALETTE_ITEMS: PaletteItem[] = [
  {
    type: "song",
    label: "Song",
    description: "Music track",
    icon: Music,
    color: "text-violet-400",
    bg: "bg-violet-500/10 hover:bg-violet-500/20",
    border: "border-violet-500/20",
  },
  {
    type: "news",
    label: "News",
    description: "News segment",
    icon: Newspaper,
    color: "text-amber-400",
    bg: "bg-amber-500/10 hover:bg-amber-500/20",
    border: "border-amber-500/20",
  },
  {
    type: "podcast",
    label: "Podcast",
    description: "Podcast clip",
    icon: Mic2,
    color: "text-blue-400",
    bg: "bg-blue-500/10 hover:bg-blue-500/20",
    border: "border-blue-500/20",
  },
  {
    type: "ad",
    label: "Ad",
    description: "Advertisement",
    icon: Megaphone,
    color: "text-green-400",
    bg: "bg-green-500/10 hover:bg-green-500/20",
    border: "border-green-500/20",
  },
];

function DraggablePaletteItem({ item }: { item: PaletteItem }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-${item.type}`,
    data: { type: item.type, source: "palette" },
  });

  return (
    <div
      ref={setNodeRef}
      {...(listeners ?? {})}
      {...attributes}
      data-testid={`palette-${item.type}`}
      aria-label={`Drag ${item.label} to timeline`}
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-grab active:cursor-grabbing transition-all",
        item.bg,
        item.border,
        isDragging && "opacity-50 scale-95"
      )}
    >
      <GripVertical className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
      <item.icon className={cn("w-4 h-4 shrink-0", item.color)} />
      <div className="min-w-0">
        <div className={cn("text-sm font-medium", item.color)}>
          {item.label}
        </div>
        <div className="text-[10px] text-zinc-600">{item.description}</div>
      </div>
    </div>
  );
}

export function ContentPalette() {
  return (
    <div className="w-48 shrink-0 bg-zinc-900 border-r border-zinc-800 flex flex-col">
      <div className="px-4 py-3 border-b border-zinc-800">
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">
          Content Types
        </h3>
      </div>
      <div className="p-3 space-y-2 overflow-y-auto flex-1">
        {PALETTE_ITEMS.map((item) => (
          <DraggablePaletteItem key={item.type} item={item} />
        ))}
      </div>
    </div>
  );
}
