// pipelines/lib/netcdf3.mjs
//
// A reader for classic NetCDF files (CDF-1, the 64-bit-offset CDF-2 and
// the 64-bit-data CDF-5), enough for the pipelines to read gridded data
// without a native library. The format is Unidata's "NetCDF classic and
// 64-bit offset file formats" (the header grammar): big-endian, a header
// of dimensions, attributes and variables, then each fixed-size
// variable's values in one block, and the record variables' values
// interleaved record by record. NetCDF-4 files are HDF5 underneath, and
// are refused here.
//
//   const nc = readNetcdf(readFileSync(path));
//   nc.dims, nc.attrs, nc.vars[name] = { dims, shape, type, attrs };
//   nc.read(name) -> Float64Array (or a string for char data), row-major.

const TYPES = {
  1: { name: 'byte', size: 1, get: (v, o) => v.getInt8(o) },
  2: { name: 'char', size: 1, get: (v, o) => v.getUint8(o) },
  3: { name: 'short', size: 2, get: (v, o) => v.getInt16(o) },
  4: { name: 'int', size: 4, get: (v, o) => v.getInt32(o) },
  5: { name: 'float', size: 4, get: (v, o) => v.getFloat32(o) },
  6: { name: 'double', size: 8, get: (v, o) => v.getFloat64(o) },
  7: { name: 'ubyte', size: 1, get: (v, o) => v.getUint8(o) },
  8: { name: 'ushort', size: 2, get: (v, o) => v.getUint16(o) },
  9: { name: 'uint', size: 4, get: (v, o) => v.getUint32(o) },
  10: { name: 'int64', size: 8, get: (v, o) => Number(v.getBigInt64(o)) },
  11: { name: 'uint64', size: 8, get: (v, o) => Number(v.getBigUint64(o)) },
};
const NC_DIMENSION = 10, NC_VARIABLE = 11, NC_ATTRIBUTE = 12;
const pad4 = (n) => (n + 3) & ~3;

export function readNetcdf(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = String.fromCharCode(buf[0], buf[1], buf[2]);
  if (magic !== 'CDF') {
    const hdf = buf[1] === 0x48 && buf[2] === 0x44 && buf[3] === 0x46;
    throw new Error(hdf ? 'a NetCDF-4 (HDF5) file: not a classic NetCDF file' : 'not a NetCDF file');
  }
  const version = buf[3];
  if (![1, 2, 5].includes(version)) throw new Error(`unknown NetCDF version ${version}`);
  let o = 4;
  // Counts are 32-bit, or 64-bit in CDF-5; offsets are 32-bit only in CDF-1.
  const count = () => { const n = version === 5 ? Number(view.getBigUint64(o)) : view.getUint32(o); o += version === 5 ? 8 : 4; return n; };
  const offset = () => { const n = version === 1 ? view.getUint32(o) : Number(view.getBigUint64(o)); o += version === 1 ? 4 : 8; return n; };
  const tag = () => { const t = view.getUint32(o); o += 4; return t; };
  const name = () => { const n = count(); const s = buf.toString('utf8', o, o + n); o += pad4(n); return s; };
  const values = (type, n) => {
    const t = TYPES[type];
    if (!t) throw new Error(`unknown NetCDF type ${type}`);
    let out;
    if (t.name === 'char') out = buf.toString('utf8', o, o + n).replace(/\0+$/, '');
    else { out = Array.from({ length: n }, (_, i) => t.get(view, o + i * t.size)); if (n === 1) out = out[0]; }
    o += pad4(n * t.size);
    return out;
  };
  const attrList = () => {
    const attrs = {};
    const t = tag(), n = count();
    if (t === 0 && n === 0) return attrs;
    if (t !== NC_ATTRIBUTE) throw new Error('bad attribute list');
    for (let i = 0; i < n; i++) { const k = name(); const type = tag(); attrs[k] = values(type, count()); }
    return attrs;
  };

  const numrecs = count();
  const dims = [];
  {
    const t = tag(), n = count();
    if (!(t === 0 && n === 0)) {
      if (t !== NC_DIMENSION) throw new Error('bad dimension list');
      for (let i = 0; i < n; i++) dims.push({ name: name(), length: count() });
    }
  }
  const attrs = attrList();
  const vars = {};
  {
    const t = tag(), n = count();
    if (!(t === 0 && n === 0)) {
      if (t !== NC_VARIABLE) throw new Error('bad variable list');
      for (let i = 0; i < n; i++) {
        const vname = name();
        const ndims = count();
        const ids = Array.from({ length: ndims }, () => count());
        const vattrs = attrList();
        const type = tag();
        const vsize = count();
        const begin = offset();
        const record = ids.length > 0 && dims[ids[0]].length === 0;
        vars[vname] = {
          dims: ids.map((d) => dims[d].name),
          shape: ids.map((d) => (dims[d].length === 0 ? numrecs : dims[d].length)),
          type: TYPES[type].name, typeId: type, attrs: vattrs, vsize, begin, record,
        };
      }
    }
  }
  // Each record holds every record variable's slab, one after the other;
  // with one record variable, its slabs are not padded.
  const recVars = Object.values(vars).filter((v) => v.record);
  const recSize = recVars.length === 1
    ? recVars[0].shape.slice(1).reduce((a, b) => a * b, 1) * TYPES[recVars[0].typeId].size
    : recVars.reduce((n, v) => n + v.vsize, 0);

  function read(vname) {
    const v = vars[vname];
    if (!v) throw new Error(`no variable ${vname}`);
    const t = TYPES[v.typeId];
    const per = v.shape.slice(v.record ? 1 : 0).reduce((a, b) => a * b, 1);
    if (t.name === 'char' && !v.record) return buf.toString('utf8', v.begin, v.begin + per).replace(/\0+$/, '');
    const recs = v.record ? v.shape[0] : 1;
    const out = new Float64Array(recs * per);
    for (let r = 0; r < recs; r++) {
      const base = v.begin + r * (v.record ? recSize : 0);
      for (let i = 0; i < per; i++) out[r * per + i] = t.get(view, base + i * t.size);
    }
    return out;
  }
  return { version, numrecs, dims, attrs, vars, read };
}
