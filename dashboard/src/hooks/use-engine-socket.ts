"use client";

import { useEffect } from "react";
import { getSocket } from "@/lib/socket-client";
import { useEngineStore } from "@/stores/engine-store";
import type { EngineStatus, NowPlaying, QueueItem, BufferStatus } from "@/lib/api";
import type { PipelineJobUpdate } from "@/stores/engine-store";

interface AlertPayload {
  severity: "info" | "warning" | "error";
  message: string;
}

export function useEngineSocket() {
  const {
    setEngineStatus,
    setNowPlaying,
    setQueue,
    setBufferStatus,
    setSocketConnected,
    updatePipelineJob,
    addAlert,
  } = useEngineStore();

  useEffect(() => {
    const socket = getSocket();

    function onConnect() {
      setSocketConnected(true);
    }

    function onDisconnect() {
      setSocketConnected(false);
    }

    function onConnectError() {
      setSocketConnected(false);
    }

    function onNowPlayingUpdate(data: NowPlaying) {
      setNowPlaying(data);
    }

    function onNowPlayingChanged(data: NowPlaying) {
      setNowPlaying(data);
    }

    function onQueueUpdated(data: QueueItem[]) {
      setQueue(data);
    }

    function onBufferStatus(data: BufferStatus) {
      setBufferStatus(data);
    }

    function onEngineStatusChanged(data: EngineStatus) {
      setEngineStatus(data);
    }

    function onPipelineJobUpdate(data: PipelineJobUpdate) {
      updatePipelineJob(data);
    }

    function onAlert(data: AlertPayload) {
      addAlert(data.severity, data.message);
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("now-playing:update", onNowPlayingUpdate);
    socket.on("now-playing:changed", onNowPlayingChanged);
    socket.on("queue:updated", onQueueUpdated);
    socket.on("buffer:status", onBufferStatus);
    socket.on("engine:status-changed", onEngineStatusChanged);
    socket.on("pipeline:job-update", onPipelineJobUpdate);
    socket.on("alert", onAlert);

    // Reflect current connection state on mount
    setSocketConnected(socket.connected);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("now-playing:update", onNowPlayingUpdate);
      socket.off("now-playing:changed", onNowPlayingChanged);
      socket.off("queue:updated", onQueueUpdated);
      socket.off("buffer:status", onBufferStatus);
      socket.off("engine:status-changed", onEngineStatusChanged);
      socket.off("pipeline:job-update", onPipelineJobUpdate);
      socket.off("alert", onAlert);
    };
  }, [
    setEngineStatus,
    setNowPlaying,
    setQueue,
    setBufferStatus,
    setSocketConnected,
    updatePipelineJob,
    addAlert,
  ]);
}
