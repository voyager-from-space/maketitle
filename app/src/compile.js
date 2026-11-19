// Wraps texlyre-busytex (BusyTeX in a Web Worker): engine choice, bibliography plan, per-pass timing, log parsing.
import { BusyTexRunner, PdfLatex, XeLatex, LuaLatex } from 'texlyre-busytex';

const abs = (p) => new URL(p, location.href).href;

export class Compiler {
  constructor({ base, onDownload, onNet }) {
    this.base = base; this.onNet = onNet || (() => {}); this.onDownload = onDownload; this.netBytes = 0;
    this.marks = [];
    this.runner = null; this.ready = null; this.restarts = 0; this.useExtra = false;
  }
  // pick the preload set from the project, then start the engine: one module load instead of two when the big set is needed
  async prepare(project) {
    if (this.ready) return this.ready;
    if (!this.prep) this.prep = (async () => { this.useExtra = await this.needsExtra(project); this.runner = this.makeRunner(); return this.init(); })();
    return this.prep;
  }
  makeRunner() {
    const base = this.base;
    return new BusyTexRunner({
      busytexBasePath: abs(base + 'core').replace(/\/$/, ''),
      preloadDataPackages: this.useExtra ? [abs(base + 'core/texlive-recommended.js'), abs(base + 'core/texlive-extra.js')] : [abs(base + 'core/texlive-recommended.js')],
      catalogDataPackages: [abs(base + 'core/texlive-recommended.js'), abs(base + 'core/texlive-extra.js')],
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
      if (data && data.mt_net != null) { this.netBytes = (this.netBase || 0) + data.mt_net; this.onNet(this.netBytes); }
      else if (data && typeof data.print === 'string') this.marks.push({ t: performance.now(), msg: data.print });
    });
  }
  async compile(project, { mode = 'full', chapter = null } = {}) {
    await this.prepare(project);
    this.hookWorker();
    const Eng = project.engine === 'xe' ? XeLatex : project.engine === 'lua' ? LuaLatex : PdfLatex;
    const full = mode === 'full';
    const plan = full ? project.bibPlan() : { bibtex: false, biber: false, why: mode === 'chapter' ? 'one file only: no bibliography run' : 'preview: one pass, no bibliography' };
    // single-chapter build: the main preamble plus an \input of the open file
    const wrap = mode === 'chapter' && chapter ? project.chapterWrapper(chapter) : null;
    const main = wrap ? wrap.path : project.main;
    const input = wrap ? wrap.text : project.files.get(main);
    const files = wrap ? project.allFiles() : project.forCompile();
    this.marks = [];
    const t0 = performance.now();
    let tool = new Eng(this.runner);
    let r, error = null;
    if (!this.useExtra && await this.needsExtra(project)) this.useExtra = true;
    const rec = abs(this.base + 'core/texlive-recommended.js'), extra = abs(this.base + 'core/texlive-extra.js');
    const attempt = async () => {
      this.marks = [];
      try {
        r = await tool.compile({
          input, mainTexPath: main, additionalFiles: files,
          bibtex: plan.bibtex, biber: plan.biber, rerun: mode !== 'quick', dataPackagesJs: this.useExtra ? [rec, extra] : [rec],
        });
        error = null;
      } catch (e) { error = String(e && e.message || e); }
    };
    await attempt();
    // the extra TeX Live set (pgfplots, beamer, biblatex, ...) is ~260 MB: only fetch it when the small set was not enough
    if (!this.useExtra && !(r && r.success && r.pdf)) { this.firstTry = { error, ...parseLog(r), log: ((r && r.log) || '').slice(-1500) }; this.useExtra = true; this.retriedWithExtra = true; await attempt(); }
    // "file not found" for a file the TeX Live sets do provide means a cached data package did not mount: restart the worker, once or twice
    const missing = () => { const m = /File `([^']+?)(?:\.(?:sty|cls|def|cfg|clo|fd))?' not found/.exec((r && r.log) || ''); return m ? m[1].toLowerCase() : null; };
    let engineRestarts = 0;
    while (!(r && r.success && r.pdf) && engineRestarts < 2) {
      const miss = missing(); const idx = this.index;
      if (!miss || !idx || !(idx.extra.has(miss) || idx.rec.has(miss) || idx.basic.has(miss))) break;
      engineRestarts++; this.useExtra = this.useExtra || idx.extra.has(miss);
      await this.restart(); tool = new Eng(this.runner); await attempt();
    }
    const totalMs = Math.round(performance.now() - t0);
    const passes = passTimes(this.marks);
    const log = (r && r.log) || '';
    return {
      ok: !!(r && r.success && r.pdf), pdf: r && r.pdf, log, error, totalMs, passes, plan, mode, chapter: wrap ? chapter : null, initMs: this.initMs, engineRestarts,
      usedExtra: !!this.useExtra, firstTry: this.firstTry, engine: project.engine === 'xe' ? 'XeLaTeX' : project.engine === 'lua' ? 'LuaLaTeX' : 'pdfLaTeX',
      ...parseLog(r), netBytes: this.netBytes,
    };
  }
  // package names the project asks for that only the big "extra" TeX Live set provides
  async needsExtra(project) {
    if (!this.index) {
      const get = async (n) => new Set([...(await (await fetch(abs(this.base + 'core/texlive-' + n + '.js.providespackage.txt'))).text()).matchAll(/\\ProvidesPackage\{([^}]+)\}/g)].map((m) => m[1].toLowerCase().trim()));
      try { const [extra, rec, basic] = await Promise.all([get('extra'), get('recommended'), get('basic')]); this.index = { extra, rec, basic }; } catch { this.index = { extra: new Set(), rec: new Set(), basic: new Set() }; }
    }
    const { extra, rec, basic } = this.index;
    for (const [p, t] of project.texts()) {
      if (!/\.(tex|ltx|sty|cls)$/i.test(p)) continue;
      for (const m of t.matchAll(/\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g)) {
        for (const n of m[1].split(',').map((x) => x.trim().toLowerCase())) if (n && extra.has(n) && !rec.has(n) && !basic.has(n)) return true;
      }
    }
    return false;
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
