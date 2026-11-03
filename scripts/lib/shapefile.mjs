// Minimal ESRI shapefile (.shp polygons) and dBASE (.dbf) readers, so loaders need no npm packages.
// Spec: ESRI Shapefile Technical Description (1998) and dBASE III table format.

/**
 * Read polygon records from a .shp buffer. Returns an array (one entry per record, in file
 * order) of rings in the file's native coordinates, or null for null shapes.
 * Only the records whose index passes `want(i)` are decoded, so large files stay cheap.
 */
export function readShpPolygons(buf, want = () => true) {
  if (buf.readInt32BE(0) !== 9994) throw new Error('Not a shapefile (bad file code)');
  const out = [];
  let p = 100, i = 0;
  while (p + 8 <= buf.length) {
    const len = buf.readInt32BE(p + 4) * 2; // content length in 16-bit words
    const c = p + 8;
    p = c + len;
    const idx = i++;
    if (!want(idx)) { out.push(null); continue; }
    const type = buf.readInt32LE(c);
    if (type === 0) { out.push(null); continue; }
    if (type !== 5 && type !== 15 && type !== 25) throw new Error(`Unsupported shape type ${type} (polygons only)`);
    const numParts = buf.readInt32LE(c + 36), numPoints = buf.readInt32LE(c + 40);
    const parts = [];
    for (let k = 0; k < numParts; k++) parts.push(buf.readInt32LE(c + 44 + k * 4));
    const pts = c + 44 + numParts * 4;
    const rings = [];
    for (let k = 0; k < numParts; k++) {
      const s = parts[k], e = k + 1 < numParts ? parts[k + 1] : numPoints;
      const ring = new Array(e - s);
      for (let j = s; j < e; j++) ring[j - s] = [buf.readDoubleLE(pts + j * 16), buf.readDoubleLE(pts + j * 16 + 8)];
      rings.push(ring);
    }
    out.push(rings);
  }
  return out;
}

/** Read a .dbf buffer into an array of plain objects (strings trimmed; N/F as numbers; D as yyyy-mm-dd). */
export function readDbf(buf) {
  const n = buf.readUInt32LE(4), headerLen = buf.readUInt16LE(8), recLen = buf.readUInt16LE(10);
  const fields = [];
  for (let p = 32; buf[p] !== 0x0d && p < headerLen; p += 32) {
    fields.push({ name: buf.toString('latin1', p, p + 11).replace(/\0.*$/s, ''), type: String.fromCharCode(buf[p + 11]), len: buf[p + 16] });
  }
  const rows = new Array(n);
  for (let i = 0; i < n; i++) {
    let o = headerLen + i * recLen + 1; // skip deletion flag
    const r = {};
    for (const f of fields) {
      const raw = buf.toString('latin1', o, o + f.len).trim();
      o += f.len;
      if (f.type === 'N' || f.type === 'F') r[f.name] = raw === '' ? null : Number(raw);
      else if (f.type === 'D') r[f.name] = /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : null;
      else r[f.name] = raw === '' ? null : raw;
    }
    rows[i] = r;
  }
  return rows;
}
