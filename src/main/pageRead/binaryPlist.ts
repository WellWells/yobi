/**
 * Apple's binary property list (`bplist00`), read into plain values: what a shared shortcut's file
 * is. Dictionaries become objects, arrays and sets arrays, data a Uint8Array, a date its epoch
 * milliseconds, a UID its number. A malformed file throws; a deep or self-repeating one stops at the
 * limits below instead of running away (an object may be referenced from many places).
 */

const MAGIC = 'bplist00';
const TRAILER_BYTES = 32;
const MAX_DEPTH = 64;
const MAX_NODES = 200_000;
/** Seconds from the Unix epoch to Apple's, 2001-01-01. */
const APPLE_EPOCH_S = 978_307_200;

export type PlistValue = null | boolean | number | string | Uint8Array | PlistValue[] | { [key: string]: PlistValue };

function uint(view: DataView, at: number, size: number): number {
  if (size === 1) return view.getUint8(at);
  if (size === 2) return view.getUint16(at);
  if (size === 4) return view.getUint32(at);
  if (size === 8) {
    const value = view.getBigUint64(at);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Property list number out of range');
    return Number(value);
  }
  throw new Error(`Property list integer of ${size} bytes`);
}

/** An integer object: 1, 2 and 4 bytes unsigned, 8 signed; a 16-byte one is read by its low half. */
function int(view: DataView, at: number, size: number): number {
  if (size === 8) return Number(view.getBigInt64(at));
  if (size === 16) return Number(view.getBigInt64(at + 8));
  return uint(view, at, size);
}

export function parseBinaryPlist(input: Uint8Array): PlistValue {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (bytes.length < MAGIC.length + TRAILER_BYTES || bytes.toString('latin1', 0, MAGIC.length) !== MAGIC) {
    throw new Error('Not a binary property list');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const trailer = bytes.length - TRAILER_BYTES;
  const offsetSize = bytes[trailer + 6];
  const refSize = bytes[trailer + 7];
  const count = uint(view, trailer + 8, 8);
  const top = uint(view, trailer + 16, 8);
  const table = uint(view, trailer + 24, 8);
  if (!offsetSize || !refSize || top >= count || table + count * offsetSize > trailer) throw new Error('Malformed property list trailer');
  let nodes = 0;

  /** Where an object's content starts and how many items it has: past a following integer when the marker says 15. */
  function lengthAt(at: number, info: number): [number, number] {
    if (info !== 0x0f) return [info, at + 1];
    const size = 1 << (bytes[at + 1] & 0x0f);
    return [uint(view, at + 2, size), at + 2 + size];
  }

  function span(start: number, length: number): void {
    if (start + length > table) throw new Error('Property list object runs past its data');
  }

  function refs(start: number, length: number): number[] {
    span(start, length * refSize);
    return Array.from({ length }, (_, index) => uint(view, start + index * refSize, refSize));
  }

  function read(ref: number, depth: number): PlistValue {
    nodes += 1;
    if (depth > MAX_DEPTH || nodes > MAX_NODES) throw new Error('Property list too deep or too large');
    if (ref >= count) throw new Error('Property list reference out of range');
    const at = uint(view, table + ref * offsetSize, offsetSize);
    if (at >= table) throw new Error('Property list offset out of range');
    const marker = bytes[at];
    const info = marker & 0x0f;
    switch (marker >> 4) {
      case 0x0:
        return info === 0x09 ? true : info === 0x08 ? false : null;
      case 0x1:
        return int(view, at + 1, 1 << info);
      case 0x2:
        return info === 2 ? view.getFloat32(at + 1) : view.getFloat64(at + 1);
      case 0x3:
        return (view.getFloat64(at + 1) + APPLE_EPOCH_S) * 1_000;
      case 0x8:
        return uint(view, at + 1, info + 1);
      default:
        break;
    }
    const [length, start] = lengthAt(at, info);
    switch (marker >> 4) {
      case 0x4:
        span(start, length);
        return new Uint8Array(bytes.subarray(start, start + length));
      case 0x5:
        span(start, length);
        return bytes.toString('latin1', start, start + length);
      case 0x6: {
        span(start, length * 2);
        return Buffer.from(bytes.subarray(start, start + length * 2)).swap16().toString('utf16le');
      }
      case 0x7:
        span(start, length);
        return bytes.toString('utf8', start, start + length);
      case 0xa:
      case 0xc:
        return refs(start, length).map((item) => read(item, depth + 1));
      case 0xd: {
        const keys = refs(start, length);
        const values = refs(start + length * refSize, length);
        const out: { [key: string]: PlistValue } = {};
        keys.forEach((key, index) => {
          out[String(read(key, depth + 1))] = read(values[index], depth + 1);
        });
        return out;
      }
      default:
        throw new Error(`Property list object of an unknown kind (${marker.toString(16)})`);
    }
  }

  return read(top, 0);
}
