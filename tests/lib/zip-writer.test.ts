import { describe, expect, it } from "vitest";

import { crc32, dosDateTime, ZipWriter, type Bytes } from "@/lib/zip/writer";

type Read = { name: string; size: number; crc: number; data: Uint8Array; offset: number };

const decoder = new TextDecoder();

/** Reads an archive the way an extractor does: from the end records back through the directory. */
function readZip(bytes: Uint8Array): { entries: Read[]; zip64: boolean } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  let count = view.getUint16(end + 10, true);
  let directoryOffset = view.getUint32(end + 16, true);
  let zip64 = false;
  if (count === 0xffff || directoryOffset === 0xffffffff) {
    zip64 = true;
    const locator = end - 20;
    expect(view.getUint32(locator, true)).toBe(0x07064b50);
    const record = Number(view.getBigUint64(locator + 8, true));
    expect(view.getUint32(record, true)).toBe(0x06064b50);
    count = Number(view.getBigUint64(record + 32, true));
    directoryOffset = Number(view.getBigUint64(record + 48, true));
  }
  const entries: Read[] = [];
  let cursor = directoryOffset;
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(cursor, true)).toBe(0x02014b50);
    const crc = view.getUint32(cursor + 16, true);
    let size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    let offset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    // ZIP64 extra: the overflowing fields, in header order.
    let extra = cursor + 46 + nameLength;
    const extraEnd = extra + extraLength;
    while (extra < extraEnd) {
      const id = view.getUint16(extra, true);
      const length = view.getUint16(extra + 2, true);
      if (id === 0x0001) {
        let field = extra + 4;
        if (size === 0xffffffff) {
          size = Number(view.getBigUint64(field, true));
          field += 16;
        }
        if (offset === 0xffffffff) offset = Number(view.getBigUint64(field, true));
      }
      extra += 4 + length;
    }
    // The local header in front of the data.
    expect(view.getUint32(offset, true)).toBe(0x04034b50);
    const localName = view.getUint16(offset + 26, true);
    const localExtra = view.getUint16(offset + 28, true);
    const start = offset + 30 + localName + localExtra;
    entries.push({ name, size, crc, data: bytes.subarray(start, start + size), offset });
    cursor = extraEnd;
  }
  return { entries, zip64 };
}

function bytes(text: string): Bytes {
  return Uint8Array.from(new TextEncoder().encode(text));
}

function build(writer: ZipWriter, files: { name: string; data: Bytes }[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const file of files) chunks.push(...writer.add(file));
  chunks.push(writer.finish());
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

describe("crc32", () => {
  it("matches the reference value", () => {
    expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe("dosDateTime", () => {
  it("packs the local date and time in 2-second steps", () => {
    const { time, date } = dosDateTime(new Date(2026, 8, 28, 13, 45, 31));
    expect(time).toBe((13 << 11) | (45 << 5) | 15);
    expect(date).toBe(((2026 - 1980) << 9) | (9 << 5) | 28);
  });
  it("never goes before 1980", () => {
    expect(dosDateTime(new Date(1970, 0, 1)).date >> 9).toBe(0);
  });
});

describe("ZipWriter", () => {
  const files = [
    { name: "B20133/B20133-front.png", data: bytes("front image bytes") },
    { name: "B20133/B20133-back.png", data: bytes("back") },
    { name: "موديل ١/موديل ١-لون-أسود.png", data: new Uint8Array([0, 255, 1, 254, 7]) },
  ];

  it("stores every file with its name, size, CRC and bytes", () => {
    const archive = build(new ZipWriter(), files);
    const { entries, zip64 } = readZip(archive);
    expect(zip64).toBe(false);
    expect(entries.map((entry) => entry.name)).toEqual(files.map((file) => file.name));
    entries.forEach((entry, index) => {
      expect(entry.size).toBe(files[index]!.data.length);
      expect(entry.crc).toBe(crc32(files[index]!.data));
      expect([...entry.data]).toEqual([...files[index]!.data]);
    });
  });

  it("hands the data out as given and counts the bytes", () => {
    const writer = new ZipWriter();
    const [header, data] = writer.add(files[0]!);
    expect(data).toBe(files[0]!.data);
    expect(header!.length).toBe(30 + bytes(files[0]!.name).length);
    expect(writer.bytesWritten).toBe(header!.length + data!.length);
  });

  it("switches to ZIP64 records when sizes, offsets or counts pass the limits", () => {
    // The classic limits are 4 GB and 65,535 entries; lowered here so a small archive crosses them.
    const archive = build(new ZipWriter({ size: 40, entries: 3 }), files);
    const { entries, zip64 } = readZip(archive);
    expect(zip64).toBe(true);
    expect(entries.map((entry) => entry.name)).toEqual(files.map((file) => file.name));
    entries.forEach((entry, index) => {
      expect(entry.size).toBe(files[index]!.data.length);
      expect([...entry.data]).toEqual([...files[index]!.data]);
    });
    expect(entries[1]!.offset).toBeGreaterThan(40);
  });

  it("refuses more files once finished", () => {
    const writer = new ZipWriter();
    writer.finish();
    expect(() => writer.add(files[0]!)).toThrow(/finished/);
  });
});
