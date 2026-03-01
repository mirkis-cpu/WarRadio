// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContentType = "song" | "news" | "podcast" | "ad";
export type ContentStatus = "active" | "inactive" | "processing" | "error";
export type EngineState = "idle" | "playing" | "paused" | "stopped";
export type PipelineStage =
  | "rss_fetch"
  | "tts"
  | "audio_process"
  | "queue_fill"
  | "stream";

export interface EngineStatus {
  state: EngineState;
  uptime: number; // seconds
  currentTrack: NowPlaying | null;
  bufferHealth: number; // 0-100
  streamUrl: string | null;
  listeners: number;
}

export interface NowPlaying {
  id: string;
  type: ContentType;
  title: string;
  artist?: string;
  duration: number; // seconds
  elapsed: number; // seconds
  startedAt: string; // ISO
  artworkUrl?: string;
}

export interface QueueItem {
  id: string;
  contentId: string;
  type: ContentType;
  title: string;
  artist?: string;
  duration: number;
  scheduledAt?: string;
  isOverride?: boolean;
}

export interface ContentItem {
  id: string;
  type: ContentType;
  title: string;
  artist?: string;
  duration: number;
  fileSize: number;
  fileUrl: string;
  status: ContentStatus;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
  playCount?: number;
}

export interface ScheduleSlot {
  id: string;
  dayOfWeek: number; // 0=Sun ... 6=Sat
  startTime: string; // "HH:MM"
  endTime: string;
  contentType: ContentType;
  rotationId?: string;
  label?: string;
}

export interface RotationItem {
  id: string;
  type: ContentType;
  weight: number; // 1-10
  order: number;
}

export interface Rotation {
  id: string;
  name: string;
  items: RotationItem[];
}

export interface RssFeed {
  id: string;
  url: string;
  label: string;
  enabled: boolean;
  lastFetched?: string;
}

export interface Genre {
  id: string;
  name: string;
  enabled: boolean;
  weight: number;
}

export interface TtsSettings {
  provider: "elevenlabs" | "openai" | "google";
  voice: string;
  speed: number;
  apiKey?: string;
}

export interface StreamSettings {
  rtmpUrl: string;
  streamKey: string;
  bitrate: number;
  sampleRate: number;
}

export interface AppSettings {
  rssFeeds: RssFeed[];
  genres: Genre[];
  tts: TtsSettings;
  stream: StreamSettings;
}

export interface PipelineJob {
  id: string;
  stage: PipelineStage;
  status: "pending" | "running" | "done" | "error";
  progress?: number;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface PipelineStatus {
  jobs: PipelineJob[];
  lastUpdated: string;
}

export interface BufferStatus {
  health: number; // 0-100
  secondsBuffered: number;
  tracksQueued: number;
}

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

const BASE_URL = process.env.NEXT_PUBLIC_ENGINE_URL || "http://localhost:3001";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

async function request<T>(
  method: HttpMethod,
  path: string,
  body?: unknown
): Promise<T> {
  const init: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
  };

  if (body !== undefined && method !== "GET") {
    init.body = JSON.stringify(body);
  }

  const res = await fetch(`${BASE_URL}${path}`, init);

  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new Error(`API ${method} ${path} failed (${res.status}): ${text}`);
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

async function uploadFile<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new Error(`API POST ${path} failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Engine API
// ---------------------------------------------------------------------------

export const engineApi = {
  getStatus: () => request<EngineStatus>("GET", "/api/engine/status"),
  start: () => request<{ ok: boolean }>("POST", "/api/engine/start"),
  stop: () => request<{ ok: boolean }>("POST", "/api/engine/stop"),
  pause: () => request<{ ok: boolean }>("POST", "/api/engine/pause"),
};

// ---------------------------------------------------------------------------
// Content API
// ---------------------------------------------------------------------------

export const contentApi = {
  listContent: (type?: ContentType) => {
    const qs = type ? `?type=${type}` : "";
    return request<ContentItem[]>("GET", `/api/content${qs}`);
  },
  getContent: (id: string) => request<ContentItem>("GET", `/api/content/${id}`),
  uploadContent: (formData: FormData) =>
    uploadFile<ContentItem>("/api/content/upload", formData),
  updateContent: (id: string, data: Partial<ContentItem>) =>
    request<ContentItem>("PATCH", `/api/content/${id}`, data),
  deleteContent: (id: string) =>
    request<{ ok: boolean }>("DELETE", `/api/content/${id}`),
};

// ---------------------------------------------------------------------------
// Queue API
// ---------------------------------------------------------------------------

export const queueApi = {
  getNowPlaying: () => request<NowPlaying | null>("GET", "/api/queue/now"),
  getQueue: () => request<QueueItem[]>("GET", "/api/queue"),
  addOverride: (contentId: string, position?: number) =>
    request<QueueItem>("POST", "/api/queue/override", { contentId, position }),
  removeOverride: (queueItemId: string) =>
    request<{ ok: boolean }>("DELETE", `/api/queue/override/${queueItemId}`),
};

// ---------------------------------------------------------------------------
// Schedule API
// ---------------------------------------------------------------------------

export const scheduleApi = {
  getSchedule: () => request<ScheduleSlot[]>("GET", "/api/schedule"),
  createSlot: (slot: Omit<ScheduleSlot, "id">) =>
    request<ScheduleSlot>("POST", "/api/schedule", slot),
  updateSlot: (id: string, slot: Partial<ScheduleSlot>) =>
    request<ScheduleSlot>("PATCH", `/api/schedule/${id}`, slot),
  deleteSlot: (id: string) =>
    request<{ ok: boolean }>("DELETE", `/api/schedule/${id}`),
  getPreview: (date: string) =>
    request<QueueItem[]>("GET", `/api/schedule/preview?date=${date}`),
};

// ---------------------------------------------------------------------------
// Rotation API
// ---------------------------------------------------------------------------

export const rotationApi = {
  getRotation: () => request<Rotation[]>("GET", "/api/rotation"),
  updateRotation: (id: string, items: RotationItem[]) =>
    request<Rotation>("PUT", `/api/rotation/${id}`, { items }),
};

// ---------------------------------------------------------------------------
// Settings API
// ---------------------------------------------------------------------------

export const settingsApi = {
  getSettings: () => request<AppSettings>("GET", "/api/settings"),
  updateSettings: (data: Partial<AppSettings>) =>
    request<AppSettings>("PATCH", "/api/settings", data),
};

// ---------------------------------------------------------------------------
// Pipeline API
// ---------------------------------------------------------------------------

export const pipelineApi = {
  getPipeline: () => request<PipelineStatus>("GET", "/api/pipeline"),
  triggerSong: () =>
    request<PipelineJob>("POST", "/api/pipeline/trigger/song"),
  triggerNews: () =>
    request<PipelineJob>("POST", "/api/pipeline/trigger/news"),
};
