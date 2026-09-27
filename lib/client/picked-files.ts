"use client";

/** A file picked by the owner with its folder path ("DS-1024/front.jpg" or just the name). */
export type PickedFile = { file: File; path: string };

function readFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

async function walk(entry: FileSystemEntry, prefix: string, out: PickedFile[]): Promise<void> {
  if (entry.isFile) {
    out.push({
      file: await readFile(entry as FileSystemFileEntry),
      path: `${prefix}${entry.name}`,
    });
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // readEntries returns at most ~100 entries per call; keep reading until it returns none.
  for (;;) {
    const children = await readEntries(reader);
    if (children.length === 0) break;
    for (const child of children) await walk(child, `${prefix}${entry.name}/`, out);
  }
}

/**
 * Files from a drop, folders included (walked recursively with their paths).
 * Must be called synchronously from the drop handler: the browser only lets
 * a page read the dropped entries during the event.
 */
export function filesFromDrop(dataTransfer: DataTransfer): Promise<PickedFile[]> {
  const entries = Array.from(dataTransfer.items ?? [])
    .map((item) => (item.kind === "file" ? item.webkitGetAsEntry() : null))
    .filter((entry): entry is FileSystemEntry => entry !== null);
  const plain = Array.from(dataTransfer.files).map((file) => ({ file, path: file.name }));
  if (entries.length === 0) return Promise.resolve(plain);
  return (async () => {
    const out: PickedFile[] = [];
    for (const entry of entries) await walk(entry, "", out);
    return out;
  })();
}

/** Files from an <input type="file">, keeping folder paths from a folder picker. */
export function filesFromInput(list: FileList | null): PickedFile[] {
  return Array.from(list ?? []).map((file) => ({
    file,
    path: file.webkitRelativePath || file.name,
  }));
}

/** A small JPEG preview (object URL) so a hundred phone photos never decode at full size at once. */
export async function makeThumbnail(file: Blob, width = 240): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(file, { resizeWidth: width, resizeQuality: "medium" });
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.82),
    );
    return blob ? URL.createObjectURL(blob) : null;
  } catch {
    return null;
  }
}

/** Runs tasks with a concurrency limit; each result is either a value or the error. */
export async function runPool<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<({ ok: true; value: R } | { ok: false; error: unknown })[]> {
  const results: ({ ok: true; value: R } | { ok: false; error: unknown })[] = new Array(
    items.length,
  );
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { ok: true, value: await task(items[index]!, index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
