"use client";

import { Download, Loader2, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { getJson } from "@/components/common/post-json";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/controls";
import type { CollectionFiles, CollectionKind } from "@/lib/library/collections";
import { safeFileName } from "@/lib/library/file-names";
import { ZipWriter, type Bytes } from "@/lib/zip/writer";

/** Images fetched ahead of the one being written. */
const PREFETCH = 3;
const ATTEMPTS = 3;

/** Where the archive's bytes go as they are made. */
type Sink = {
  write(chunk: Bytes): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
};

type SavePicker = (options: {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandle>;

/** Streams to the file the owner picked, so memory stays small however big the batch is. */
async function fileSink(handle: FileSystemFileHandle): Promise<Sink> {
  const writable = await handle.createWritable();
  return {
    write: (chunk) => writable.write(chunk),
    close: () => writable.close(),
    abort: () => writable.abort(),
  };
}

/** Browsers without a save picker: the archive is built in memory, then downloaded. */
function blobSink(fileName: string): Sink {
  const chunks: Bytes[] = [];
  return {
    async write(chunk) {
      chunks.push(chunk);
    },
    async close() {
      const url = URL.createObjectURL(new Blob(chunks, { type: "application/zip" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    async abort() {
      chunks.length = 0;
    },
  };
}

async function fetchBytes(url: string, signal: AbortSignal): Promise<Bytes> {
  let failure: unknown;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      // Never the cache: an <img> may have stored the picture without the CORS answer.
      const response = await fetch(url, { signal, cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (signal.aborted) throw error;
      failure = error;
    }
  }
  throw failure;
}

/**
 * One button that downloads a whole collection as a zip. The images come
 * straight from Storage into the browser, which zips them itself: nothing
 * passes through a server function, so a batch of any size works.
 */
export function CollectionDownload({
  kind,
  id,
  name,
  scope,
  count,
}: {
  kind: CollectionKind;
  id: string;
  name: string;
  scope: "all" | "approved";
  count: number;
}) {
  const t = useTranslations("library.collection");
  const format = useFormatter();
  const [progress, setProgress] = useState<{ done: number; total: number; bytes: number } | null>(
    null,
  );
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function start() {
    const fileName = `${safeFileName(name, kind)}.zip`;
    // The save dialog must open from the click itself, before anything is fetched.
    const picker = (window as Window & { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
    let sink: Sink;
    if (picker) {
      try {
        const handle = await picker.call(window, {
          suggestedName: fileName,
          types: [{ description: "ZIP", accept: { "application/zip": [".zip"] } }],
        });
        sink = await fileSink(handle);
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        sink = blobSink(fileName);
      }
    } else {
      sink = blobSink(fileName);
    }

    const abort = new AbortController();
    controller.current = abort;
    setProgress({ done: 0, total: 0, bytes: 0 });
    try {
      const listed = await getJson<CollectionFiles>(
        `/api/library/files?${kind}=${id}&scope=${scope}`,
      );
      if (!listed.ok) throw new Error(listed.error);
      const files = listed.data.files;
      if (files.length === 0) throw new Error(t("nothing"));
      setProgress({ done: 0, total: files.length, bytes: 0 });

      const zip = new ZipWriter();
      const ahead = new Map<number, Promise<Bytes>>();
      const fetchAhead = (index: number) => {
        const file = files[index];
        if (!file || ahead.has(index)) return;
        const bytes = fetchBytes(file.url, abort.signal);
        bytes.catch(() => undefined); // reported where it is awaited
        ahead.set(index, bytes);
      };
      for (let index = 0; index < PREFETCH; index++) fetchAhead(index);

      for (let index = 0; index < files.length; index++) {
        fetchAhead(index + PREFETCH);
        const file = files[index]!;
        let data: Bytes;
        try {
          data = await ahead.get(index)!;
        } catch (error) {
          if (abort.signal.aborted) throw error;
          throw new Error(t("failed", { file: file.path }));
        }
        ahead.delete(index);
        for (const chunk of zip.add({ name: file.path, data })) await sink.write(chunk);
        setProgress({ done: index + 1, total: files.length, bytes: zip.bytesWritten });
      }
      await sink.write(zip.finish());
      await sink.close();
      toast.success(t("saved", { name: fileName }));
    } catch (error) {
      await sink.abort().catch(() => undefined);
      if (abort.signal.aborted) toast.info(t("cancelled"));
      else toast.error(error instanceof Error ? error.message : t("failedUnknown"));
    } finally {
      controller.current = null;
      setProgress(null);
    }
  }

  if (progress) {
    const percent = progress.total > 0 ? (progress.done / progress.total) * 100 : 0;
    return (
      <div className="flex min-w-64 flex-col gap-2 rounded-(--radius-control) border border-border px-4 py-3">
        <div className="flex items-center gap-3 text-sm">
          <Loader2 className="size-4 animate-spin text-accent-ink" aria-hidden />
          <span className="flex-1 truncate">
            {progress.total === 0
              ? t("listing")
              : t("progress", {
                  done: progress.done,
                  total: progress.total,
                  mb: format.number(progress.bytes / 1_000_000, { maximumFractionDigits: 0 }),
                })}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => controller.current?.abort()}
            aria-label={t("cancel")}
          >
            <X aria-hidden />
          </Button>
        </div>
        <Progress
          value={percent}
          indeterminate={progress.total === 0}
          aria-label={t("progressLabel")}
        />
      </div>
    );
  }

  return (
    <Button onClick={() => void start()} disabled={count === 0}>
      <Download aria-hidden />
      {t("download", { count })}
    </Button>
  );
}
