import { zipSync } from 'fflate';
import { Project } from './project.js';
import { unpack } from './archive.js';
import { parseId, fetchSource } from './arxiv.js';
import { scanText, mask } from './leak.js';
import { Compiler } from './compile.js';
import { Editor } from './editor.js';
import { Preview } from './preview.js';
import * as store from './store.js';
import { analyze, fmtBytes } from './diet.js';

const BASE = window.__MT_BASE__ || '/';
const $ = (s, el = document) => el.querySelector(s);
const mb = (n) => (n / 1048576).toFixed(n >= 10485760 ? 0 : 1);
const state = { project: null, id: null, compiler: null, editor: null, preview: null, busy: false, dirty: false, last: null, leaks: [], gate: false, timeline: [], view: 'abs', history: [], key: null, saved: null, narrow: matchMedia('(max-width: 800px)') };
window.__mt = state; // read by the verification script

// ---------- routes ----------
function route() {
  let p = location.pathname;
  if (p.startsWith(BASE)) p = p.slice(BASE.length - 1);
  const m = /^\/(abs|pdf)\/(.+)$/.exec(p);
  if (m) { const id = parseId(m[2]); return id ? { id, view: m[1] } : { bad: m[2] }; }
  const q = new URLSearchParams(location.search).get('p');
  return q ? { key: q, view: 'abs' } : null;
}

// small DOM helper: text goes in as text, never as markup
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e[k] = v; else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v); }
  for (const k of kids.flat()) if (k != null) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}
const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };

function renderHome() {
  document.title = 'maketitle';
  document.body.className = 'home';
  const host = location.host + BASE.replace(/\/$/, '');
  $('#app').innerHTML = `
    <header class="top"><a class="wordmark" href="${BASE}">maketitle</a></header>
    <main>
      <p class="lead">Put this address where arxiv.org was in any paper link. The LaTeX source opens in an editor and compiles in this tab.</p>
      <p class="correction" aria-label="Example: swap the host, keep the path">
        <span class="strike">arxiv.org</span> <span class="insert"></span><span class="path">/abs/1706.03762</span>
      </p>
      <form class="go" id="go">
        <label class="sr" for="q">arXiv link or id</label>
        <input id="q" name="q" type="text" autocomplete="off" spellcheck="false" autofocus placeholder="arxiv.org/abs/1706.03762" />
        <button type="submit">Open</button>
      </form>
      <p class="error" id="err" role="alert" hidden></p>
      <label class="drop" id="drop" tabindex="0">Or drop a zip with a LaTeX project here, or <u>choose one</u>.<input id="zip" type="file" accept=".zip,.gz,.tgz,.tar,.tar.gz" hidden></label>
      <section class="saved" id="saved" hidden><h2>In this browser</h2><ul id="savedl"></ul></section>
      <p class="hint">No account. Nothing is uploaded: the TeX engine runs on your computer. The first compile downloads TeX Live: about 167 MB for a plain article, about 417 MB when the paper uses common packages such as multirow or tabulary. Your browser keeps it, so later visits are fast and papers you opened still open and compile with no connection.</p>
    </main>`;
  $('.insert').textContent = host;
  const err = (m) => { const e = $('#err'); e.textContent = m; e.hidden = !m; };
  $('#go').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = parseId($('#q').value);
    if (!id) return err('That is not an arXiv link or id. Try arxiv.org/abs/1706.03762.');
    history.pushState({}, '', BASE + 'abs/' + id); start();
  });
  const takeFile = async (f) => { if (!f) return; try { await openBytes(new Uint8Array(await f.arrayBuffer()), f.name.replace(/\.(zip|tar\.gz|tgz|tar|gz)$/i, ''), f.name); } catch (e) { err(e.message); } };
  $('#zip').addEventListener('change', (e) => takeFile(e.target.files[0]));
  const drop = $('#drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); takeFile(e.dataTransfer.files[0]); });
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') $('#zip').click(); });
  renderSaved();
}
async function renderSaved() {
  if (!store.supported()) return;
  let items = []; try { items = await store.list(); } catch { return; }
  const box = $('#saved'); if (!box || !items.length) return;
  const ul = $('#savedl'); ul.replaceChildren();
  for (const it of items) {
    const href = it.from === 'arxiv' ? BASE + 'abs/' + it.key : BASE + '?p=' + encodeURIComponent(it.key);
    const li = h('li', null,
      h('a', { href, onclick: (e) => { e.preventDefault(); history.pushState({}, '', href); start(); } }, it.label || it.key),
      h('span', { class: 'when' }, (it.edited ? 'edited ' : 'saved ') + ago(it.savedAt)),
      h('button', { type: 'button', 'aria-label': 'Remove ' + (it.label || it.key) + ' from this browser', onclick: async () => { await store.del(it.key); renderSaved(); if (!(await store.list()).length) box.hidden = true; } }, 'Remove'));
    ul.append(li);
  }
  box.hidden = false;
}

