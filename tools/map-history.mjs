/* Map history recorder.
 *
 * Once a day (.github/workflows/map-history.yml) this reads EarthMC's own map
 * file, the markers.json their map and ours load every town from, and keeps a
 * compact copy of who held what: every town's claimed chunks, nation, capital
 * flag, mayor and resident count, with each nation's colours.
 *
 * The day is stored in Cloudflare, by the site's Worker (REGIONS_KV), not in
 * this repo. The Worker can't read a file this size itself (the free plan
 * allows it 10 ms of CPU), so the reading happens here and only the finished,
 * gzipped day is sent. EarthMC's original file goes too, kept 120 days, so a
 * day can be read again if this reading ever needs fixing.
 *
 *   node tools/map-history.mjs                 record today
 *   node tools/map-history.mjs --wayback       fill in past days from the
 *                                              Wayback Machine, where it has
 *                                              saved copies (Terra Nostra only)
 *   node tools/map-history.mjs --file f.json --date 2026-06-29
 *                                              record a copy you have
 *   add --out somefolder to write files locally instead of uploading
 *
 * Environment: HISTORY_URL (the Worker), HISTORY_KEY (the shared secret).
 * Needs Node 18+ and nothing else.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const SOURCE = 'https://map.earthmc.net/tiles/minecraft_overworld/markers.json';
const WORKER = (process.env.HISTORY_URL || 'https://earthmc-ethiopia-proxy.ethiopianempire2.workers.dev').replace(/\/+$/, '');
const KEY = process.env.HISTORY_KEY || '';
/* Terra Nostra opened to Premium players on 17 April 2026 (public on 1 May).
   Anything saved before that is the old Aurora world: a different map. */
const NOSTRA_FROM = '2026-04-17';
const UA = 'earthmc-ethiopia-map history recorder (GitHub Actions; github.com/slipperysalmon14/earthmc-ethiopia-map)';

