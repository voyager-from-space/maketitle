// Wraps texlyre-busytex (BusyTeX in a Web Worker): engine choice, bibliography plan, per-pass timing, log parsing.
import { BusyTexRunner, PdfLatex, XeLatex, LuaLatex } from 'texlyre-busytex';

const abs = (p) => new URL(p, location.href).href;

export class Compiler {
  constructor({ base, onDownload, onNet }) {
    this.base = base; this.onNet = onNet || (() => {}); this.netBytes = 0;
    this.marks = [];
    this.runner = new BusyTexRunner({
      busytexBasePath: abs(base + 'core').replace(/\/$/, ''),
      preloadDataPackages: [abs(base + 'core/texlive-recommended.js')],
      catalogDataPackages: [abs(base + 'core/texlive-recommended.js'), abs(base + 'core/texlive-extra.js')],
      onDownloadProgress: onDownload || (() => {}),
    });
    this.ready = null;
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
    const w = this.runner.worker;
    if (!w || this._hooked === w) return;
    this._hooked = w;
    w.addEventListener('message', ({ data }) => {
      if (data && data.mt_net != null) { this.netBytes = data.mt_net; this.onNet(this.netBytes); }
      else if (data && typeof data.print === 'string') this.marks.push({ t: performance.now(), msg: data.print });
    });
  }
  async compile(project, { full = true, files = null } = {}) {
    await this.init();
    this.hookWorker();
    const Eng = project.engine === 'xe' ? XeLatex : project.engine === 'lua' ? LuaLatex : PdfLatex;
    const plan = full ? project.bibPlan() : { bibtex: false, biber: false, why: 'quick preview: one pass, no bibliography' };
    const main = project.main;
    this.marks = [];
    const t0 = performance.now();
    const tool = new Eng(this.runner);
    let r, error = null;
    const rec = abs(this.base + 'core/texlive-recommended.js'), extra = abs(this.base + 'core/texlive-extra.js');
    const attempt = async () => {
      this.marks = [];
      try {
        r = await tool.compile({
          input: project.files.get(main), mainTexPath: main, additionalFiles: files || project.forCompile(),
          bibtex: plan.bibtex, biber: plan.biber, rerun: full, dataPackagesJs: this.useExtra ? [rec, extra] : [rec],
        });
        error = null;
      } catch (e) { error = String(e && e.message || e); }
    };
    await attempt();
    // the extra TeX Live set (pgfplots, beamer, biblatex, ...) is ~260 MB: only fetch it when the small set was not enough
    if (!this.useExtra && !(r && r.success && r.pdf)) { this.firstTry = { error, ...parseLog(r), log: ((r && r.log) || '').slice(-1500) }; this.useExtra = true; this.retriedWithExtra = true; await attempt(); }
    const totalMs = Math.round(performance.now() - t0);
    const passes = passTimes(this.marks);
    const log = (r && r.log) || '';
    return {
      ok: !!(r && r.success && r.pdf), pdf: r && r.pdf, log, error, totalMs, passes, plan,
      usedExtra: !!this.useExtra, firstTry: this.firstTry, engine: project.engine === 'xe' ? 'XeLaTeX' : project.engine === 'lua' ? 'LuaLaTeX' : 'pdfLaTeX',
      ...parseLog(r), netBytes: this.netBytes,
    };
  }
  terminate() { try { this.runner.terminate(); } catch {} }
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
