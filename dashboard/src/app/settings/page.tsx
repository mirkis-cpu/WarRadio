"use client";

import { useEffect, useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import * as Select from "@radix-ui/react-select";
import { settingsApi, rotationApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Settings,
  Plus,
  Trash2,
  GripVertical,
  Loader2,
  Save,
  ChevronDown,
  Rss,
  Music,
  Mic,
  Radio,
  Sliders,
} from "lucide-react";
import type { AppSettings, RssFeed, Genre, RotationItem } from "@/lib/api";

// ---------------------------------------------------------------------------
// RSS Feeds section
// ---------------------------------------------------------------------------

function RssFeedsSection({
  feeds,
  onChange,
}: {
  feeds: RssFeed[];
  onChange: (feeds: RssFeed[]) => void;
}) {
  const [newUrl, setNewUrl] = useState("");
  const [newLabel, setNewLabel] = useState("");

  const addFeed = () => {
    if (!newUrl.trim()) return;
    const feed: RssFeed = {
      id: `feed-${Date.now()}`,
      url: newUrl.trim(),
      label: newLabel.trim() || newUrl.trim(),
      enabled: true,
    };
    onChange([...feeds, feed]);
    setNewUrl("");
    setNewLabel("");
  };

  const toggleFeed = (id: string) => {
    onChange(feeds.map((f) => (f.id === id ? { ...f, enabled: !f.enabled } : f)));
  };

  const deleteFeed = (id: string) => {
    onChange(feeds.filter((f) => f.id !== id));
  };

  return (
    <div className="space-y-3">
      {feeds.length === 0 && (
        <p className="text-sm text-zinc-600 italic">No RSS feeds configured.</p>
      )}
      {feeds.map((feed) => (
        <div
          key={feed.id}
          className="flex items-center gap-3 px-3 py-2.5 bg-zinc-900 border border-zinc-800 rounded-lg"
        >
          <button
            onClick={() => toggleFeed(feed.id)}
            data-testid={`rss-toggle-${feed.id}`}
            aria-pressed={feed.enabled}
            aria-label={`${feed.enabled ? "Disable" : "Enable"} ${feed.label}`}
            className={cn(
              "w-9 h-5 rounded-full transition-colors shrink-0",
              feed.enabled ? "bg-violet-600" : "bg-zinc-700"
            )}
          >
            <span
              className={cn(
                "block w-4 h-4 rounded-full bg-white shadow transition-transform mx-0.5",
                feed.enabled ? "translate-x-4" : "translate-x-0"
              )}
            />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-zinc-300 truncate">{feed.label}</p>
            <p className="text-xs text-zinc-600 truncate">{feed.url}</p>
          </div>
          <button
            onClick={() => deleteFeed(feed.id)}
            data-testid={`rss-delete-${feed.id}`}
            aria-label={`Delete ${feed.label}`}
            className="text-zinc-600 hover:text-red-400 transition-colors shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}

      {/* Add new feed */}
      <div className="flex gap-2">
        <input
          type="url"
          placeholder="RSS feed URL"
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          data-testid="rss-url-input"
          className="flex-1 px-3 py-2 text-sm bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
        />
        <input
          type="text"
          placeholder="Label (optional)"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          data-testid="rss-label-input"
          className="w-36 px-3 py-2 text-sm bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
        />
        <button
          onClick={addFeed}
          data-testid="rss-add-btn"
          aria-label="Add RSS feed"
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-violet-600/20 border border-violet-500/30 text-violet-300 rounded-lg hover:bg-violet-600/30 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Genres section
// ---------------------------------------------------------------------------

function GenresSection({
  genres,
  onChange,
}: {
  genres: Genre[];
  onChange: (genres: Genre[]) => void;
}) {
  const toggleGenre = (id: string) => {
    onChange(
      genres.map((g) => (g.id === id ? { ...g, enabled: !g.enabled } : g))
    );
  };

  const setWeight = (id: string, weight: number) => {
    onChange(genres.map((g) => (g.id === id ? { ...g, weight } : g)));
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {genres.map((genre) => (
        <div
          key={genre.id}
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors",
            genre.enabled
              ? "bg-zinc-900 border-zinc-700"
              : "bg-zinc-950 border-zinc-800 opacity-60"
          )}
        >
          <button
            onClick={() => toggleGenre(genre.id)}
            data-testid={`genre-toggle-${genre.id}`}
            aria-pressed={genre.enabled}
            aria-label={`${genre.enabled ? "Disable" : "Enable"} ${genre.name}`}
            className={cn(
              "w-9 h-5 rounded-full transition-colors shrink-0",
              genre.enabled ? "bg-violet-600" : "bg-zinc-700"
            )}
          >
            <span
              className={cn(
                "block w-4 h-4 rounded-full bg-white shadow transition-transform mx-0.5",
                genre.enabled ? "translate-x-4" : "translate-x-0"
              )}
            />
          </button>
          <span className="flex-1 text-sm text-zinc-300">{genre.name}</span>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-zinc-600 w-6 text-right tabular-nums">
              {genre.weight}
            </span>
            <input
              type="range"
              min={1}
              max={10}
              value={genre.weight}
              onChange={(e) => setWeight(genre.id, Number(e.target.value))}
              data-testid={`genre-weight-${genre.id}`}
              aria-label={`Weight for ${genre.name}`}
              disabled={!genre.enabled}
              className="w-20 accent-violet-500"
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TTS section
// ---------------------------------------------------------------------------

function TtsSection({
  tts,
  onChange,
}: {
  tts: AppSettings["tts"];
  onChange: (tts: AppSettings["tts"]) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1.5">
          Provider
        </label>
        <Select.Root
          value={tts.provider}
          onValueChange={(v) =>
            onChange({ ...tts, provider: v as AppSettings["tts"]["provider"] })
          }
        >
          <Select.Trigger
            data-testid="tts-provider-select"
            aria-label="TTS Provider"
            className="flex items-center justify-between w-full px-3 py-2 text-sm bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-300 hover:border-zinc-700 focus:outline-none focus:border-zinc-600"
          >
            <Select.Value />
            <Select.Icon>
              <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
            </Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Content className="z-50 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl py-1 min-w-[160px]">
              <Select.Viewport>
                {(["elevenlabs", "openai", "google"] as const).map((p) => (
                  <Select.Item
                    key={p}
                    value={p}
                    className="flex items-center px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 cursor-pointer outline-none capitalize"
                  >
                    <Select.ItemText>{p}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
      </div>

      <div>
        <label
          htmlFor="tts-voice"
          className="block text-xs font-medium text-zinc-400 mb-1.5"
        >
          Voice ID / Name
        </label>
        <input
          id="tts-voice"
          type="text"
          value={tts.voice}
          onChange={(e) => onChange({ ...tts, voice: e.target.value })}
          data-testid="tts-voice-input"
          className="w-full px-3 py-2 text-sm bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-300 focus:outline-none focus:border-zinc-600"
        />
      </div>

      <div>
        <label
          htmlFor="tts-speed"
          className="block text-xs font-medium text-zinc-400 mb-1.5"
        >
          Speed ({tts.speed}x)
        </label>
        <input
          id="tts-speed"
          type="range"
          min={0.5}
          max={2}
          step={0.1}
          value={tts.speed}
          onChange={(e) => onChange({ ...tts, speed: Number(e.target.value) })}
          data-testid="tts-speed-range"
          aria-label="TTS speed"
          className="w-full accent-violet-500"
        />
      </div>

      <div>
        <label
          htmlFor="tts-apikey"
          className="block text-xs font-medium text-zinc-400 mb-1.5"
        >
          API Key
        </label>
        <input
          id="tts-apikey"
          type="password"
          value={tts.apiKey ?? ""}
          onChange={(e) => onChange({ ...tts, apiKey: e.target.value })}
          data-testid="tts-apikey-input"
          placeholder="sk-..."
          className="w-full px-3 py-2 text-sm bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stream section
// ---------------------------------------------------------------------------

function StreamSection({
  stream,
  onChange,
}: {
  stream: AppSettings["stream"];
  onChange: (s: AppSettings["stream"]) => void;
}) {
  const fields: {
    key: keyof AppSettings["stream"];
    label: string;
    type: string;
    placeholder: string;
  }[] = [
    {
      key: "rtmpUrl",
      label: "RTMP URL",
      type: "url",
      placeholder: "rtmp://a.rtmp.youtube.com/live2",
    },
    { key: "streamKey", label: "Stream Key", type: "password", placeholder: "xxxx-xxxx-xxxx" },
    { key: "bitrate", label: "Bitrate (kbps)", type: "number", placeholder: "128" },
    { key: "sampleRate", label: "Sample Rate (Hz)", type: "number", placeholder: "44100" },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {fields.map(({ key, label, type, placeholder }) => (
        <div key={key}>
          <label
            htmlFor={`stream-${key}`}
            className="block text-xs font-medium text-zinc-400 mb-1.5"
          >
            {label}
          </label>
          <input
            id={`stream-${key}`}
            type={type}
            value={String(stream[key])}
            onChange={(e) =>
              onChange({
                ...stream,
                [key]: type === "number" ? Number(e.target.value) : e.target.value,
              })
            }
            data-testid={`stream-${key}-input`}
            placeholder={placeholder}
            className="w-full px-3 py-2 text-sm bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
          />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rotation Pattern Builder
// ---------------------------------------------------------------------------

const TYPE_COLORS: Record<string, string> = {
  song: "text-violet-400 bg-violet-500/15 border-violet-500/25",
  news: "text-amber-400 bg-amber-500/15 border-amber-500/25",
  podcast: "text-blue-400 bg-blue-500/15 border-blue-500/25",
  ad: "text-green-400 bg-green-500/15 border-green-500/25",
};

function SortableRotationItem({
  item,
  onWeightChange,
  onDelete,
}: {
  item: RotationItem;
  onWeightChange: (id: string, weight: number) => void;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 px-3 py-2.5 bg-zinc-900 border border-zinc-800 rounded-lg"
    >
      <button
        {...(listeners ?? {})}
        {...attributes}
        aria-label="Drag to reorder"
        className="text-zinc-600 hover:text-zinc-400 cursor-grab active:cursor-grabbing shrink-0"
      >
        <GripVertical className="w-4 h-4" />
      </button>

      <span
        className={cn(
          "text-xs font-semibold uppercase px-2 py-0.5 rounded border capitalize shrink-0",
          TYPE_COLORS[item.type]
        )}
      >
        {item.type}
      </span>

      <span className="text-xs text-zinc-600 w-12 shrink-0 tabular-nums">
        Weight: {item.weight}
      </span>
      <input
        type="range"
        min={1}
        max={10}
        value={item.weight}
        onChange={(e) => onWeightChange(item.id, Number(e.target.value))}
        data-testid={`rotation-weight-${item.id}`}
        aria-label={`Weight for rotation item ${item.type}`}
        className="flex-1 accent-violet-500"
      />

      <button
        onClick={() => onDelete(item.id)}
        data-testid={`rotation-delete-${item.id}`}
        aria-label={`Delete rotation item ${item.type}`}
        className="text-zinc-600 hover:text-red-400 transition-colors shrink-0"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function RotationBuilder({
  items,
  onChange,
}: {
  items: RotationItem[];
  onChange: (items: RotationItem[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIdx = items.findIndex((i) => i.id === active.id);
      const newIdx = items.findIndex((i) => i.id === over.id);
      onChange(arrayMove(items, oldIdx, newIdx));
    }
  };

  const handleWeightChange = (id: string, weight: number) => {
    onChange(items.map((i) => (i.id === id ? { ...i, weight } : i)));
  };

  const handleDelete = (id: string) => {
    onChange(items.filter((i) => i.id !== id));
  };

  const addItem = (type: RotationItem["type"]) => {
    onChange([
      ...items,
      {
        id: `rot-${Date.now()}`,
        type,
        weight: 5,
        order: items.length,
      },
    ]);
  };

  return (
    <div className="space-y-3">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          {items.map((item) => (
            <SortableRotationItem
              key={item.id}
              item={item}
              onWeightChange={handleWeightChange}
              onDelete={handleDelete}
            />
          ))}
        </SortableContext>
      </DndContext>

      {items.length === 0 && (
        <p className="text-sm text-zinc-600 italic">
          No rotation items. Add content types below.
        </p>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        {(["song", "news", "podcast", "ad"] as const).map((type) => (
          <button
            key={type}
            onClick={() => addItem(type)}
            data-testid={`rotation-add-${type}`}
            aria-label={`Add ${type} to rotation`}
            className={cn(
              "flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border capitalize transition-colors",
              TYPE_COLORS[type]
            )}
          >
            <Plus className="w-3 h-3" />
            {type}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200 mb-4">
        <Icon className="w-4 h-4 text-zinc-500" />
        {title}
      </h2>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: settingsApi.getSettings,
  });

  const { data: rotations = [], isLoading: rotLoading } = useQuery({
    queryKey: ["rotation"],
    queryFn: rotationApi.getRotation,
  });

  const [localSettings, setLocalSettings] = useState<AppSettings | null>(null);
  const [localRotationItems, setLocalRotationItems] = useState<RotationItem[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data && !localSettings) setLocalSettings(data);
  }, [data, localSettings]);

  useEffect(() => {
    if (rotations.length > 0 && localRotationItems.length === 0) {
      setLocalRotationItems(rotations[0]?.items ?? []);
    }
  }, [rotations, localRotationItems.length]);

  const saveSettings = useMutation({
    mutationFn: () =>
      localSettings ? settingsApi.updateSettings(localSettings) : Promise.reject("No settings"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      setDirty(false);
    },
  });

  const saveRotation = useMutation({
    mutationFn: () => {
      const rotId = rotations[0]?.id;
      if (!rotId) return Promise.reject("No rotation");
      return rotationApi.updateRotation(rotId, localRotationItems);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rotation"] });
    },
  });

  const updateSettings = useCallback(
    <K extends keyof AppSettings>(key: K, val: AppSettings[K]) => {
      setLocalSettings((prev) => (prev ? { ...prev, [key]: val } : null));
      setDirty(true);
    },
    []
  );

  if (isLoading || !localSettings) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-zinc-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
            <Settings className="w-5 h-5 text-zinc-500" />
            Settings
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Configure the RadioWar engine
          </p>
        </div>
        {dirty && (
          <button
            onClick={() => saveSettings.mutate()}
            data-testid="save-settings-btn"
            disabled={saveSettings.isPending}
            aria-label="Save settings"
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-violet-600 hover:bg-violet-500 text-white rounded-lg transition-colors disabled:opacity-60"
          >
            {saveSettings.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save changes
          </button>
        )}
      </div>

      <div className="space-y-5">
        {/* RSS Feeds */}
        <Section icon={Rss} title="RSS Feeds">
          <RssFeedsSection
            feeds={localSettings.rssFeeds}
            onChange={(feeds) => updateSettings("rssFeeds", feeds)}
          />
        </Section>

        {/* Genres */}
        <Section icon={Music} title="Genres">
          <GenresSection
            genres={localSettings.genres}
            onChange={(genres) => updateSettings("genres", genres)}
          />
        </Section>

        {/* TTS */}
        <Section icon={Mic} title="Text-to-Speech">
          <TtsSection
            tts={localSettings.tts}
            onChange={(tts) => updateSettings("tts", tts)}
          />
        </Section>

        {/* Stream */}
        <Section icon={Radio} title="Stream Output">
          <StreamSection
            stream={localSettings.stream}
            onChange={(stream) => updateSettings("stream", stream)}
          />
        </Section>

        {/* Rotation builder */}
        <Section icon={Sliders} title="Rotation Pattern">
          {rotLoading ? (
            <Loader2 className="w-5 h-5 text-zinc-600 animate-spin" />
          ) : (
            <div className="space-y-3">
              <RotationBuilder
                items={localRotationItems}
                onChange={setLocalRotationItems}
              />
              <button
                onClick={() => saveRotation.mutate()}
                data-testid="save-rotation-btn"
                disabled={saveRotation.isPending}
                aria-label="Save rotation pattern"
                className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 rounded-lg transition-colors disabled:opacity-60"
              >
                {saveRotation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                Save rotation
              </button>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