const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const has = (k) => args.includes(k);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ---- reading the map file (the same reading as map.html's) ---- */
const decode = (s) => String(s || '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
const lines = (html) => decode(String(html || '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li|details|summary|span|h\d)>/gi, '\n')
  .replace(/<[^>]*>/g, ' '))
  .split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
const text = (html) => decode(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const hex = (c) => (typeof c === 'string' && /^#?[0-9a-f]{6}$/i.test(c.trim())) ? '#' + c.trim().replace('#', '').toLowerCase() : null;

function ringsOf(points){
  const out = [];
  const walk = (a) => {
    if (!Array.isArray(a) || !a.length) return;
    const p = a[0];
    if (p && typeof p === 'object' && !Array.isArray(p) && typeof p.x === 'number'){
      const r = a.filter(q => q && Number.isFinite(q.x) && Number.isFinite(q.z)).map(q => [Math.round(q.x), Math.round(q.z)]);
      if (r.length >= 3) out.push(r);
      return;
    }
    a.forEach(walk);
  };
  walk(points);
  return out;
}

/* Claimed chunks as row runs, [cz, cx, length, ...], filled even-odd so a
   hole in a town stays a hole. */
function runsOf(rings){
  let minZ = Infinity, maxZ = -Infinity;
  rings.forEach(r => r.forEach(p => { if (p[1] < minZ) minZ = p[1]; if (p[1] > maxZ) maxZ = p[1]; }));
  if (!Number.isFinite(minZ) || maxZ - minZ > 16 * 4000) return [];
  const out = [];
  for (let cz = Math.floor(minZ / 16); cz * 16 < maxZ; cz++){
    const zc = cz * 16 + 8, xs = [];
    rings.forEach(r => {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++){
        const zi = r[i][1], zj = r[j][1];
        if ((zi > zc) !== (zj > zc)) xs.push(r[i][0] + (zc - zi) * (r[j][0] - r[i][0]) / (zj - zi));
      }
    });
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2){
      const a = Math.round(xs[k] / 16), b = Math.round(xs[k + 1] / 16);
      if (b > a) out.push(cz, a, b - a);
    }
  }
  return out;
}

function townOf(m){
  const popup = m.popup || '', tooltip = m.tooltip || '';
  let head = (popup.match(/<span[^>]*>([\s\S]*?)<\/span>/i) || [])[1];
  if (!head || !text(head)) head = (popup.match(/<b[^>]*>([\s\S]*?)<\/b>/i) || [])[1] || tooltip;
  const h = text(head);
  const bm = h.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  const name = (bm ? bm[1] : h).trim().split(/\s+/).join('_');
  if (!name || name.length > 60) return null;
  let nation = bm ? bm[2].trim() : null, capital = false;
  if (nation && /^capital of\s+/i.test(nation)){ capital = true; nation = nation.replace(/^capital of\s+/i, ''); }
  if (nation && /^member of\s+/i.test(nation)) nation = nation.replace(/^member of\s+/i, '');
  if (/\(\s*capital of\b/i.test(text(tooltip))) capital = true;
  if (nation) nation = nation.split(/\s+/).join('_');
  if (nation && /^(no nation|none|-)$/i.test(nation)) nation = null;
  const ls = lines(popup);
  const field = (label) => {
    const i = ls.findIndex(l => l.toLowerCase().startsWith(label.toLowerCase() + ':'));
    return i < 0 ? null : { i, v: ls[i].slice(label.length + 1).trim() };
  };
  const mayor = field('Mayor');
  const res = field('Residents');
  let residents = 0;
  if (res){
    const m2 = res.v.match(/^(\d+)\b/);
    residents = m2 ? parseInt(m2[1], 10) : res.v.split(/,\s*/).filter(Boolean).length;
  }
  const rings = ringsOf(m.points);
  if (!rings.length) return null;
  return {
    name, nation, capital, residents,
    mayor: mayor && mayor.v && !/^none$/i.test(mayor.v) ? mayor.v.split(/\s+/)[0] : null,
    runs: runsOf(rings),
    fill: hex(m.fillColor || m.color), outline: hex(m.color || m.fillColor),
  };
}

function snapshot(data, date, taken, source){
  const layers = Array.isArray(data) ? data : (data && Array.isArray(data.layers) ? data.layers : []);
  const towny = layers.find(l => l && /towny/i.test(String(l.id || l.name || ''))) ||
    layers.find(l => l && Array.isArray(l.markers) && l.markers.some(mk => mk && /polygon/i.test(mk.type || '')));
  if (!towny) throw new Error('no towny layer in the map file');
  const byName = new Map();
  (towny.markers || []).forEach(mk => {
    if (!mk || !/polygon|rectangle/i.test(mk.type || '')) return;
    const t = townOf(mk);
    if (!t) return;
    const had = byName.get(t.name);
    if (had){ had.runs = had.runs.concat(t.runs); had.capital = had.capital || t.capital; return; }
    byName.set(t.name, t);
  });
  const towns = [...byName.values()];
  const nations = [], nIndex = new Map();
  towns.forEach(t => {
    if (!t.nation || nIndex.has(t.nation)) return;
    nIndex.set(t.nation, nations.length);
    nations.push([t.nation, t.fill, t.outline]);
  });
  let chunks = 0;
  const rows = towns.map(t => {
    let n = 0; for (let i = 2; i < t.runs.length; i += 3) n += t.runs[i];
    chunks += n;
    return [t.name, t.nation ? nIndex.get(t.nation) : -1, t.capital ? 1 : 0, t.residents, t.mayor, t.runs];
  });
  return {
    file: { v: 1, date, taken, source, fields: ['name', 'nation', 'capital', 'residents', 'mayor', 'runs (cz, cx, length)'],
      nations, towns: rows },
    summary: { date, source, takenAt: taken, towns: towns.length, nations: nations.length, chunks,
      residents: towns.reduce((s, t) => s + t.residents, 0),
      top: nations.map(([n], i) => [n, rows.filter(r => r[1] === i).length]).sort((a, b) => b[1] - a[1]).slice(0, 12) },
  };
}

/* Sends a day (and EarthMC's original file) to the Worker, or writes them
   locally with --out. */
async function store(date, text, data, source, taken){
  const { file: snap, summary } = snapshot(data, date, taken, source);
  /* A sanity floor, to catch a file that has changed shape (that reads as
     next to no towns). Lower for old copies: Terra Nostra's first days really
     did have only a few hundred towns. */
  const floor = source === 'wayback' ? 20 : 300;
  if (snap.towns.length < floor){
    // Better no day than a wrong one: the file has probably changed shape.
    throw new Error(`${date}: only ${snap.towns.length} towns read — the map file may have changed format; not saved`);
  }
  const day = gzipSync(Buffer.from(JSON.stringify(snap)), { level: 9 });
  const raw = gzipSync(Buffer.from(text), { level: 9 });
  const line = `${date} (${source}): ${summary.towns} towns, ${summary.nations} nations, ${summary.chunks} chunks · ${(day.length / 1024).toFixed(0)} KB`;
  const out = arg('--out');
  if (out){
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, `${date}.json.gz`), day);
    await writeFile(path.join(out, `${date}.raw.json.gz`), raw);
    await writeFile(path.join(out, `${date}.summary.json`), JSON.stringify(summary) + '\n');
    console.log(line + ' · written to ' + out);
    return;
  }
  if (!KEY) throw new Error('HISTORY_KEY is not set (add it as a repository secret)');
  const put = async (url, body, extra) => {
    for (let attempt = 1; ; attempt++){
      const res = await fetch(url, { method: 'PUT', body, headers: { 'X-History-Key': KEY, 'Content-Type': 'application/gzip', ...(extra || {}) } });
      if (res.ok) return res.json();
      const msg = await res.text();
      if (res.status >= 500 && attempt < 3){ await sleep(5000 * attempt); continue; }
      const err = new Error(`Worker said HTTP ${res.status}: ${msg.slice(0, 200)}`);
      err.worker = res.status;
      throw err;
    }
  };
  await put(`${WORKER}/api/internal/history/${date}`, day, { 'X-History-Summary': encodeURIComponent(JSON.stringify(summary)) });
  /* EarthMC's original file is kept for days read live, so they can be read
     again if this reading ever needs fixing. Not for Wayback days: the
     Wayback Machine already keeps those, and skipping the copy saves one of
     Cloudflare's 1,000 free storage writes a day per day recorded. */
  if (source !== 'wayback') await put(`${WORKER}/api/internal/history/${date}/raw`, raw);
  console.log(line + ' · saved');
}

async function recordToday(){
  const now = new Date();
  const res = await fetch(SOURCE, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('map file: HTTP ' + res.status);
  const text = await res.text();
  await store(now.toISOString().slice(0, 10), text, JSON.parse(text), 'live', now.toISOString());
}

async function recordFile(){
  const date = arg('--date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('--date must look like 2026-06-29');
  const text = await readFile(arg('--file'), 'utf8');
  await store(date, text, JSON.parse(text), 'file', null);
}

/* The Wayback Machine keeps an index of every copy it has saved of a URL (its
   CDX API), and serves each copy byte for byte with "id_" in the address.
   Copies of a data file like this exist only where someone or something
   saved it, so there may be many days, a few, or none. One per day is taken,
   slowly, and days already recorded are skipped, so it can be run again. */
async function recordWayback(){
  const done = new Set();
  try {
    const idx = await (await fetch(`${WORKER}/history/index.json`)).json();
    (idx.days || []).forEach(d => done.add(d.date));
  } catch (_e){ /* nothing recorded yet */ }

  const cdx = 'https://web.archive.org/cdx/search/cdx?' + new URLSearchParams({
    url: 'map.earthmc.net/tiles/minecraft_overworld/markers.json', matchType: 'prefix',
    output: 'json', fl: 'timestamp,original,statuscode,length', filter: 'statuscode:200',
    from: NOSTRA_FROM.replace(/-/g, ''),
  });
  let rows = null;
  for (let attempt = 1; attempt <= 4 && !rows; attempt++){
    const res = await fetch(cdx, { headers: { 'User-Agent': UA } });
    if (res.ok){ rows = await res.json(); break; }
    console.log(`Wayback index: HTTP ${res.status}, waiting…`);
    await sleep(30000 * attempt);
  }
  if (!rows) throw new Error('the Wayback Machine did not answer');
  const captures = rows.slice(1).map(([ts, original]) => ({ ts, original, date: `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}` }))
    .filter(c => c.date >= NOSTRA_FROM);
  // Every copy of each day, newest first: the latest is the fullest picture
  // of that day, and the earlier ones stand in if it won't download or read.
  const byDay = new Map();
  captures.forEach(c => { let l = byDay.get(c.date); if (!l) byDay.set(c.date, l = []); l.push(c); });
  byDay.forEach(l => l.sort((x, y) => y.ts.localeCompare(x.ts)));
  const todo = [...byDay.keys()].filter(d => !done.has(d)).sort();
  console.log(`Wayback has ${captures.length} saved cop${captures.length === 1 ? 'y' : 'ies'} of the map file since ${NOSTRA_FROM}, ` +
    `on ${byDay.size} day(s); ${todo.length} not recorded yet.`);

  const download = async (c) => {
    const url = `https://web.archive.org/web/${c.ts}id_/${c.original}`;
    for (let attempt = 1; attempt <= 3; attempt++){
      try {
        const res = await fetch(url, { headers: { 'User-Agent': UA } });
        if (res.ok) return await res.text();
        if (res.status === 429 || res.status >= 500){ console.log(`${c.date}: HTTP ${res.status}, waiting…`); await sleep(60000 * attempt); }
        else return null;
      } catch (e){ await sleep(20000 * attempt); }
    }
    return null;
  };

  let saved = 0, failed = 0, refusedInARow = 0;
  for (const date of todo){
    let ok = false, why = 'could not download';
    for (const c of byDay.get(date)){
      const text = await download(c);
      if (text === null){ await sleep(+process.env.GAP_MS || 4000); continue; }
      try {
        await store(date, text, JSON.parse(text), 'wayback', `${date}T${c.ts.slice(8, 10)}:${c.ts.slice(10, 12)}:${c.ts.slice(12, 14)}Z`);
        ok = true; refusedInARow = 0;
        break;
      } catch (e){
        why = e.message;
        if (e.worker){ refusedInARow++; break; }       // Cloudflare's answer, not the copy's fault
      }
      await sleep(+process.env.GAP_MS || 4000);
    }
    if (ok) saved++;
    else { failed++; console.log(`${date}: skipped (${why})`); }
    if (refusedInARow >= 3){
      console.log('Cloudflare refused three days in a row, most likely the free plan\'s 1,000 storage writes for today. ' +
        'Stopping here; run "wayback" again after 7 pm Eastern (midnight UTC) and it carries on from the first missing day.');
      break;
    }
    await sleep(+process.env.GAP_MS || 8000);      // be gentle: one day every few seconds
  }
  console.log(`Done: ${saved} day(s) added from the Wayback Machine, ${failed} skipped.`);
}

async function main(){
  if (has('--wayback')) return recordWayback();
  if (arg('--file')) return recordFile();
  return recordToday();
}

main().catch(err => { console.error('map history:', err.message); process.exit(1); });
