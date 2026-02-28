"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { scheduleApi } from "@/lib/api";
import { ContentPalette } from "@/components/timeline/ContentPalette";
import { TimelineCanvas } from "@/components/timeline/TimelineCanvas";
import { TimelineRuler } from "@/components/timeline/TimelineRuler";
import { Loader2, Calendar, Music } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ContentType } from "@/lib/api";

const PIXELS_PER_HOUR = 120;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pixelsToTime(px: number): string {
  const totalMinutes = Math.round((px / PIXELS_PER_HOUR) * 60);
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

export default function TimelinePage() {
  const qc = useQueryClient();
  const [selectedDay, setSelectedDay] = useState(new Date().getDay());
  const [overlayType, setOverlayType] = useState<ContentType | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const { data: slots = [], isLoading } = useQuery({
    queryKey: ["schedule"],
    queryFn: scheduleApi.getSchedule,
  });

  const createSlot = useMutation({
    mutationFn: scheduleApi.createSlot,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schedule"] }),
  });

  const deleteSlot = useMutation({
    mutationFn: scheduleApi.deleteSlot,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schedule"] }),
  });

  const handleDeleteSlot = useCallback(
    (id: string) => deleteSlot.mutate(id),
    [deleteSlot]
  );

  function handleDragStart(event: DragStartEvent) {
    const type = event.active.data.current?.type as ContentType | undefined;
    if (type) setOverlayType(type);
  }

  function handleDragEnd(event: DragEndEvent) {
    setOverlayType(null);
    const { active, over } = event;
    if (!over) return;

    const source = active.data.current?.source;
    const dropType = over.data.current?.type as ContentType | undefined;
    const contentType = active.data.current?.type as ContentType | undefined;

    if (source === "palette" && dropType && contentType) {
      // Estimate drop position from delta
      const deltaX = event.delta.x;
      const dropLeft = Math.max(0, deltaX);
      const startTime = pixelsToTime(dropLeft);
      const [sh, sm] = startTime.split(":").map(Number);
      const endHour = Math.min(23, sh + 1);
      const endTime = `${endHour.toString().padStart(2, "0")}:${sm.toString().padStart(2, "0")}`;

      createSlot.mutate({
        dayOfWeek: selectedDay,
        startTime,
        endTime,
        contentType,
        label: undefined,
      });
    }
  }

  const daySlots = slots.filter((s) => s.dayOfWeek === selectedDay);

  return (
    <div className="flex flex-col h-[calc(100vh-72px)]">
      {/* Page header */}
      <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-950">
        <div>
          <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-zinc-500" />
            Timeline
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Drag content types onto tracks to schedule them
          </p>
        </div>

        {/* Day selector */}
        <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
          {DAYS.map((day, idx) => (
            <button
              key={day}
              onClick={() => setSelectedDay(idx)}
              data-testid={`day-tab-${day.toLowerCase()}`}
              aria-pressed={selectedDay === idx}
              className={cn(
                "px-3 py-1.5 rounded text-xs font-medium transition-all",
                selectedDay === idx
                  ? "bg-violet-600 text-white"
                  : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
              )}
            >
              {day}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-zinc-600 animate-spin" />
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex flex-1 overflow-hidden">
            {/* Left palette */}
            <ContentPalette />

            {/* Timeline area */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Ruler - horizontally scrolls with canvas */}
              <div className="shrink-0 flex border-b border-zinc-800 overflow-hidden">
                <div className="w-28 shrink-0 bg-zinc-950 border-r border-zinc-800" />
                <div className="overflow-x-hidden">
                  <TimelineRuler
                    startHour={0}
                    endHour={24}
                    pixelsPerHour={PIXELS_PER_HOUR}
                  />
                </div>
              </div>

              <TimelineCanvas slots={daySlots} onDeleteSlot={handleDeleteSlot} />
            </div>
          </div>

          {/* Drag overlay */}
          <DragOverlay>
            {overlayType && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-600 shadow-2xl opacity-90">
                <Music className="w-4 h-4 text-violet-400" />
                <span className="text-sm font-medium text-zinc-200 capitalize">
                  {overlayType}
                </span>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}