// ---------- editor shell ----------
function renderEditor(label, view) {
  document.body.className = 'editor view-' + view;
  state.view = view;
  $('#app').innerHTML = `
    <header class="bar">
      <a class="wordmark" href="${BASE}">maketitle</a>
      <span class="id"></span>
      <span class="title"></span>
      <span class="status busy" id="status" role="status">Starting…</span>
      <span class="tools">
        <span class="views" role="group" aria-label="View"><a id="v-abs" href="#">Edit</a><a id="v-pdf" href="#">PDF only</a></span>
        <label class="mode"><span class="sr">Build mode</span><select id="mode"><option value="full">Full build</option><option value="quick">Preview (1 pass)</option><option value="chapter">This file only</option></select></label>
        <button id="run" type="button" title="Ctrl+Enter">Compile <kbd>Ctrl+Enter</kbd></button>
        <button id="timing" type="button" aria-expanded="false" aria-controls="timingp">Timing</button>
        <details class="more" id="more"><summary>Export</summary><div class="menu"><button id="dlpdf" type="button" disabled>Download PDF</button><button id="dlzip" type="button" disabled>Download project zip</button></div></details>
      </span>
    </header>
    <div class="notice" id="notice" hidden></div>
    <div class="panes" data-tab="source" id="panes">
      <nav class="tree" aria-label="Project files"><h2>Files</h2><ul id="files"></ul></nav>
      <section class="source" aria-label="Source"><div id="cm"></div><div class="gate" id="gate" hidden></div></section>
      <section class="page" aria-label="Preview"><div class="pdf" id="pdf"><div class="sheet"><p class="sheet-kicker" id="sheetk">Waiting for the source</p></div></div></section>
      <aside class="timingp" id="timingp" aria-label="Build timing" hidden></aside>
    </div>
    <div class="problems" id="problems" hidden></div>
    <footer class="meter" id="meter"><span>pdfLaTeX</span><span id="m-load"></span></footer>
    <nav class="tabs" id="tabs" aria-label="Panes"><button type="button" data-tab="files">Files</button><button type="button" data-tab="source" aria-current="true">Source</button><button type="button" data-tab="pdf">PDF</button></nav>`;
  $('.id').textContent = label;
  document.title = label + ' · maketitle';
  state.editor = new Editor($('#cm'), { onChange, onRun: () => compile() });
  state.preview = new Preview($('#pdf'), BASE + 'pdf.worker.min.mjs');
  $('#run').onclick = () => compile();
  $('#dlpdf').onclick = () => state.last && state.last.pdf && save(state.last.pdf, (state.id || 'paper').replace(/\//g, '_') + '.pdf', 'application/pdf');
  $('#dlzip').onclick = downloadZip;
  $('#timing').onclick = () => toggleTiming();
  $('#v-abs').onclick = (e) => { e.preventDefault(); setView('abs', true); };
  $('#v-pdf').onclick = (e) => { e.preventDefault(); setView('pdf', true); };
  for (const b of $('#tabs').children) b.onclick = () => setTab(b.dataset.tab);
  paintViews();
  if (!state.keysBound) {
    state.keysBound = true;
    document.addEventListener('keydown', (e) => { if (!e.defaultPrevented && (e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); compile(); } if (e.key === 'Escape' && state.timingOpen) toggleTiming(false); });
    addEventListener('resize', () => { clearTimeout(state.rz); state.rz = setTimeout(() => state.preview && state.preview.relayout(), 150); });
    addEventListener('offline', () => offlineNote()); addEventListener('online', () => offlineNote());
  }
}
const status = (txt, kind = '') => { const s = $('#status'); if (s) { s.textContent = txt; s.className = 'status ' + kind; } };
function notice(msg, ...actions) {
  const n = $('#notice'); if (!n) return;
  if (!msg) { n.hidden = true; return; }
  n.replaceChildren(h('span', null, msg), ...actions); n.hidden = false;
}
function offlineNote() { if (!navigator.onLine && $('#status') && !state.busy) status('Offline: working from this browser', ''); }

// desktop: Edit shows all panes, PDF only shows the PDF wide (the /pdf/<id> page). Phone: one pane at a time.
function setView(v, push) {
  state.view = v;
  document.body.className = 'editor view-' + v;
  if (push && state.id) history.pushState({}, '', BASE + (v === 'pdf' ? 'pdf/' : 'abs/') + state.id);
  paintViews();
  if (v === 'abs' && state.gatePending) { state.gatePending = false; showGate(); }
  setTab(v === 'pdf' ? 'pdf' : state.tab === 'pdf' && !state.narrow.matches ? 'source' : state.tab || 'source');
}
function paintViews() {
  const a = $('#v-abs'), p = $('#v-pdf'); if (!a) return;
  for (const [el, on] of [[a, state.view === 'abs'], [p, state.view === 'pdf']]) { if (on) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); }
  const v = $('.views'); if (v) v.hidden = !state.id; // a zip has no arXiv id to swap into a URL
  a.href = state.id ? BASE + 'abs/' + state.id : '#'; p.href = state.id ? BASE + 'pdf/' + state.id : '#';
}
function setTab(t) {
  state.tab = t; const panes = $('#panes'); if (!panes) return;
  panes.dataset.tab = t;
  for (const b of $('#tabs').children) { if (b.dataset.tab === t) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); }
  if (t === 'pdf') requestAnimationFrame(() => state.preview && state.preview.relayout());
  if (t === 'source' && state.editor) state.editor.view.requestMeasure();
}

