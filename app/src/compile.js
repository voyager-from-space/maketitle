// Wraps texlyre-busytex (BusyTeX in a Web Worker): engine choice, bibliography plan, per-pass timing, log parsing.
import { BusyTexRunner, PdfLatex, XeLatex, LuaLatex } from 'texlyre-busytex';

const abs = (p) => new URL(p, location.href).href;

export class Compiler {
  constructor({ base, onDownload, onNet }) {
    this.base = base; this.onNet = onNet || (() => {}); this.onDownload = onDownload; this.netBytes = 0;
    this.marks = [];
    this.runner = null; this.ready = null; this.restarts = 0;
  }
  // TeX Live is one lazy "data package" (core/mt-texlive.js): files are fetched when TeX opens them, so there is no set to pick
  async prepare() {
    if (this.ready) return this.ready;
    if (!this.prep) this.prep = (async () => { this.runner = this.makeRunner(); return this.init(); })();
    return this.prep;
  }
  makeRunner() {
    const pkg = abs(this.base + 'core/mt-texlive.js');
    return new BusyTexRunner({
      busytexBasePath: abs(this.base + 'core').replace(/\/$/, ''),
      preloadDataPackages: [pkg],
      catalogDataPackages: [pkg],
      onDownloadProgress: this.onDownload || (() => {}),
    });
  }
  // a fresh worker: used when a TeX Live package that is cached in this browser did not mount (seen on cold starts)
  async restart() {
    try { this.runner.terminate(); } catch {}
    this.netBase = this.netBytes; this.runner = this.makeRunner(); this.ready = null; this.prep = null; this._hooked = null; this.restarts++;
    return this.init();
  }
  init() {
    if (!this.ready) {
      const t0 = performance.now();
      this.ready = this.runner.initialize(true).then(() => {
        this.hookWorker();
        this.initMs = Math.round(performance.now() - t0);
        return this.initMs;
      });
      // the worker is created a moment after initialize() starts; listen from the first message
      const iv = setInterval(() => { this.hookWorker(); if (this._hooked) clearInterval(iv); }, 2);
    }
    return this.ready;
  }
  hookWorker() {
    const w = this.runner && this.runner.worker;
    if (!w || this._hooked === w) return;
    this._hooked = w;
    w.addEventListener('message', ({ data }) => {
      if (data && data.mt_lazy) this.lazy = data.mt_lazy;
      else if (data && data.mt_prefetch) this.prefetch = data.mt_prefetch;
      else if (data && data.mt_net != null) { this.netBytes = (this.netBase || 0) + data.mt_net; this.onNet(this.netBytes); }
      else if (data && typeof data.print === 'string') this.marks.push({ t: performance.now(), msg: data.print });
    });
  }
  async compile(project, { mode = 'full', chapter = null } = {}) {
    await this.prepare(project);
    this.hookWorker();
    const Eng = project.engine === 'xe' ? XeLatex : project.engine === 'lua' ? LuaLatex : PdfLatex;
    const full = mode === 'full';
    let plan = full ? project.bibPlan() : { bibtex: false, biber: false, why: mode === 'chapter' ? 'one file only: no bibliography run' : 'preview: one pass, no bibliography' };
    // single-chapter build: the main preamble plus an \input of the open file
    const wrap = mode === 'chapter' && chapter ? project.chapterWrapper(chapter) : null;
    const main = wrap ? wrap.path : project.main;
    let input = wrap ? wrap.text : project.files.get(main);
    let files = wrap ? project.allFiles() : project.forCompile();
    this.marks = [];
    const t0 = performance.now();
    let tool = new Eng(this.runner);
    let r, error = null;
    const pkg = abs(this.base + 'core/mt-texlive.js');
    const attempt = async () => {
      this.marks = [];
      try {
        r = await tool.compile({
          input, mainTexPath: main, additionalFiles: files,
          bibtex: plan.bibtex, biber: plan.biber, rerun: mode !== 'quick', dataPackagesJs: [pkg],
        });
        error = null;
      } catch (e) { error = String(e && e.message || e); }
    };
    await attempt();
    // TeX Live 2026 defines \theH<counter> for every counter itself; papers written for older TeX Live often
    // \newcommand it (the ICML template does), which is now a fatal error. Retry with \providecommand in a compile-only
    // copy, at most 3 times, and say so. The project in the editor is not changed.
    const compat = [];
    for (let k = 0; k < 3 && !(r && r.success && r.pdf); k++) {
      const m = /LaTeX Error: Command \\(theH[A-Za-z@]+) already defined/.exec((r && r.log) || '');
      if (!m || compat.includes(m[1])) break;
      const re = new RegExp('\\\\newcommand\\*?\\s*(\\{\\s*\\\\' + m[1] + '\\s*\\}|\\\\' + m[1] + '(?![A-Za-z@]))', 'g');
      const fix = (t) => (typeof t === 'string' ? t.replace(re, '\\providecommand$1') : t);
      const before = input + files.map((f) => (typeof f.content === 'string' ? f.content : '')).join('');
      input = fix(input); files = files.map((f) => ({ path: f.path, content: fix(f.content) }));
      if (input + files.map((f) => (typeof f.content === 'string' ? f.content : '')).join('') === before) break;
      compat.push(m[1]); await attempt();
    }
    const totalMs = Math.round(performance.now() - t0);
    const passes = passTimes(this.marks);
    const log = (r && r.log) || '';
    return {
      ok: !!(r && r.success && r.pdf), pdf: r && r.pdf, log, error, totalMs, passes, plan, mode, chapter: wrap ? chapter : null, initMs: this.initMs, engineRestarts: 0,
      lazy: this.lazy, prefetch: this.prefetch, compat, engine: project.engine === 'xe' ? 'XeLaTeX' : project.engine === 'lua' ? 'LuaLaTeX' : 'pdfLaTeX',
      ...parseLog(r), netBytes: this.netBytes,
    };
  }
  terminate() { try { this.runner && this.runner.terminate(); } catch {} }
}

