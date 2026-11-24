// src/chart/overlay.ts
//
// The chart's linework and lettering, drawn in a 2D canvas over the raster
// (docs/frontend/chart.md#lettering): the graticule, the sheet grid with
// its codes and names, the IAU names sized by the feature's diameter, the
// landing sites, the console's craft's ground track, and on the Earth the
// launch sites, the satellite's ground track and the atlas grid; then the sheet's furniture: the border's figures, the
// scale bar and the north arrow. Ink on the paper's halo, as a printed
// chart is, so it reads on the dark maria and the pale highlands alike.
// It returns what can be pointed at (names, sites, pads, sheets), with
// their boxes on screen.

import { forward, inverse, kmPerPx, wrapPi, type View } from './projection';
import type { Viewport } from './ChartRenderer';
import type { Sheet } from './sheets';

const D = Math.PI / 180;
export const INK = '#1d1b16', HALO = 'rgba(233, 227, 214, 0.88)', ENGRAVE = '#70220d', PAPER = '#e9e3d6';
// The tracks as the 3D view draws them: a satellite's pale amber, its pass
// and place bright amber; the console's craft amber, as its conic is.
const AMBER = '#ffb22e', PALE = '#ecd9b0', TRACK_EDGE = '#121110';

export interface Feature { name: string; type: string; lat: number; lon: number; diamKm: number; id: number }   // lat, lon rad
export interface SiteMark { key: string; name: string; lat: number; lon: number; kind: string }
export interface PadMark { key: string; name: string; pad: string; lat: number; lon: number }
// A ground track (lat, lon rad): solid to nowIndex, dashed ahead. impact:
// where a craft's two-body orbit meets the ground.
export interface Track { kind: 'sat' | 'craft'; line: [number, number][]; nowIndex: number; pass: [number, number][] | null; place: [number, number] | null; name: string; impact: [number, number] | null }
export interface Hit { kind: 'name' | 'site' | 'pad' | 'sheet'; key: string; label: string; x: number; y: number; w: number; h: number }

export interface OverlayInput {
  ports: (Viewport & { inset: 'n' | 's' | null })[];
  frame: { x: number; y: number; w: number; h: number };     // the main map's box (CSS px)
  radiusKm: number;
  lonStyle: 'ew' | 'east';                                   // 60° W, or 300° E
  grid: boolean; names: boolean; sites: boolean; sheetsOn: boolean; pads: boolean; atlas: boolean;
  features: readonly Feature[];
  sheets: readonly Sheet[]; sheetNames: Record<string, string>;
  siteMarks: readonly SiteMark[]; padMarks: readonly PadMark[];
  tracks: readonly Track[];
  hover: string | null;
  regional: ReadonlySet<string>;                             // Gazetteer type codes lettered as regions
  reserved: readonly { x: number; y: number; w: number; h: number }[];   // canvas px kept clear (the scale bar, the north arrow)
}

const FONT = { sans: "'B612', system-ui, sans-serif", display: "'Michroma', 'B612', sans-serif", mono: "'B612 Mono', ui-monospace, monospace" };

function lonText(lonRad: number, style: 'ew' | 'east'): string {
  let d = Math.round(((lonRad / D) + 540) % 360 - 180);
  if (style === 'east') return `${(d + 360) % 360}°E`;
  if (d === 180 || d === -180) return '180°';
  return d === 0 ? '0°' : d > 0 ? `${d}°E` : `${-d}°W`;
}
const latText = (latRad: number): string => { const d = Math.round(latRad / D); return d === 0 ? '0°' : d > 0 ? `${d}°N` : `${-d}°S`; };

function niceStep(minDeg: number): number {
  for (const s of [0.25, 0.5, 1, 2, 5, 10, 15, 30, 45, 90]) if (s >= minDeg) return s;
  return 90;
}