function save(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type })); const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function downloadZip() {
  const o = {}; for (const p of state.project.entries()) o[p] = state.project.toBytes(p);
  save(zipSync(o), (state.id || state.project.meta.zip || 'project').replace(/\//g, '_') + '.zip', 'application/zip');
}

// ---------- autosave in this browser ----------
function onChange(path, text) {
  state.project.files.set(path, text);
  if (path === state.project.main) { const t = $('.title'); if (t) t.textContent = state.project.title(); }
  state.edited = true; scheduleSave();
}
function scheduleSave() { clearTimeout(state.saveT); state.saveT = setTimeout(saveNow, 400); }
async function saveNow() {
  state.saveT = null;
  if (!state.project || !state.key || !store.supported()) return;
  try {
    await store.put({ key: state.key, label: state.label, from: state.id ? 'arxiv' : 'zip', main: state.project.main, files: state.project.toEntries(), edited: !!state.edited, savedAt: Date.now() });
    state.savedAt = Date.now(); state.saveErr = null;
    const s = $('#m-save'); if (s) s.textContent = 'Saved in this browser';
  } catch (e) { state.saveErr = e.message; const s = $('#m-save'); if (s) { s.textContent = 'Could not save here: ' + e.message; s.className = 'warnc'; } }
}
const flushSave = () => { if (state.saveT) { clearTimeout(state.saveT); state.saveT = null; saveNow(); } };
addEventListener('pagehide', flushSave);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });

function renderTree() {
  const ul = $('#files'); ul.replaceChildren();
  for (const p of state.project.entries()) {
    const li = document.createElement('li'); const b = document.createElement('button');
    b.type = 'button'; b.textContent = p; b.title = p; if (p === state.editor.path) li.className = 'on';
    b.onclick = () => { openFile(p); if (state.narrow.matches) setTab('source'); }; li.appendChild(b); ul.appendChild(li);
  }
}
function openFile(p, line) {
  const v = state.project.files.get(p);
  if (typeof v === 'string') state.editor.open(p, v, false);
  else state.editor.open(p, `[binary file, ${mb(v.length)} MB]`, true);
  renderTree();
  if (line && typeof v === 'string') { if (state.narrow.matches) setTab('source'); state.editor.jump(line); }
}

