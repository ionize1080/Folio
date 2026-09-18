// ZIP STORE: no recompression of PDF streams; bounded parsing and zero-copy views.
const enc = new TextEncoder(),
  dec = new TextDecoder(),
  table = Uint32Array.from({ length: 256 }, (_, n) => {
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
  });
export function crc32(bytes) {
  let n = 0xffffffff;
  for (const b of bytes) n = table[(n ^ b) & 255] ^ (n >>> 8);
  return (n ^ 0xffffffff) >>> 0;
}
const header = (n) => {
  const b = new Uint8Array(n);
  return [b, new DataView(b.buffer)];
};
export function zipBlob(entries) {
  const parts = [],
    central = [];
  let offset = 0;
  if (entries.size > 10000) throw Error("工程资源数量过多");
  for (const [name, data] of entries) {
    const nm = enc.encode(name),
      crc = crc32(data),
      [b, v] = header(30);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x800, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, data.length, true);
    v.setUint32(22, data.length, true);
    v.setUint16(26, nm.length, true);
    parts.push(b, nm, data);
    const [c, w] = header(46);
    w.setUint32(0, 0x02014b50, true);
    w.setUint16(4, 20, true);
    w.setUint16(6, 20, true);
    w.setUint16(8, 0x800, true);
    w.setUint32(16, crc, true);
    w.setUint32(20, data.length, true);
    w.setUint32(24, data.length, true);
    w.setUint16(28, nm.length, true);
    w.setUint32(42, offset, true);
    central.push(c, nm);
    offset += 30 + nm.length + data.length;
  }
  const size = central.reduce((n, b) => n + b.length, 0),
    [end, v] = header(22);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, entries.size, true);
  v.setUint16(10, entries.size, true);
  v.setUint32(12, size, true);
  v.setUint32(16, offset, true);
  if (offset + size + 22 > 1024 ** 3) throw Error("工程超过 1 GB 上限");
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}
export function unzipStored(bytes) {
  if (bytes.length < 22 || bytes.length > 1024 ** 3)
    throw Error("工程 ZIP 大小无效");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let e = bytes.length - 22;
  if (v.getUint32(e, true) !== 0x06054b50 || v.getUint16(e + 20, true) !== 0)
    throw Error("工程 ZIP 尾部损坏");
  const count = v.getUint16(e + 10, true),
    size = v.getUint32(e + 12, true),
    start = v.getUint32(e + 16, true);
  if (
    count > 10000 ||
    v.getUint16(e + 4, true) ||
    v.getUint16(e + 6, true) ||
    v.getUint16(e + 8, true) !== count ||
    start + size !== e
  )
    throw Error("工程 ZIP 目录无效");
  const files = new Map();
  let at = start,
    total = 0,
    lastEnd = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > e || v.getUint32(at, true) !== 0x02014b50)
      throw Error("工程 ZIP 目录损坏");
    const flags = v.getUint16(at + 8, true),
      method = v.getUint16(at + 10, true),
      crc = v.getUint32(at + 16, true),
      cs = v.getUint32(at + 20, true),
      n = v.getUint32(at + 24, true),
      nl = v.getUint16(at + 28, true),
      xl = v.getUint16(at + 30, true),
      cl = v.getUint16(at + 32, true),
      off = v.getUint32(at + 42, true);
    if (
      at + 46 + nl + xl + cl > e ||
      method !== 0 ||
      flags !== 0x800 ||
      cs !== n ||
      off + 30 > start ||
      off < lastEnd
    )
      throw Error("工程 ZIP 资源格式不支持");
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nl));
    if (
      !/^(source\.pdf|state\.json|manifest\.json|assets\/[a-f0-9]{64}\.(pdf|json))$/.test(
        name,
      ) ||
      files.has(name)
    )
      throw Error("工程 ZIP 资源路径无效");
    if (
      v.getUint32(off, true) !== 0x04034b50 ||
      v.getUint16(off + 6, true) !== flags ||
      v.getUint16(off + 8, true) !== method ||
      v.getUint32(off + 14, true) !== crc ||
      v.getUint32(off + 18, true) !== n ||
      v.getUint32(off + 22, true) !== n
    )
      throw Error("工程 ZIP 头部不一致");
    const lnl = v.getUint16(off + 26, true),
      lxl = v.getUint16(off + 28, true),
      pos = off + 30 + lnl + lxl;
    if (
      pos + n > start ||
      dec.decode(bytes.subarray(off + 30, off + 30 + lnl)) !== name ||
      (total += n) > 1024 ** 3
    )
      throw Error("工程 ZIP 资源长度无效");
    const data = bytes.subarray(pos, pos + n);
    if (crc32(data) !== crc) throw Error("工程资源校验失败：" + name);
    files.set(name, data);
    lastEnd = pos + n;
    at += 46 + nl + xl + cl;
  }
  if (at !== e) throw Error("工程 ZIP 目录长度不一致");
  return files;
}
