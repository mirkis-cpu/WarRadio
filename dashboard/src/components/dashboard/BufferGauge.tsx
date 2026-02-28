"use client";

import {
  RadialBarChart,
  RadialBar,
  ResponsiveContainer,
} from "recharts";
import { useEngineStore } from "@/stores/engine-store";
import { cn } from "@/lib/utils";

function healthColor(health: number): string {
  if (health >= 70) return "#4ade80"; // green-400
  if (health >= 40) return "#fbbf24"; // amber-400
  return "#f87171"; // red-400
}

function healthLabel(health: number): string {
  if (health >= 70) return "Healthy";
  if (health >= 40) return "Low";
  return "Critical";
}

export function BufferGauge() {
  const bufferStatus = useEngineStore((s) => s.bufferStatus);
  const engineStatus = useEngineStore((s) => s.engineStatus);

  const health =
    bufferStatus?.health ?? engineStatus?.bufferHealth ?? 0;
  const color = healthColor(health);
  const label = healthLabel(health);

  const chartData = [{ name: "Buffer", value: health, fill: color }];

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col">
      <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-2">
        Buffer Health
      </h2>

      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="relative w-40 h-40">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart
              cx="50%"
              cy="50%"
              innerRadius="70%"
              outerRadius="100%"
              startAngle={90}
              endAngle={-270}
              data={chartData}
              barSize={14}
            >
              <RadialBar
                background
                dataKey="value"
                cornerRadius={6}
              />
            </RadialBarChart>
          </ResponsiveContainer>

          {/* Center overlay */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span
              className="text-2xl font-bold tabular-nums"
              style={{ color }}
            >
              {Math.round(health)}%
            </span>
            <span
              className={cn(
                "text-xs font-medium mt-0.5",
                health >= 70
                  ? "text-green-400"
                  : health >= 40
                  ? "text-amber-400"
                  : "text-red-400"
              )}
            >
              {label}
            </span>
          </div>
        </div>

        {bufferStatus && (
          <div className="mt-3 grid grid-cols-2 gap-x-6 text-center">
            <div>
              <div className="text-lg font-semibold text-zinc-200 tabular-nums">
                {Math.round(bufferStatus.secondsBuffered)}s
              </div>
              <div className="text-[10px] text-zinc-600 uppercase tracking-wider">
                Buffered
              </div>
            </div>
            <div>
              <div className="text-lg font-semibold text-zinc-200 tabular-nums">
                {bufferStatus.tracksQueued}
              </div>
              <div className="text-[10px] text-zinc-600 uppercase tracking-wider">
                Tracks
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