// ---------- loading a project ----------
async function start() {
  const r = route();
  if (!r) return renderHome();
  if (r.bad) { renderHome(); const e = $('#err'); e.textContent = 'That path is not an arXiv id: ' + r.bad; e.hidden = false; return; }
  state.project = null; state.last = null; state.history = []; state.edited = false; state.busy = false; state.timingOpen = false;
  state.id = r.id || null; state.key = r.key || r.id; state.label = r.id || r.key.replace(/^zip:/, '');
  renderEditor(state.label, r.view);
  setTab(r.view === 'pdf' ? 'pdf' : 'source');
  status('Looking in this browser…', 'busy'); const t0 = performance.now();
  state.timeline.push(['start', 0]);
  startEngine();
  let rec = null;
  try { if (store.supported()) rec = await store.get(state.key); } catch {}
  if (rec) {
    const project = Project.fromEntries(rec.files, r.id ? { id: r.id } : { zip: state.label });
    state.edited = !!rec.edited; state.savedFrom = rec.savedAt; state.fromSaved = true; state.fetchMs = Math.round(performance.now() - t0);
    const restart = h('button', { type: 'button', onclick: () => discardAndRefetch() }, r.id ? 'Start over from arXiv' : 'Discard my copy');
    notice((rec.edited ? 'Opened your edited copy saved in this browser ' : 'Opened the copy saved in this browser ') + ago(rec.savedAt) + '.', restart, h('button', { type: 'button', onclick: () => notice('') }, 'Dismiss'));
    return loaded(project);
  }
  if (!r.id) { renderHome(); const e = $('#err'); e.textContent = 'That project is not saved in this browser any more.'; e.hidden = false; return; }
  state.fromSaved = false;
  try {
    status('Fetching source…', 'busy');
    const bytes = await fetchSource(r.id, (got, total) => status(`Fetching source… ${mb(got)}${total ? ' / ' + mb(total) : ''} MB`, 'busy'));
    state.fetchMs = Math.round(performance.now() - t0);
    const u = unpack(bytes);
    if (u.kind === 'pdf') return fail('This paper has no LaTeX source on arXiv, only a PDF. The author did not upload source, so there is nothing to open.');
    await loaded(new Project(u.files, { id: r.id }));
  } catch (e) {
    fail(navigator.onLine ? e.message : 'You are offline and this paper is not saved in this browser yet. Open it once while online and it will open here with no connection.');
  }
}
async function discardAndRefetch() {
  try { await store.del(state.key); } catch {}
  state.edited = false; start();
}
async function openBytes(bytes, name, hint) {
  const u = unpack(bytes, hint);
  if (u.kind === 'pdf') throw new Error('That is a PDF. Drop a zip with .tex files.');
  const p = new Project(u.files, { zip: name });
  if (!p.main) throw new Error('No .tex file with \\documentclass and \\begin{document} in that archive.');
  state.project = null; state.last = null; state.history = []; state.edited = false; state.busy = false; state.fromSaved = false;
  state.id = null; state.label = name || 'zip'; state.key = 'zip:' + state.label;
  renderEditor(state.label, 'abs'); startEngine(); history.replaceState({}, '', BASE + '?p=' + encodeURIComponent(state.key));
  setTab('source');
  await loaded(p);
}
function fail(msg) {
  status('Could not open', 'bad');
  const g = $('#gate'); g.hidden = false;
  g.innerHTML = '<div class="gate-card"><h2>Could not open this paper</h2><p></p><a class="primary" href="' + BASE + '">Back</a></div>'; $('p', g).textContent = msg;
  if (state.view === 'pdf') setView('abs', false);
}

function startEngine() {
  if (state.compiler) return;
  state.compiler = new Compiler({
    base: BASE,
    onDownload: (p) => { if (p.percent < 100) status(`Loading TeX Live… ${p.percent}% (${mb(state.compiler.netBytes)} MB downloaded)`, 'busy'); },
    onNet: (n) => { const e = $('#m-load'); if (e && !state.engineReady) e.textContent = `downloaded ${mb(n)} MB`; state.firstLoadBytes = n; const t = $('#m-net'); if (t) t.textContent = `TeX Live download: ${mb(n)} MB`; },
  });
}
function prepareEngine(project) {
  state.engineStart = performance.now();
  return state.compiler.prepare(project).then((ms) => { state.engineReady = true; state.initMs = ms; }).catch((e) => status('TeX engine failed to start: ' + e.message, 'bad'));
}

