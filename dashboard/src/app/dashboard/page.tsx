"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { engineApi, queueApi } from "@/lib/api";
import { useEngineStore } from "@/stores/engine-store";
import { NowPlayingWidget } from "@/components/dashboard/NowPlayingWidget";
import { QueueList } from "@/components/dashboard/QueueList";
import { BufferGauge } from "@/components/dashboard/BufferGauge";
import { PipelineHealth } from "@/components/dashboard/PipelineHealth";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";

function AlertBanner() {
  const alerts = useEngineStore((s) => s.alerts);
  const dismissAlert = useEngineStore((s) => s.dismissAlert);

  if (alerts.length === 0) return null;

  return (
    <div className="space-y-2 mb-4">
      {alerts.slice(0, 3).map((alert) => (
        <div
          key={alert.id}
          role="alert"
          className={cn(
            "flex items-center gap-3 px-4 py-3 rounded-lg border text-sm",
            alert.severity === "error"
              ? "bg-red-500/10 border-red-500/30 text-red-300"
              : alert.severity === "warning"
              ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
              : "bg-blue-500/10 border-blue-500/30 text-blue-300"
          )}
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="flex-1">{alert.message}</span>
          <button
            onClick={() => dismissAlert(alert.id)}
            data-testid={`dismiss-alert-${alert.id}`}
            aria-label="Dismiss alert"
            className="text-current/60 hover:text-current transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const setEngineStatus = useEngineStore((s) => s.setEngineStatus);
  const setNowPlaying = useEngineStore((s) => s.setNowPlaying);
  const setQueue = useEngineStore((s) => s.setQueue);

  // Bootstrap engine status
  const { data: engineStatus } = useQuery({
    queryKey: ["engine-status"],
    queryFn: engineApi.getStatus,
    refetchInterval: 5_000,
  });

  // Bootstrap now-playing
  const { data: nowPlaying } = useQuery({
    queryKey: ["now-playing"],
    queryFn: queueApi.getNowPlaying,
    refetchInterval: 5_000,
  });

  // Bootstrap queue
  const { data: queue } = useQuery({
    queryKey: ["queue"],
    queryFn: queueApi.getQueue,
    refetchInterval: 10_000,
  });

  // Hydrate Zustand store
  useEffect(() => {
    if (engineStatus) setEngineStatus(engineStatus);
  }, [engineStatus, setEngineStatus]);

  useEffect(() => {
    if (nowPlaying !== undefined) setNowPlaying(nowPlaying);
  }, [nowPlaying, setNowPlaying]);

  useEffect(() => {
    if (queue) setQueue(queue);
  }, [queue, setQueue]);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-zinc-100">Dashboard</h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          Live view of the RadioWar engine
        </p>
      </div>

      <AlertBanner />

      {/* Top row: NowPlaying (wide) + Buffer gauge */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div className="lg:col-span-2">
          <NowPlayingWidget />
        </div>
        <BufferGauge />
      </div>

      {/* Middle row: Queue + Pipeline */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <QueueList />
        <PipelineHealth />
      </div>

      {/* Bottom: Activity feed */}
      <ActivityFeed />
    </div>
  );
}
