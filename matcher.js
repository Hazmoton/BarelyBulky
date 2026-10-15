// Pure matching logic (no DOM) so it can be tested on its own.

export const norm = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const rowA = new Uint16Array(256), rowB = new Uint16Array(256);

// edit distance between a and b, giving up (returning max+1) once it must exceed max
export function lev(a, b, max){
  if (a.length > 200 || b.length > 200 || Math.abs(a.length - b.length) > max) return max + 1;
  let prev = rowA, cur = rowB;
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++){
    cur[0] = i; let rowMin = i; const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++){
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca === b.charCodeAt(j - 1) ? 0 : 1));
      cur[j] = v; if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const t = prev; prev = cur; cur = t;
  }
  return prev[b.length];
}

// fewest edits to turn `name` into ANY stretch of q, so stray characters around a clean name cost nothing
export function semi(q, name, max){
  if (q.length > 200 || name.length > 200) return max + 1;
  let prev = rowA, cur = rowB;
  for (let j = 0; j <= q.length; j++) prev[j] = 0;
  for (let i = 1; i <= name.length; i++){
    cur[0] = i; let rowMin = i; const ca = name.charCodeAt(i - 1);
    for (let j = 1; j <= q.length; j++){
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca === q.charCodeAt(j - 1) ? 0 : 1));
      cur[j] = v; if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const t = prev; prev = cur; cur = t;
  }
  let best = max + 1;
  for (let j = 0; j <= q.length; j++) if (prev[j] < best) best = prev[j];
  return best;
}

// the OCR often picks up a card-edge mark as a stray 1-2 letter "word" at either end: try with and without it
export function variants(q){
  const t = q.split(' '), v = new Set([q]);
  if (t.length > 1 && t[0].length <= 1) v.add(t.slice(1).join(' '));
  if (t.length > 1 && t[t.length - 1].length <= 2) v.add(t.slice(0, -1).join(' '));
  if (t.length > 2 && t[0].length <= 1 && t[t.length - 1].length <= 2) v.add(t.slice(1, -1).join(' '));
  return [...v].filter(x => x.length >= 3);
}

// index: [{name, norm}]. Returns up to `limit` candidates {name, score 0..1}, best first
export function match(raw, index, limit = 5){
  const full = norm(raw), qs = variants(full);
  if (!qs.length) return [];
  const best = new Map();
  for (const e of index){
    let s = 0;
    for (const q of qs){
      const len = Math.max(q.length, e.norm.length), max = Math.ceil(len * 0.4);
      const d = lev(q, e.norm, max);
      if (d <= max) s = Math.max(s, 1 - d / len);
    }
    if (e.norm.length >= 4 && full.length > e.norm.length){ // junk around an otherwise clean name
      const max = Math.floor(e.norm.length * 0.25), d = semi(full, e.norm, max);
      if (d <= max) s = Math.max(s, 1 - d / e.norm.length - 0.5 * (full.length - e.norm.length) / full.length);
    }
    if (s >= 0.4){ const p = best.get(e.name); if (!p || s > p.score) best.set(e.name, { name: e.name, score: s }); }
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

/* ---- second opinion: does the rules text on the card agree with the candidate? ---- */
const words = t => norm(t).split(' ').filter(w => w.length >= 4);
// 0..1 share of the OCR'd words found (allowing typos) in the candidate's text; null if too little text was read
export function textOverlap(ocrText, cardText){
  const ws = [...new Set(words(ocrText))];
  if (ws.length < 3) return null;
  const cw = [...new Set(words(cardText))];
  let hit = 0;
  for (const w of ws){
    const tol = w.length >= 8 ? 2 : 1;
    if (cw.some(c => Math.abs(c.length - w.length) <= tol && lev(w, c, tol) <= tol)) hit++;
  }
  return Math.min(1, hit / Math.min(ws.length, 10));
}
// nudge the title score up or down by how well the card's text agreed (mild: the text OCR is the noisier of the two)
export function fuse(title, overlap){
  if (overlap == null) return title;
  return Math.max(0, Math.min(1, title + 0.2 * (overlap - 0.4)));
}

/* ---- auto-add: decide from a short window of scans instead of one noisy frame ---- */
export class Voter {
  constructor(windowMs = 5000){ this.windowMs = windowMs; this.obs = []; }
  clear(){ this.obs = []; }
  push(cands, now = Date.now()){ this.obs.push({ t: now, cands }); this.obs = this.obs.filter(o => now - o.t <= this.windowMs); }
  tally(){
    const m = new Map();
    for (const o of this.obs) for (const c of o.cands){
      if (c.score < 0.5) continue;
      const e = m.get(c.name) || { name: c.name, n: 0, sum: 0, max: 0 };
      e.n++; e.sum += c.score; e.max = Math.max(e.max, c.score); m.set(c.name, e);
    }
    return [...m.values()];
  }
  // what to show: best score each name reached in the window, so one good read isn't wiped by a bad one
  display(limit = 5){ return this.tally().sort((a, b) => b.max - a.max || b.sum - a.sum).slice(0, limit).map(e => ({ name: e.name, score: e.max, n: e.n })); }
  // a name to add now, or null
  decide(latest){
    const [top, second] = latest;
    if (top && top.score >= 0.92 && (!second || top.score - second.score >= 0.12)) return top.name;
    const t = this.tally().filter(e => e.n >= 2 && e.sum / e.n >= 0.75).sort((a, b) => b.sum - a.sum);
    if (t.length && (!t[1] || t[0].sum - t[1].sum >= 0.3)) return t[0].name;
    return null;
  }
}