async function loaded(project) {
  state.project = project;
  if (!project.main) return fail('No main .tex file found (no file has both \\documentclass and \\begin{document}).');
  $('.title').textContent = project.title();
  state.editor.reset(); openFile(project.main);
  // leak scan: warn before showing comments
  const hits = [];
  for (const [p, t] of project.texts()) if (/\.(tex|ltx|sty|cls|bib|bbl|txt|md)$/i.test(p)) hits.push(...scanText(p, t));
  state.leaks = hits.filter((h) => h.inComment || h.kind === 'credential');
  if (state.leaks.length) { if (state.view === 'abs') showGate(); else state.gatePending = true; }
  $('#dlzip').disabled = false;
  prepareEngine(project);
  if (!state.fromSaved) saveNow(); // keep a copy so the paper opens again with no connection
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {}
  await compile(true);
}

function showGate() {
  const g = $('#gate'); const byKind = new Map();
  for (const h of state.leaks) byKind.set(h.kind + (h.inComment ? ' in comments' : ''), (byKind.get(h.kind + (h.inComment ? ' in comments' : '')) || 0) + 1);
  const files = new Set(state.leaks.map((h) => h.file));
  g.hidden = false; state.gate = true;
  g.innerHTML = `<div class="gate-card" role="dialog" aria-label="Review before reading comments">
    <h2>Read this before you open the source</h2>
    <p>This paper's source has ${state.leaks.length} line${state.leaks.length === 1 ? '' : 's'} that may not have been meant for readers: ${[...byKind].map(([k, n]) => `${n} ${k}`).join(', ')}, in ${files.size} file${files.size === 1 ? '' : 's'}. Authors sometimes leave notes, addresses or links in comments that the PDF does not show. Nothing leaves your computer.</p>
    <ul class="leaks">${state.leaks.slice(0, 5).map((h) => `<li><code></code></li>`).join('')}</ul>
    <button type="button" class="primary" id="gate-ok">Show the source</button></div>`;
  [...g.querySelectorAll('.leaks code')].forEach((c, i) => { const h = state.leaks[i]; c.textContent = `${h.file}:${h.line}  ${h.label}: ${mask(h.kind, h.match)}`; });
  $('#gate-ok').onclick = () => { g.hidden = true; state.gate = false; };
  $('#gate-ok').focus();
}

// ---------- compile ----------
async function compile(first = false) {
  if (!state.project) return;
  if (state.busy) { state.dirty = true; return; }
  state.busy = true; state.dirty = false;
  let mode = first ? 'full' : $('#mode').value, chapter = null;
  if (mode === 'chapter') {
    const p = state.editor.path;
    if (p && p !== state.project.main && /\.tex$/i.test(p)) chapter = p;
    else { mode = 'full'; notice('"This file only" needs a chapter open in the editor, not the main file. Built the whole project instead.', h('button', { type: 'button', onclick: () => notice('') }, 'Dismiss')); }
  }
  $('#run').disabled = true;
  const sk = $('#sheetk'); if (sk) sk.textContent = 'Compiling the first pass…';
  status(state.engineReady ? 'Compiling…' : 'Loading TeX Live…', 'busy');
  let r;
  try { r = await state.compiler.compile(state.project, { mode, chapter }); } catch (e) { r = { ok: false, error: e.message, errors: [], passes: [], totalMs: 0, mode }; }
  state.last = r; state.busy = false; $('#run').disabled = false;
  r.at = new Date(); r.n = state.history.length + 1; state.history.push(r);
  if (r.ok) {
    const pages = await state.preview.show(r.pdf);
    r.numPages = pages; r.pdfBytes = r.pdf.length; $('#dlpdf').disabled = false; r.shown = true;
    const scope = r.chapter ? ` · ${r.chapter} only` : r.mode === 'quick' ? ' · preview' : '';
    status(`Compiled in ${(r.totalMs / 1000).toFixed(1)} s · ${pages} page${pages === 1 ? '' : 's'}${scope}`, 'ok');
    if (first && state.narrow.matches && state.view === 'abs' && state.tab === 'source' && !state.gate) setTab('pdf');
  } else r.shown = true;
  if (!r.ok) { status(r.error ? 'Compile failed' : `Compile failed: ${r.errors[0] ? r.errors[0].msg : 'see log'}`, 'bad'); if (state.narrow.matches && state.view === 'abs') setTab('source'); }
  renderMeter(r); renderProblems(r); if (state.timingOpen) renderTiming();
  if (state.dirty) compile();
}

