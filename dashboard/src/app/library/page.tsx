"use client";

import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Tabs from "@radix-ui/react-tabs";
import { contentApi } from "@/lib/api";
import { ContentCard } from "@/components/library/ContentCard";
import { UploadDropzone } from "@/components/library/UploadDropzone";
import { Loader2, Search, Library, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ContentType } from "@/lib/api";

const TABS = [
  { value: "all", label: "All" },
  { value: "song", label: "Songs" },
  { value: "podcast", label: "Podcasts" },
  { value: "news", label: "News" },
  { value: "ad", label: "Ads" },
] as const;

type TabValue = (typeof TABS)[number]["value"];

export default function LibraryPage() {
  const [activeTab, setActiveTab] = useState<TabValue>("all");
  const [search, setSearch] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const qc = useQueryClient();

  const filterType = activeTab === "all" ? undefined : (activeTab as ContentType);

  const { data: content = [], isLoading } = useQuery({
    queryKey: ["content", filterType],
    queryFn: () => contentApi.listContent(filterType),
  });

  const handleDeleted = useCallback(
    (id: string) => {
      qc.setQueryData<typeof content>(["content", filterType], (old = []) =>
        old.filter((c) => c.id !== id)
      );
    },
    [qc, filterType]
  );

  const handleUploaded = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["content"] });
  }, [qc]);

  const filtered = content.filter(
    (item) =>
      !search ||
      item.title.toLowerCase().includes(search.toLowerCase()) ||
      item.artist?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
            <Library className="w-5 h-5 text-zinc-500" />
            Library
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            {content.length} item{content.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={() => setShowUpload((v) => !v)}
          data-testid="toggle-upload"
          aria-expanded={showUpload}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors",
            showUpload
              ? "bg-violet-600/20 border-violet-500/30 text-violet-300"
              : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700"
          )}
        >
          <Upload className="w-4 h-4" />
          Upload
        </button>
      </div>

      {/* Upload dropzone (collapsible) */}
      {showUpload && (
        <div className="mb-6">
          <UploadDropzone onUploaded={handleUploaded} />
        </div>
      )}

      {/* Tabs + search row */}
      <Tabs.Root
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as TabValue)}
      >
        <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
          <Tabs.List
            className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1"
            aria-label="Filter by content type"
          >
            {TABS.map(({ value, label }) => (
              <Tabs.Trigger
                key={value}
                value={value}
                data-testid={`library-tab-${value}`}
                className={cn(
                  "px-3 py-1.5 rounded text-xs font-medium transition-all outline-none",
                  "data-[state=active]:bg-violet-600 data-[state=active]:text-white",
                  "data-[state=inactive]:text-zinc-400 data-[state=inactive]:hover:text-zinc-100 data-[state=inactive]:hover:bg-zinc-800"
                )}
              >
                {label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
            <input
              type="search"
              placeholder="Search tracks..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="library-search"
              aria-label="Search tracks"
              className="pl-9 pr-4 py-2 text-sm bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 w-56"
            />
          </div>
        </div>

        {TABS.map(({ value }) => (
          <Tabs.Content key={value} value={value}>
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-8 h-8 text-zinc-600 animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-zinc-700">
                <Library className="w-10 h-10 mb-3" />
                <p className="text-sm">
                  {search ? "No tracks match your search" : "No content yet"}
                </p>
                {!search && (
                  <button
                    onClick={() => setShowUpload(true)}
                    className="mt-3 text-xs text-violet-400 hover:text-violet-300 underline underline-offset-2"
                  >
                    Upload your first track
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filtered.map((item) => (
                  <ContentCard
                    key={item.id}
                    item={item}
                    onDeleted={handleDeleted}
                  />
                ))}
              </div>
            )}
          </Tabs.Content>
        ))}
      </Tabs.Root>
    </div>
  );
}
