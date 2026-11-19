import { zipSync } from 'fflate';
import { Project } from './project.js';
import { unpack } from './archive.js';
import { parseId, fetchSource } from './arxiv.js';
import { scanText, mask } from './leak.js';
import { Compiler } from './compile.js';
import { Editor } from './editor.js';
import { Preview } from './preview.js';

const BASE = window.__MT_BASE__ || '/';
const $ = (s, el = document) => el.querySelector(s);
const mb = (n) => (n / 1048576).toFixed(n >= 10485760 ? 0 : 1);
const state = { project: null, id: null, compiler: null, editor: null, preview: null, busy: false, dirty: false, last: null, leaks: [], gate: false, timeline: [] };
window.__mt = state; // read by the verification script

// ---------- routes ----------
function route() {
  let p = location.pathname;
  if (p.startsWith(BASE)) p = p.slice(BASE.length - 1);
  const m = /^\/(?:abs|pdf)\/(.+)$/.exec(p);
  return m ? parseId(m[1]) || { bad: m[1] } : null;
}

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
        <input id="q" name="q" type="text" autocomplete="off" spellcheck="false" autofocus placeholder="arxiv.org/abs/1706.03762 or 1706.03762" />
        <button type="submit">Open</button>
      </form>
      <p class="error" id="err" role="alert" hidden></p>
      <label class="drop" id="drop" tabindex="0">Or drop a zip with a LaTeX project here, or <u>choose one</u>.<input id="zip" type="file" accept=".zip,.gz,.tgz,.tar,.tar.gz" hidden></label>
      <p class="hint">No account. Nothing is uploaded: the TeX engine runs on your computer. The first compile downloads TeX Live: about 167 MB for a plain article, about 417 MB when the paper uses common packages such as multirow or tabulary. Your browser keeps it for later visits.</p>
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
}

// ---------- editor shell ----------
function renderEditor(label) {
  document.body.className = 'editor';
  $('#app').innerHTML = `
    <header class="bar">
      <a class="wordmark" href="${BASE}">maketitle</a>
      <span class="id"></span>
      <span class="title"></span>
      <span class="status busy" id="status" role="status">Starting…</span>
      <span class="tools">
        <label class="mode"><span class="sr">Build mode</span><select id="mode"><option value="full">Full build</option><option value="quick">Quick (1 pass)</option></select></label>
        <button id="run" type="button" title="Ctrl+Enter">Compile <kbd>Ctrl+Enter</kbd></button>
        <button id="dlpdf" type="button" disabled>PDF</button>
        <button id="dlzip" type="button" disabled>Project zip</button>
      </span>
    </header>
    <div class="panes">
      <nav class="tree" aria-label="Project files"><h2>Files</h2><ul id="files"></ul></nav>
      <section class="source" aria-label="Source"><div id="cm"></div><div class="gate" id="gate" hidden></div></section>
      <section class="page" aria-label="Preview"><div class="pdf" id="pdf"><div class="sheet"><p class="sheet-kicker" id="sheetk">Waiting for the source</p></div></div></section>
    </div>
    <div class="problems" id="problems" hidden></div>
    <footer class="meter" id="meter"><span>pdfLaTeX</span><span id="m-load"></span></footer>`;
  $('.id').textContent = label;
  document.title = label + ' · maketitle';
  state.editor = new Editor($('#cm'), { onChange, onRun: () => compile() });
  state.preview = new Preview($('#pdf'), BASE + 'pdf.worker.min.mjs');
  $('#run').onclick = () => compile();
  $('#dlpdf').onclick = () => state.last && state.last.pdf && save(state.last.pdf, (state.id || 'paper').replace(/\//g, '_') + '.pdf', 'application/pdf');
  $('#dlzip').onclick = downloadZip;
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); compile(); } });
}
const status = (txt, kind = '') => { const s = $('#status'); if (s) { s.textContent = txt; s.className = 'status ' + kind; } };