function renderMeter(r) {
  const m = $('#meter');
  const passes = r.passes.map((p) => `${passLabel(p.cmd)} ${(p.ms / 1000).toFixed(1)} s`).join(' → ');
  const warn = r.topWarnings && r.topWarnings.length ? r.topWarnings.map((w) => `${w.n}× ${w.text}`).join(' | ') : '';
  m.replaceChildren();
  const add = (t, cls, id) => { const s = document.createElement('span'); s.textContent = t; if (cls) s.className = cls; if (id) s.id = id; m.appendChild(s); };
  add(r.engine || '');
  add(r.plan ? r.plan.why : '');
  if (r.chapter) add(`only ${r.chapter}: cites and refs to other files show as ?`, 'warnc');
  if (passes) add(passes, 'passes');
  add(`total ${(r.totalMs / 1000).toFixed(1)} s`);
  add(`${r.undefinedRefs || 0} unresolved ref${r.undefinedRefs === 1 ? '' : 's'}`, r.undefinedRefs ? 'warnc' : '');
  add(`${r.warnings || 0} warnings`);
  if (warn) add(warn, 'wide');
  if (state.firstLoadBytes) add(`TeX Live download: ${mb(state.firstLoadBytes)} MB`, '', 'm-net');
  if (state.key) add(state.saveErr ? 'Could not save here: ' + state.saveErr : state.savedAt ? 'Saved in this browser' : '', state.saveErr ? 'warnc' : '', 'm-save');
}
const passLabel = (c) => c.replace(/^(pdflatex|xelatex|lualatex|luahblatex)$/, 'TeX');

function renderProblems(r) {
  const el = $('#problems'); el.replaceChildren();
  const errs = r.errors || [];
  if (!errs.length && !r.error) { el.hidden = true; return; }
  el.hidden = false;
  if (r.error) { const p = document.createElement('p'); p.textContent = r.error; el.appendChild(p); }
  for (const e of errs.slice(0, 8)) {
    const b = document.createElement('button'); b.type = 'button';
    const named = e.file && /(^|\/)mt-chapter\.tex$/.test(e.file) ? state.project.main : e.file;
    const file = named && state.project.files.has(named) ? named : state.project.main;
    b.textContent = `${file}${e.line ? ':' + e.line : ''}  ${e.msg}`;
    b.onclick = () => openFile(file, e.line); el.appendChild(b);
  }
}

