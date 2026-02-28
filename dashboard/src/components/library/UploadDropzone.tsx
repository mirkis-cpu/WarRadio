"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, CheckCircle2, AlertCircle, Loader2, X } from "lucide-react";
import { contentApi } from "@/lib/api";
import { cn } from "@/lib/utils";

interface UploadState {
  file: File;
  status: "uploading" | "done" | "error";
  error?: string;
}

interface UploadDropzoneProps {
  onUploaded: () => void;
}

export function UploadDropzone({ onUploaded }: UploadDropzoneProps) {
  const [uploads, setUploads] = useState<UploadState[]>([]);

  const updateUpload = useCallback(
    (name: string, patch: Partial<UploadState>) => {
      setUploads((prev) =>
        prev.map((u) => (u.file.name === name ? { ...u, ...patch } : u))
      );
    },
    []
  );

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const newUploads: UploadState[] = acceptedFiles.map((f) => ({
        file: f,
        status: "uploading",
      }));
      setUploads((prev) => [...newUploads, ...prev]);

      await Promise.all(
        acceptedFiles.map(async (file) => {
          try {
            const fd = new FormData();
            fd.append("file", file);
            fd.append("title", file.name.replace(/\.[^.]+$/, ""));
            await contentApi.uploadContent(fd);
            updateUpload(file.name, { status: "done" });
            onUploaded();
          } catch (e) {
            updateUpload(file.name, {
              status: "error",
              error: e instanceof Error ? e.message : "Upload failed",
            });
          }
        })
      );
    },
    [updateUpload, onUploaded]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "audio/*": [".mp3", ".wav", ".ogg", ".aac", ".flac", ".m4a"],
    },
    multiple: true,
  });

  const clearUpload = (name: string) => {
    setUploads((prev) => prev.filter((u) => u.file.name !== name));
  };

  return (
    <div className="space-y-3">
      <div
        {...getRootProps()}
        data-testid="upload-dropzone"
        aria-label="Upload audio files by dropping them here"
        className={cn(
          "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-200",
          isDragActive
            ? "border-violet-500 bg-violet-500/10"
            : "border-zinc-700 bg-zinc-900/50 hover:border-zinc-600 hover:bg-zinc-900"
        )}
      >
        <input {...getInputProps()} />
        <Upload
          className={cn(
            "w-8 h-8 mx-auto mb-3 transition-colors",
            isDragActive ? "text-violet-400" : "text-zinc-600"
          )}
        />
        <p
          className={cn(
            "text-sm font-medium transition-colors",
            isDragActive ? "text-violet-300" : "text-zinc-400"
          )}
        >
          {isDragActive
            ? "Drop audio files here"
            : "Drag & drop audio files, or click to browse"}
        </p>
        <p className="text-xs text-zinc-600 mt-1">
          MP3, WAV, OGG, AAC, FLAC, M4A
        </p>
      </div>

      {/* Upload progress list */}
      {uploads.length > 0 && (
        <ul className="space-y-2">
          {uploads.map(({ file, status, error }) => (
            <li
              key={file.name}
              className="flex items-center gap-3 px-3 py-2.5 bg-zinc-900 border border-zinc-800 rounded-lg"
            >
              {status === "uploading" && (
                <Loader2 className="w-4 h-4 text-zinc-500 animate-spin shrink-0" />
              )}
              {status === "done" && (
                <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
              )}
              {status === "error" && (
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              )}

              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-300 truncate">{file.name}</p>
                {error && (
                  <p className="text-xs text-red-400 truncate">{error}</p>
                )}
              </div>

              {status !== "uploading" && (
                <button
                  onClick={() => clearUpload(file.name)}
                  aria-label={`Dismiss ${file.name}`}
                  data-testid={`dismiss-upload-${file.name}`}
                  className="text-zinc-600 hover:text-zinc-400 transition-colors shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
