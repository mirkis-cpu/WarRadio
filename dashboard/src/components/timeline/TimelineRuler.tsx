"use client";

import { useMemo } from "react";

interface TimelineRulerProps {
  startHour?: number;
  endHour?: number;
  pixelsPerHour: number;
}

export function TimelineRuler({
  startHour = 0,
  endHour = 24,
  pixelsPerHour,
}: TimelineRulerProps) {
  const ticks = useMemo(() => {
    const result: { hour: number; label: string }[] = [];
    for (let h = startHour; h <= endHour; h++) {
      const label =
        h === 0 || h === 24
          ? "12 AM"
          : h === 12
          ? "12 PM"
          : h < 12
          ? `${h} AM`
          : `${h - 12} PM`;
      result.push({ hour: h, label });
    }
    return result;
  }, [startHour, endHour]);

  const totalWidth = (endHour - startHour) * pixelsPerHour;

  return (
    <div
      className="relative h-8 border-b border-zinc-800 bg-zinc-950 shrink-0 select-none"
      style={{ width: totalWidth }}
      aria-label="Timeline ruler"
    >
      {ticks.map(({ hour, label }) => (
        <div
          key={hour}
          className="absolute top-0 flex flex-col items-center"
          style={{ left: (hour - startHour) * pixelsPerHour }}
        >
          <div className="w-px h-3 bg-zinc-700" />
          <span className="text-[10px] text-zinc-500 whitespace-nowrap mt-0.5">
            {label}
          </span>
        </div>
      ))}

      {/* Half-hour ticks */}
      {ticks.slice(0, -1).map(({ hour }) => (
        <div
          key={`${hour}-half`}
          className="absolute top-0"
          style={{ left: (hour - startHour + 0.5) * pixelsPerHour }}
        >
          <div className="w-px h-2 bg-zinc-800" />
        </div>
      ))}
    </div>
  );
}