// ---------- timing panel (texdiet-lite) ----------
function toggleTiming(open) {
  state.timingOpen = open == null ? !state.timingOpen : open;
  const p = $('#timingp'); p.hidden = !state.timingOpen; $('#timing').setAttribute('aria-expanded', String(state.timingOpen));
  document.body.classList.toggle('timing-open', state.timingOpen);
  if (state.timingOpen) { renderTiming(); const c = $('.close', p); if (c) c.focus(); } else $('#timing').focus();
  requestAnimationFrame(() => state.preview && state.preview.relayout());
}
const sec = (ms) => (ms / 1000).toFixed(ms >= 10000 ? 1 : 2) + ' s';
function renderTiming() {
  const p = $('#timingp'); p.replaceChildren();
  const r = state.last;
  const head = h('div', { class: 'tp-head' }, h('h2', null, 'Build timing'), h('button', { class: 'close', type: 'button', onclick: () => toggleTiming(false) }, 'Close'));
  if (!r) { p.append(head, h('p', { class: 'tp-empty' }, 'Compile once and the passes show up here.')); return; }
  const kv = (k, v) => [h('dt', null, k), h('dd', null, v)];
  const scope = r.chapter ? 'This file only: ' + r.chapter : r.mode === 'quick' ? 'Preview, one pass' : 'Full build';
  const sum = h('dl', { class: 'tp-kv' },
    kv('Build', scope), kv('Engine', r.engine || ''), kv('Total', sec(r.totalMs)),
    kv('Engine start', r.initMs != null ? sec(r.initMs) + (state.history[0] === r ? '' : ' (first compile only)') : 'n/a'),
    kv('Source', state.fromSaved ? 'from this browser' : state.fetchMs != null ? 'fetched in ' + sec(state.fetchMs) : 'n/a'),
    ...(r.engineRestarts ? kv('Engine restarts', r.engineRestarts + ' (a cached TeX Live package did not mount; started a fresh worker)') : []),
    kv('TeX Live downloaded', state.firstLoadBytes ? mb(state.firstLoadBytes) + ' MB' : 'none (cached)'),
    kv('PDF', r.pdfBytes ? fmtBytes(r.pdfBytes) + (r.numPages ? ', ' + r.numPages + ' pages' : '') : 'none'));
  // passes with bars scaled to the longest
  const passes = r.passes || []; const max = Math.max(1, ...passes.map((x) => x.ms)); const tot = passes.reduce((n, x) => n + x.ms, 0);
  const tbl = h('table', { class: 'tp-passes' }, h('caption', null, 'Passes'),
    ...passes.map((x, i) => h('tr', null, h('th', { scope: 'row' }, `${i + 1}. ${passLabel(x.cmd)}`), h('td', { class: 'tbar' }, h('span', { class: 'track' }, h('i', { style: `width:${Math.max(2, Math.round((x.ms / max) * 100))}%` }))), h('td', { class: 'n' }, sec(x.ms)))),
    passes.length ? h('tr', { class: 'rest' }, h('th', { scope: 'row' }, 'Setup, package load'), h('td'), h('td', { class: 'n' }, sec(Math.max(0, r.totalMs - tot)))) : h('tr', null, h('td', { colspan: 3 }, 'No pass timings recorded.')));
  const warns = (r.topWarnings || []).length ? h('div', { class: 'tp-sec' }, h('h3', null, 'Most repeated warnings'), h('ul', null, ...r.topWarnings.map((w) => h('li', null, h('b', null, w.n + '×'), ' ', w.text)))) : null;
  // texdiet rules over the project files: what is likely to make it slow
  let diet = null;
  try {
    const files = [...state.project.files].map(([path, v]) => { const bytes = typeof v === 'string' ? new TextEncoder().encode(v) : v; return { path, size: bytes.length, bytes }; });
    const a = analyze({ files });
    const top = a.findings.slice(0, 5);
    diet = h('div', { class: 'tp-sec' }, h('h3', null, 'What can make this project slow'),
      h('p', { class: 'tp-note' }, `${a.stats.files} files, ${fmtBytes(a.stats.bytes)} in total, ${fmtBytes(a.stats.imageBytes)} of images.`),
      top.length ? h('ul', { class: 'tp-find' }, ...top.map((f) => h('li', null, h('b', null, f.title), h('span', { class: 'sev ' + f.severity }, f.severity), h('span', { class: 'tp-note' }, f.measured),
        ...(f.where || []).slice(0, 2).map((w) => h('button', { type: 'button', onclick: () => { if (state.project.files.has(w.file)) { openFile(w.file, w.line); if (state.narrow.matches) toggleTiming(false); } } }, `${w.file}:${w.line}`))))) : h('p', { class: 'tp-note' }, 'Nothing in the project looks heavy.'));
  } catch (e) { diet = null; }
  const hist = state.history.length > 1 ? h('table', { class: 'tp-hist' }, h('caption', null, 'This session'),
    ...state.history.slice(-8).map((x) => h('tr', null, h('th', { scope: 'row' }, '#' + x.n), h('td', null, x.chapter ? 'file' : x.mode === 'quick' ? 'preview' : 'full'), h('td', { class: 'n' }, x.ok ? sec(x.totalMs) : 'failed')))) : null;
  p.append(head, sum, tbl, warns, diet, hist);
}

addEventListener('popstate', () => { const r = route(); if (r && r.id && r.id === state.id && state.project) setView(r.view, false); else start(); });
start();
// offline support: the service worker keeps the app and the TeX engine files
if ('serviceWorker' in navigator && location.protocol !== 'file:') addEventListener('load', () => navigator.serviceWorker.register(BASE + 'sw.js', { scope: BASE }).catch(() => {}));