// A line of (lat, lon) points, densified and drawn in a view. In simple
// cylindrical its longitudes are unwrapped and it is drawn once per turn
// that can show, so a line over the 180° meridian is whole.
function polyline(ctx: CanvasRenderingContext2D, v: View, pts: readonly [number, number][], step = 2 * D): void {
  if (pts.length < 2) return;
  const dense: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [a0, b0] = pts[i], [a1, b1] = pts[i + 1];
    const db = wrapPi(b1 - b0), n = Math.max(1, Math.ceil(Math.max(Math.abs(a1 - a0), Math.abs(db)) / step));
    for (let k = 0; k < n; k++) dense.push([a0 + ((a1 - a0) * k) / n, b0 + (db * k) / n]);
  }
  dense.push(pts[pts.length - 1]);
  if (v.proj === 'eq') {
    let lon = wrapPi(dense[0][1] - v.lon0);
    const xs: number[] = [lon];
    for (let i = 1; i < dense.length; i++) { lon += wrapPi(dense[i][1] - dense[i - 1][1]); xs.push(lon); }
    const lo = Math.min(...xs), hi = Math.max(...xs), half = v.w / 2 / v.scale;
    for (let k = Math.floor((-half - hi) / (2 * Math.PI)); k <= Math.ceil((half - lo) / (2 * Math.PI)); k++) {
      ctx.beginPath();
      for (let i = 0; i < dense.length; i++) {
        const x = v.w / 2 + v.scale * (xs[i] + 2 * Math.PI * k), y = v.h / 2 - v.scale * (dense[i][0] - v.lat0);
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    return;
  }
  ctx.beginPath();
  dense.forEach(([a, b], i) => { const [x, y] = forward(v, a, b); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.stroke();
}

// Screen positions of a point in a view: one, or in simple cylindrical
// every copy across the view's width.
function places(v: View, lat: number, lon: number): [number, number][] {
  if (v.proj !== 'eq') return [forward(v, lat, lon)];
  const out: [number, number][] = [];
  const [x0, y] = forward(v, lat, lon), turn = 2 * Math.PI * v.scale;
  for (let x = x0 - turn * Math.ceil(x0 / turn); x < v.w + 40; x += turn) if (x > -40) out.push([x, y]);
  return out;
}

function halo(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width = 3): void {
  ctx.lineWidth = width; ctx.strokeStyle = HALO; ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
}

function spaced(ctx: CanvasRenderingContext2D, text: string, em: number): string {
  // Canvas letter spacing (Chrome, Safari 18): else the plain text.
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in c) c.letterSpacing = `${em}em`;
  return text;
}

export function drawOverlay(ctx: CanvasRenderingContext2D, o: OverlayInput): Hit[] {
  const hits: Hit[] = [];
  // Lettering already placed, in canvas px, shared by every view: a name
  // never overprints another, a site or an inset.
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const insets = o.ports.filter((p) => p.inset);
  placed.push(...o.reserved);
  for (const p of insets) placed.push({ x: p.x - 4, y: p.y - 20, w: p.view.w + 8, h: p.view.h + 24 });
  for (const port of o.ports) {
    const v = port.view, X = port.x, Y = port.y;
    const free = (x: number, y: number, w: number, h: number) => !placed.some((p) => X + x < p.x + p.w && X + x + w > p.x && Y + y < p.y + p.h && Y + y + h > p.y);
    const take = (x: number, y: number, w: number, h: number) => placed.push({ x: X + x, y: Y + y, w, h });
    ctx.save();
    ctx.translate(X, Y);
    ctx.beginPath();
    if (port.inset) ctx.arc(v.w / 2, v.h / 2, Math.min(v.w, v.h) / 2, 0, 2 * Math.PI);
    else if (v.proj !== 'eq') {
      // A polar chart: as far as it reaches from its pole, and no further.
      ctx.rect(0, 0, v.w, v.h); ctx.clip();
      ctx.beginPath(); ctx.arc(v.w / 2 + v.px, v.h / 2 + v.py, 2 * Math.tan(port.limit / 2) * v.scale, 0, 2 * Math.PI);
    } else {
      // The main view, less the insets' discs over it.
      ctx.rect(0, 0, v.w, v.h);
      for (const p of insets) { const r = p.view.w / 2; ctx.moveTo(p.x - X + 2 * r + 2, p.y - Y + r); ctx.arc(p.x - X + r, p.y - Y + r, r + 2, 0, 2 * Math.PI, true); }
    }
    ctx.clip('evenodd');
    const inView = (x: number, y: number, m = 0) => x > -m && y > -m && x < v.w + m && y < v.h + m;
    // A box wholly on the chart: inside the view, and on a polar chart or
    // an inset inside its disc too.
    const rim = v.proj === 'eq' ? Infinity : 2 * Math.tan(port.limit / 2) * v.scale;
    const cx0 = v.w / 2 + v.px, cy0 = v.h / 2 + v.py;
    const whole = (x: number, y: number, w: number, h: number) => x > 2 && y > 2 && x + w < v.w - 2 && y + h < v.h - 2
      && (rim === Infinity || [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].every(([a, b]) => Math.hypot(a - cx0, b - cy0) < rim - 2));
    const degPx = 1 / (v.scale * D);    // degrees across one CSS px here

    // ---- linework: graticule, atlas grid, sheet edges
    if (o.grid) {
      const step = niceStep(degPx * (port.inset ? 60 : 90));
      ctx.strokeStyle = 'rgba(29, 27, 22, 0.32)'; ctx.lineWidth = 1;
      for (let lat = -90 + step; lat < 90 - 1e-9; lat += step) {
        const pts: [number, number][] = [];
        for (let lon = -180; lon <= 180; lon += 5) pts.push([lat * D, lon * D]);
        polyline(ctx, v, pts);
      }
      for (let lon = -180; lon < 180 - 1e-9; lon += step) {
        const pts: [number, number][] = [[-89.999 * D, lon * D], [0, lon * D], [89.999 * D, lon * D]];
        if (v.proj === 'n') pts.splice(0, 1);
        if (v.proj === 's') pts.splice(2, 1);
        polyline(ctx, v, pts);
      }
    }
    if (o.atlas && v.proj === 'eq' && !port.inset) {
      ctx.strokeStyle = 'rgba(112, 34, 13, 0.45)'; ctx.lineWidth = 1;
      for (let lat = -75; lat <= 75; lat += 15) polyline(ctx, v, [[lat * D, -180 * D], [lat * D, 0], [lat * D, 179.999 * D]]);
      for (let lon = -180; lon < 180; lon += 15) polyline(ctx, v, [[-90 * D, lon * D], [90 * D, lon * D]]);
    }
    const sheetsOn = o.sheetsOn && o.sheets.length > 0;
    if (sheetsOn) {
      ctx.strokeStyle = 'rgba(112, 34, 13, 0.7)'; ctx.lineWidth = 1.25;
      const edges = new Set<number>();
      for (const s of o.sheets) { edges.add(s.south); edges.add(s.north); }
      for (const lat of edges) if (Math.abs(lat) < 90) polyline(ctx, v, [[lat * D, -180 * D], [lat * D, 0], [lat * D, 179.999 * D]]);
      for (const s of o.sheets) if (!s.polar) polyline(ctx, v, [[s.south * D, s.west * D], [s.north * D, s.west * D]]);
    }

    // ---- the ground tracks' lines: the satellite's last quarter orbit
    // solid, what is ahead dashed, the pass over the chosen place bright
    for (const t of o.tracks) {
      const line = (pts: [number, number][], dash: number[], w: number, colour: string) => {
        ctx.setLineDash(dash);
        ctx.lineWidth = w + 2.5; ctx.strokeStyle = TRACK_EDGE; polyline(ctx, v, pts, 1 * D);
        ctx.lineWidth = w; ctx.strokeStyle = colour; polyline(ctx, v, pts, 1 * D);
        ctx.setLineDash([]);
      };
      const colour = t.kind === 'craft' ? AMBER : PALE;
      ctx.lineCap = 'round';
      if (t.nowIndex > 0) line(t.line.slice(0, t.nowIndex + 1), [], 1.75, colour);
      line(t.line.slice(t.nowIndex), [7, 5], 1.75, colour);
      if (t.pass) line(t.pass, [], 3.5, AMBER);
      ctx.lineCap = 'butt';
    }

    // ---- marks: landing sites, launch pads, the track's place and satellite
    const mark = (kind: string, x: number, y: number, hot: boolean) => {
      const r = hot ? 6 : 4.5;
      ctx.lineWidth = 3; ctx.strokeStyle = HALO; ctx.fillStyle = INK;
      ctx.beginPath();
      if (kind === 'crewed') ctx.rect(x - r, y - r, 2 * r, 2 * r);
      else if (kind === 'pad') { ctx.moveTo(x, y - r - 1.5); ctx.lineTo(x + r + 1, y + r); ctx.lineTo(x - r - 1, y + r); ctx.closePath(); }
      else if (kind === 'crash' || kind === 'impact' || kind === 'estimate') { ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); }
      else { ctx.moveTo(x, y - r - 1); ctx.lineTo(x + r + 1, y + r); ctx.lineTo(x - r - 1, y + r); ctx.closePath(); }
      ctx.stroke();
      if (kind === 'crash' || kind === 'impact' || kind === 'estimate') { ctx.lineWidth = 1.6; ctx.strokeStyle = INK; ctx.stroke(); }
      else if (kind === 'crewed' || kind === 'pad') ctx.fill();
      else { ctx.lineWidth = 1.6; ctx.strokeStyle = INK; ctx.stroke(); }
    };
    const labels: { text: string; x: number; y: number; key: string; kind: Hit['kind'] }[] = [];
    if (o.sites) for (const s of o.siteMarks) for (const [x, y] of places(v, s.lat, s.lon)) {
      if (!inView(x, y, 8)) continue;
      const key = `site:${s.key}`;
      mark(s.kind, x, y, o.hover === key);
      take(x - 6, y - 6, 12, 12);
      hits.push({ kind: 'site', key, label: s.name, x: X + x - 8, y: Y + y - 8, w: 16, h: 16 });
      if (!port.inset) labels.push({ text: s.name, x, y, key, kind: 'site' });
    }
    if (o.pads) for (const p of o.padMarks) for (const [x, y] of places(v, p.lat, p.lon)) {
      if (!inView(x, y, 8)) continue;
      const key = `pad:${p.key}`;
      mark('pad', x, y, o.hover === key);
      take(x - 6, y - 6, 12, 12);
      hits.push({ kind: 'pad', key, label: `${p.name} ${p.pad}`, x: X + x - 8, y: Y + y - 8, w: 16, h: 16 });
      if (!port.inset) labels.push({ text: `${p.name} ${p.pad}`, x, y, key, kind: 'pad' });
    }
    for (const t of o.tracks) {
      if (t.place) for (const [x, y] of places(v, t.place[0], t.place[1])) {
        ctx.fillStyle = AMBER; ctx.strokeStyle = TRACK_EDGE; ctx.lineWidth = 1.5;
        ctx.fillRect(x - 4, y - 4, 8, 8); ctx.strokeRect(x - 4, y - 4, 8, 8);
      }
      // Where a craft's orbit meets the ground: the chart's cross for an impact, lit.
      if (t.impact) for (const [x, y] of places(v, t.impact[0], t.impact[1])) {
        ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5); ctx.moveTo(x + 5, y - 5); ctx.lineTo(x - 5, y + 5);
        ctx.lineWidth = 4.5; ctx.strokeStyle = TRACK_EDGE; ctx.stroke(); ctx.lineWidth = 2; ctx.strokeStyle = AMBER; ctx.stroke();
        take(x - 6, y - 6, 12, 12);
      }
      const now = t.line[t.nowIndex];
      if (now) for (const [x, y] of places(v, now[0], now[1])) {
        ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + 7, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 7, y); ctx.closePath();
        ctx.fillStyle = t.kind === 'craft' ? AMBER : PALE; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = TRACK_EDGE; ctx.stroke();
        take(x - 8, y - 8, 16, 16);
        if (!port.inset) {
          // Its name to the right, else the left, where nothing is and whole on the chart.
          ctx.font = `12px ${FONT.display}`; ctx.textBaseline = 'middle'; ctx.fillStyle = INK;
          const text = spaced(ctx, t.name.toUpperCase(), 0.1), w = ctx.measureText(text).width + 4;
          const fits = (lx: number) => whole(lx, y - 8, w, 16) && free(lx, y - 8, w, 16);
          const right = fits(x + 10);
          if (right || fits(x - 10 - w)) {
            ctx.textAlign = right ? 'left' : 'right';
            halo(ctx, text, right ? x + 11 : x - 11, y); take(right ? x + 10 : x - 10 - w, y - 8, w, 16);
          }
          spaced(ctx, '', 0);
        }
      }
    }

    // ---- lettering, most wanted first: the sites' and pads' names, then
    // the IAU names by size, then the sheets' codes where room is left
    ctx.font = `12px ${FONT.sans}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const l of labels) {
      // To the right of its mark, else the left, whole on the chart.
      const w = ctx.measureText(l.text).width + 4, h = 15, hot = o.hover === l.key;
      const fits = (x: number) => whole(x, l.y - h / 2, w, h) && (hot || free(x, l.y - h / 2, w, h));
      const x = fits(l.x + 8) ? l.x + 8 : fits(l.x - 8 - w) ? l.x - 8 - w : null;
      if (x === null) continue;
      ctx.fillStyle = hot ? ENGRAVE : INK;
      ctx.textAlign = 'left';
      halo(ctx, l.text, x + 1, l.y);
      take(x, l.y - h / 2, w, h);
    }
    if (o.names && o.features.length) {
      ctx.textAlign = 'center';
      let n = 0;
      const most = port.inset ? 12 : 280;
      for (const f of o.features) {
        if (n >= most) break;
        const km = v.proj === 'eq' ? o.radiusKm / v.scale : kmPerPx(v, o.radiusKm, f.lat);
        // An albedo feature has no diameter: lettered once the chart is close
        // enough for 300 km to span 30 px.
        const size = (f.diamKm || 300) / km;
        const region = o.regional.has(f.type);
        if (size < (f.type === 'SF' ? 48 : port.inset ? 70 : region ? 40 : 30)) continue;
        const px = region ? (size > 500 ? 17 : size > 220 ? 14 : 12) : size > 260 ? 15 : size > 110 ? 13 : size > 60 ? 12 : 11;
        ctx.font = region ? `${px}px ${FONT.display}` : `${px}px ${FONT.sans}`;
        const text = region ? spaced(ctx, f.name.toUpperCase(), 0.14) : (spaced(ctx, '', 0), f.name);
        const w = ctx.measureText(text).width + 6, h = px + 4;
        for (const [x, y0] of places(v, f.lat, f.lon)) {
          // Whole on the chart; a crater's name may drop below its centre
          // when a site's or a larger name is there.
          const y = [y0, ...(region ? [] : [y0 + h])].find((yy) => whole(x - w / 2, yy - h / 2, w, h) && free(x - w / 2, yy - h / 2, w, h));
          if (y === undefined) continue;
          ctx.fillStyle = o.hover === `name:${f.id}` ? ENGRAVE : INK;
          halo(ctx, text, x, y);
          take(x - w / 2, y - h / 2, w, h);
          hits.push({ kind: 'name', key: `name:${f.id}`, label: f.name, x: X + x - w / 2, y: Y + y - h / 2, w, h });
          n++;
        }
      }
      spaced(ctx, '', 0);
    }
    if (sheetsOn && !port.inset) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const s of o.sheets) {
        const midLat = s.polar ? (s.north > 0 ? 90 : -90) : (s.south + s.north) / 2, midLon = s.polar ? 0 : (s.west + s.east) / 2;
        const a = forward(v, s.south * D, s.west * D), b = forward(v, s.south * D, s.east * D);
        const widthPx = s.polar ? 400 : Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (widthPx < 46) continue;
        const nm = o.sheetNames[String(s.n)], named = !!nm && widthPx > 170;
        ctx.font = `600 12px ${FONT.mono}`;
        const wc = ctx.measureText(s.code).width;
        ctx.font = `10px ${FONT.display}`;
        const wn = named ? ctx.measureText(spaced(ctx, nm.toUpperCase(), 0.12)).width : 0;
        spaced(ctx, '', 0);
        const w = Math.max(wc, wn) + 8, h = named ? 30 : 16;
        for (const [x, y0] of places(v, midLat * D, midLon * D)) {
          const y = s.polar && v.proj === 'eq' ? y0 + (s.north > 0 ? 22 : -22) : y0;
          if (!whole(x - w / 2, y - h / 2, w, h)) continue;
          hits.push({ kind: 'sheet', key: s.code, label: nm ? `${s.code} ${nm}` : s.code, x: X + x - w / 2, y: Y + y - h / 2, w, h });
          if (!free(x - w / 2, y - h / 2, w, h)) continue;
          ctx.fillStyle = ENGRAVE;
          ctx.font = `600 12px ${FONT.mono}`;
          halo(ctx, s.code, x, y - (named ? 7 : 0));
          if (named) { ctx.font = `10px ${FONT.display}`; halo(ctx, spaced(ctx, nm.toUpperCase(), 0.12), x, y + 8); spaced(ctx, '', 0); }
          take(x - w / 2, y - h / 2, w, h);
        }
      }
    }
    ctx.restore();

    // ---- an inset's rim and its pole's name
    if (port.inset) {
      const cx = X + v.w / 2, cy = Y + v.h / 2, r = Math.min(v.w, v.h) / 2;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.lineWidth = 3; ctx.strokeStyle = '#121110'; ctx.stroke();
      ctx.lineWidth = 1; ctx.strokeStyle = PAPER; ctx.stroke();
      ctx.font = `11px ${FONT.display}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = INK;
      halo(ctx, spaced(ctx, port.inset === 'n' ? 'NORTH POLE' : 'SOUTH POLE', 0.12), cx, Y - 9); spaced(ctx, '', 0);
      hits.push({ kind: 'sheet', key: `inset:${port.inset}`, label: port.inset === 'n' ? 'North polar view' : 'South polar view', x: X, y: Y, w: v.w, h: v.h });
    }
  }
  return hits;
}