function save(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type })); const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function downloadZip() {
  const o = {}; for (const p of state.project.entries()) o[p] = state.project.toBytes(p);
  save(zipSync(o), (state.id || 'project').replace(/\//g, '_') + '.zip', 'application/zip');
}

function onChange(path, text) {
  state.project.files.set(path, text);
  if (path === state.project.main) { const t = $('.title'); if (t) t.textContent = state.project.title(); }
}

function renderTree() {
  const ul = $('#files'); ul.replaceChildren();
  for (const p of state.project.entries()) {
    const li = document.createElement('li'); const b = document.createElement('button');
    b.type = 'button'; b.textContent = p; b.title = p; if (p === state.editor.path) li.className = 'on';
    b.onclick = () => openFile(p); li.appendChild(b); ul.appendChild(li);
  }
}
function openFile(p, line) {
  const v = state.project.files.get(p);
  if (typeof v === 'string') state.editor.open(p, v, false);
  else state.editor.open(p, `[binary file, ${mb(v.length)} MB]`, true);
  renderTree();
  if (line && typeof v === 'string') state.editor.jump(line);
}

// ---------- loading a project ----------
async function start() {
  const r = route();
  if (!r) return renderHome();
  if (r.bad) { renderHome(); const e = $('#err'); e.textContent = 'That path is not an arXiv id: ' + r.bad; e.hidden = false; return; }
  state.id = r; renderEditor(r);
  status('Fetching source…', 'busy'); const t0 = performance.now();
  state.timeline.push(['start', 0]);
  startEngine();
  try {
    const bytes = await fetchSource(r, (got, total) => status(`Fetching source… ${mb(got)}${total ? ' / ' + mb(total) : ''} MB`, 'busy'));
    state.fetchMs = Math.round(performance.now() - t0);
    const u = unpack(bytes);
    if (u.kind === 'pdf') return fail('This paper has no LaTeX source on arXiv, only a PDF. The author did not upload source, so there is nothing to open.');
    await loaded(new Project(u.files, { id: r }));
  } catch (e) { fail(e.message); }
}
async function openBytes(bytes, name, hint) {
  const u = unpack(bytes, hint);
  if (u.kind === 'pdf') throw new Error('That is a PDF. Drop a zip with .tex files.');
  const p = new Project(u.files, { zip: name });
  if (!p.main) throw new Error('No .tex file with \\documentclass and \\begin{document} in that archive.');
  state.id = null; renderEditor(name || 'zip'); startEngine(); history.replaceState({}, '', BASE);
  await loaded(p);
}
function fail(msg) {
  status('Could not open', 'bad');
  const g = $('#gate'); g.hidden = false;
  g.innerHTML = '<div class="gate-card"><h2>Could not open this paper</h2><p></p><a class="primary" href="' + BASE + '">Back</a></div>'; $('p', g).textContent = msg;
}

function startEngine() {
  if (state.compiler) return;
  state.compiler = new Compiler({
    base: BASE,
    onDownload: (p) => { if (p.percent < 100) status(`Loading TeX Live… ${p.percent}% (${mb(state.compiler.netBytes)} MB downloaded)`, 'busy'); },
    onNet: (n) => { const e = $('#m-load'); if (e && !state.engineReady) e.textContent = `downloaded ${mb(n)} MB`; state.firstLoadBytes = n; const t = $('#m-net'); if (t) t.textContent = `TeX Live download: ${mb(n)} MB`; },
  });
  state.engineStart = performance.now();
  state.compiler.init().then((ms) => { state.engineReady = true; state.initMs = ms; }).catch((e) => status('TeX engine failed to start: ' + e.message, 'bad'));
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
  if (state.leaks.length) showGate();
  $('#dlzip').disabled = false;
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
  const full = first || $('#mode').value === 'full';
  $('#run').disabled = true;
  const sk = $('#sheetk'); if (sk) sk.textContent = 'Compiling the first pass…';
  status(state.engineReady ? 'Compiling…' : 'Loading TeX Live…', 'busy');
  let r;
  try { r = await state.compiler.compile(state.project, { full }); } catch (e) { r = { ok: false, error: e.message, errors: [], passes: [], totalMs: 0 }; }
  state.last = r; state.busy = false; $('#run').disabled = false;
  if (r.ok) {
    const pages = await state.preview.show(r.pdf);
    r.numPages = pages; $('#dlpdf').disabled = false; r.shown = true;
    status(`Compiled in ${(r.totalMs / 1000).toFixed(1)} s · ${pages} page${pages === 1 ? '' : 's'}`, 'ok');
  } else r.shown = true;
  if (!r.ok) status(r.error ? 'Compile failed' : `Compile failed: ${r.errors[0] ? r.errors[0].msg : 'see log'}`, 'bad');
  renderMeter(r); renderProblems(r);
  if (state.dirty) compile();
}

function renderMeter(r) {
  const m = $('#meter');
  const passes = r.passes.map((p) => `${p.cmd.replace(/^(pdflatex|xelatex|lualatex|luahblatex)$/, 'TeX')} ${(p.ms / 1000).toFixed(1)} s`).join(' → ');
  const warn = r.topWarnings && r.topWarnings.length ? r.topWarnings.map((w) => `${w.n}× ${w.text}`).join(' | ') : '';
  m.replaceChildren();
  const add = (t, cls) => { const s = document.createElement('span'); s.textContent = t; if (cls) s.className = cls; m.appendChild(s); };
  add(r.engine || '');
  add(r.plan ? r.plan.why : '');
  if (passes) add(passes);
  add(`total ${(r.totalMs / 1000).toFixed(1)} s`);
  add(`${r.undefinedRefs || 0} unresolved ref${r.undefinedRefs === 1 ? '' : 's'}`, r.undefinedRefs ? 'warnc' : '');
  add(`${r.warnings || 0} warnings`);
  if (warn) add(warn, 'wide');
  if (state.firstLoadBytes) { add(`TeX Live download: ${mb(state.firstLoadBytes)} MB`); m.lastChild.id = 'm-net'; }
}

function renderProblems(r) {
  const el = $('#problems'); el.replaceChildren();
  const errs = r.errors || [];
  if (!errs.length && !r.error) { el.hidden = true; return; }
  el.hidden = false;
  if (r.error) { const p = document.createElement('p'); p.textContent = r.error; el.appendChild(p); }
  for (const e of errs.slice(0, 8)) {
    const b = document.createElement('button'); b.type = 'button';
    const file = e.file && state.project.files.has(e.file) ? e.file : state.project.main;
    b.textContent = `${file}${e.line ? ':' + e.line : ''}  ${e.msg}`;
    b.onclick = () => openFile(file, e.line); el.appendChild(b);
  }
}

addEventListener('popstate', start);
start();
