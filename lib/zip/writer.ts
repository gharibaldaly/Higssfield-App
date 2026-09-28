/**
 * A minimal ZIP writer for the browser: files are stored as they are (images
 * and videos are already compressed), so a catalogue can be zipped chunk by
 * chunk straight to disk without a library. Names are UTF-8, and archives
 * beyond the classic limits (4 GB, 65,535 entries) switch to ZIP64.
 */

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_RECORD = 0x06054b50;
const ZIP64_END_RECORD = 0x06064b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EXTRA_ID = 0x0001;
const UTF8_NAMES = 0x0800;
const VERSION_STORE = 20;
const VERSION_ZIP64 = 45;
const MAX_32 = 0xffffffff;
const MAX_16 = 0xffff;

export type ZipLimits = {
  /** Sizes and offsets from this value up go into ZIP64 fields. */
  size: number;
  /** Entry counts from this value up go into the ZIP64 end record. */
  entries: number;
};

export const CLASSIC_LIMITS: ZipLimits = { size: MAX_32, entries: MAX_16 };

/** Bytes backed by a plain ArrayBuffer, as file streams and Blobs want them. */
export type Bytes = Uint8Array<ArrayBuffer>;

export type ZipEntry = {
  /** Path inside the archive, with `/` between folders. */
  name: string;
  data: Bytes;
  modified?: Date;
};

type Written = {
  name: Uint8Array;
  crc: number;
  size: number;
  offset: number;
  time: number;
  date: number;
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time, as ZIP stores them (local time, 2-second steps, from 1980). */
export function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function zip64Extra(fields: number[]): Uint8Array {
  const extra = new Uint8Array(4 + 8 * fields.length);
  const view = new DataView(extra.buffer);
  view.setUint16(0, ZIP64_EXTRA_ID, true);
  view.setUint16(2, 8 * fields.length, true);
  fields.forEach((field, index) => view.setBigUint64(4 + 8 * index, BigInt(field), true));
  return extra;
}

function concat(parts: Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export class ZipWriter {
  private readonly entries: Written[] = [];
  private offset = 0;
  private finished = false;
  private readonly encoder = new TextEncoder();

  constructor(private readonly limits: ZipLimits = CLASSIC_LIMITS) {}

  /** Bytes handed out so far, headers included. */
  get bytesWritten(): number {
    return this.offset;
  }

  /** The chunks to write for one file: its header, then its bytes as given (no copy). */
  add({ name, data, modified = new Date() }: ZipEntry): Bytes[] {
    if (this.finished) throw new Error("zip: the archive is finished");
    const encoded = this.encoder.encode(name);
    if (encoded.length === 0 || encoded.length > MAX_16) throw new Error("zip: bad file name");
    const big = data.length >= this.limits.size;
    const extra = big ? zip64Extra([data.length, data.length]) : new Uint8Array(0);
    const { time, date } = dosDateTime(modified);
    const crc = crc32(data);

    const header = new Uint8Array(30 + encoded.length + extra.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, LOCAL_HEADER, true);
    view.setUint16(4, big ? VERSION_ZIP64 : VERSION_STORE, true);
    view.setUint16(6, UTF8_NAMES, true);
    view.setUint16(8, 0, true); // stored
    view.setUint16(10, time, true);
    view.setUint16(12, date, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, big ? MAX_32 : data.length, true);
    view.setUint32(22, big ? MAX_32 : data.length, true);
    view.setUint16(26, encoded.length, true);
    view.setUint16(28, extra.length, true);
    header.set(encoded, 30);
    header.set(extra, 30 + encoded.length);

    this.entries.push({ name: encoded, crc, size: data.length, offset: this.offset, time, date });
    this.offset += header.length + data.length;
    return [header, data];
  }

  /** The central directory and end records, written once after the last file. */
  finish(): Bytes {
    if (this.finished) throw new Error("zip: the archive is finished");
    this.finished = true;
    const parts: Bytes[] = [];
    const directoryOffset = this.offset;

    for (const entry of this.entries) {
      const bigSize = entry.size >= this.limits.size;
      const bigOffset = entry.offset >= this.limits.size;
      const fields: number[] = [];
      if (bigSize) fields.push(entry.size, entry.size);
      if (bigOffset) fields.push(entry.offset);
      const extra = fields.length > 0 ? zip64Extra(fields) : new Uint8Array(0);
      const version = fields.length > 0 ? VERSION_ZIP64 : VERSION_STORE;

      const header = new Uint8Array(46 + entry.name.length + extra.length);
      const view = new DataView(header.buffer);
      view.setUint32(0, CENTRAL_HEADER, true);
      view.setUint16(4, version, true); // made by
      view.setUint16(6, version, true); // needed to extract
      view.setUint16(8, UTF8_NAMES, true);
      view.setUint16(10, 0, true); // stored
      view.setUint16(12, entry.time, true);
      view.setUint16(14, entry.date, true);
      view.setUint32(16, entry.crc, true);
      view.setUint32(20, bigSize ? MAX_32 : entry.size, true);
      view.setUint32(24, bigSize ? MAX_32 : entry.size, true);
      view.setUint16(28, entry.name.length, true);
      view.setUint16(30, extra.length, true);
      view.setUint16(32, 0, true); // comment length
      view.setUint16(34, 0, true); // disk
      view.setUint16(36, 0, true); // internal attributes
      view.setUint32(38, 0, true); // external attributes
      view.setUint32(42, bigOffset ? MAX_32 : entry.offset, true);
      header.set(entry.name, 46);
      header.set(extra, 46 + entry.name.length);
      parts.push(header);
    }

    const directorySize = parts.reduce((sum, part) => sum + part.length, 0);
    const count = this.entries.length;
    const zip64 =
      count >= this.limits.entries ||
      directorySize >= this.limits.size ||
      directoryOffset >= this.limits.size;

    if (zip64) {
      const record = new Uint8Array(56);
      const view = new DataView(record.buffer);
      view.setUint32(0, ZIP64_END_RECORD, true);
      view.setBigUint64(4, 44n, true); // size of the rest of the record
      view.setUint16(12, VERSION_ZIP64, true);
      view.setUint16(14, VERSION_ZIP64, true);
      view.setUint32(16, 0, true); // this disk
      view.setUint32(20, 0, true); // directory disk
      view.setBigUint64(24, BigInt(count), true);
      view.setBigUint64(32, BigInt(count), true);
      view.setBigUint64(40, BigInt(directorySize), true);
      view.setBigUint64(48, BigInt(directoryOffset), true);

      const locator = new Uint8Array(20);
      const locatorView = new DataView(locator.buffer);
      locatorView.setUint32(0, ZIP64_LOCATOR, true);
      locatorView.setUint32(4, 0, true);
      locatorView.setBigUint64(8, BigInt(directoryOffset + directorySize), true);
      locatorView.setUint32(16, 1, true);
      parts.push(record, locator);
    }

    const end = new Uint8Array(22);
    const view = new DataView(end.buffer);
    view.setUint32(0, END_RECORD, true);
    view.setUint16(4, 0, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, zip64 ? MAX_16 : count, true);
    view.setUint16(10, zip64 ? MAX_16 : count, true);
    view.setUint32(12, zip64 ? MAX_32 : directorySize, true);
    view.setUint32(16, zip64 ? MAX_32 : directoryOffset, true);
    view.setUint16(20, 0, true);
    parts.push(end);

    return concat(parts);
  }
}