// The border of the main view: graticule figures (or, on the atlas, its
// letters and numbers) in the margin, the scale bar and the north arrow.
export function drawFurniture(ctx: CanvasRenderingContext2D, o: OverlayInput, main: View, margin: number): void {
  const f = o.frame;
  ctx.save();
  // The neat line round the map.
  ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
  ctx.strokeRect(f.x - 0.75, f.y - 0.75, f.w + 1.5, f.h + 1.5);
  ctx.font = `11px ${FONT.sans}`; ctx.fillStyle = INK; ctx.textBaseline = 'middle';
  if (main.proj === 'eq') {
    if (o.atlas) {
      // Columns A to X, 15° each from 180° W; rows 1 to 12 from the north.
      ctx.font = `600 12px ${FONT.mono}`;
      for (let c = 0; c < 24; c++) {
        const lon = (-180 + 15 * c + 7.5) * D;
        for (const [x] of places(main, 0, lon)) {
          if (x < 4 || x > main.w - 4) continue;
          ctx.textAlign = 'center';
          ctx.fillText(String.fromCharCode(65 + c), f.x + x, f.y - margin / 2);
          ctx.fillText(String.fromCharCode(65 + c), f.x + x, f.y + f.h + margin / 2);
        }
      }
      for (let r = 0; r < 12; r++) {
        const [, y] = forward(main, (90 - 15 * r - 7.5) * D, main.lon0);
        if (y < 4 || y > main.h - 4) continue;
        ctx.textAlign = 'center';
        ctx.fillText(String(r + 1), f.x - margin / 2, f.y + y);
        ctx.fillText(String(r + 1), f.x + f.w + margin / 2, f.y + y);
      }
    } else if (o.grid) {
      const step = niceStep((1 / (main.scale * D)) * 90);
      ctx.textAlign = 'center';
      for (let lon = -180; lon < 180; lon += step) for (const [x] of places(main, 0, lon * D)) {
        if (x < 18 || x > main.w - 18) continue;
        ctx.fillText(lonText(lon * D, o.lonStyle), f.x + x, f.y - margin / 2);
        ctx.fillText(lonText(lon * D, o.lonStyle), f.x + x, f.y + f.h + margin / 2);
      }
      ctx.save();
      for (let lat = -90 + step; lat < 90; lat += step) {
        const [, y] = forward(main, lat * D, main.lon0);
        if (y < 10 || y > main.h - 10) continue;
        for (const [sx, rot] of [[f.x - margin / 2, -Math.PI / 2], [f.x + f.w + margin / 2, Math.PI / 2]] as [number, number][]) {
          ctx.save(); ctx.translate(sx, f.y + y); ctx.rotate(rot); ctx.fillText(latText(lat * D), 0, 0); ctx.restore();
        }
      }
      ctx.restore();
    }
  }

  // The scale bar, true at the view's centre (along the parallel there).
  const mid = inverse(main, main.w / 2, main.h / 2);
  if (mid) {
    const kmpp = main.proj === 'eq' ? (o.radiusKm * Math.cos(mid[0])) / main.scale : kmPerPx(main, o.radiusKm, mid[0]);
    const target = 120 * kmpp;
    const nice = [1, 2, 5].flatMap((m) => [1, 10, 100, 1000, 10000].map((p) => m * p)).sort((a, b) => a - b);
    const km = nice.reduce((best, n) => (n <= target ? n : best), nice[0]);
    const px = km / kmpp;
    if (px > 20 && Number.isFinite(px)) {
      const x0 = f.x + 14, y0 = f.y + f.h - 18;
      ctx.fillStyle = HALO; ctx.fillRect(x0 - 6, y0 - 16, px + 12 + 90, 28);
      for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? PAPER : INK; ctx.fillRect(x0 + (px * i) / 4, y0, px / 4, 5); }
      ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, px, 5);
      ctx.fillStyle = INK; ctx.font = `11px ${FONT.sans}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(`${km.toLocaleString('en-AU')} km`, x0, y0 - 4);
      ctx.fillStyle = 'rgba(29, 27, 22, 0.75)';
      ctx.fillText(`at ${latText(mid[0])}`, x0 + px + 8, y0 + 5);
    }
  }

  // The north arrow, at the map's top right, in simple cylindrical (a
  // polar chart's north is its pole, wherever on it one looks).
  if (main.proj !== 'eq') { ctx.restore(); return; }
  const ang = 0;
  const cx = f.x + f.w - 26, cy = f.y + 30;
  ctx.translate(cx, cy); ctx.rotate(ang);
  ctx.fillStyle = HALO; ctx.beginPath(); ctx.arc(0, 0, 17, 0, 2 * Math.PI); ctx.fill();
  ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(6, 6); ctx.lineTo(0, 2); ctx.lineTo(-6, 6); ctx.closePath();
  ctx.fillStyle = INK; ctx.fill();
  ctx.rotate(-ang);
  ctx.font = `10px ${FONT.display}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = INK;
  ctx.fillText('N', 0, 26);
  ctx.restore();
}