function passTimes(marks) {
  const out = []; let cur = null;
  for (const { t, msg } of marks) {
    if (msg.startsWith('$ busytex ')) cur = { cmd: msg.slice(10).split(' ')[0], t };
    else if (msg.startsWith('$ echo $?') && cur) { out.push({ cmd: cur.cmd, ms: Math.round(t - cur.t) }); cur = null; }
  }
  return out;
}

// final TeX log is the last non-empty log in r.logs
function parseLog(r) {
  const logs = (r && r.logs) || [];
  const tex = [...logs].reverse().find((l) => l.log && !/^(bibtex|makeindex|xdvipdfmx|biber)/.test(l.cmd));
  const text = (tex && tex.log) || '';
  const lines = text.split('\n');
  const errors = [];
  const stack = [];
  const fileRe = /\(((?:\.\/)?[\w./@+-]+\.(?:tex|sty|cls|def|cfg|clo|fd|bbl|aux|ltx|cbx|bbx|lbx))(?=[\s)]|$)/g;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    // crude (file ... ) tracking, good enough to name the file in an error
    let m; fileRe.lastIndex = 0;
    const opens = []; while ((m = fileRe.exec(ln))) opens.push(m.index);
    for (const ch of ln) { if (ch === ')' && stack.length) stack.pop(); }
    if (opens.length) { fileRe.lastIndex = 0; while ((m = fileRe.exec(ln))) stack.push(m[1].replace(/^\.\//, '')); }
    if (ln.startsWith('!')) {
      let line = null;
      for (let k = i + 1; k < Math.min(lines.length, i + 8); k++) { const lm = /^l\.(\d+)/.exec(lines[k]); if (lm) { line = Number(lm[1]); break; } }
      errors.push({ msg: ln.replace(/^!\s*/, ''), line, file: stack[stack.length - 1] || null });
    }
  }
  const warn = lines.filter((l) => /Warning:/.test(l));
  const undef = warn.filter((l) => /(Reference|Citation) .*undefined|There were undefined/.test(l) && !/There were undefined/.test(l));
  const counts = new Map();
  for (const w of warn) { const k = w.replace(/\s+on input line \d+\.?$/, '').replace(/ on page \d+/, '').slice(0, 110); counts.set(k, (counts.get(k) || 0) + 1); }
  const topWarnings = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([text, n]) => ({ text, n }));
  const pages = (() => { const m = /Output written on .*\((\d+) pages?/.exec(text); return m ? Number(m[1]) : null; })();
  return { errors, warnings: warn.length, undefinedRefs: undef.length, topWarnings, pages };
}
