// Project model: files, main file, engine and bibliography detection.
const TEXT = /\.(tex|ltx|sty|cls|bib|bbl|bst|txt|md|cfg|clo|def|dtx|ins|json|ya?ml|csv|tsv|ini|toml|xml|lua|sh|py|r|m|ist|gl|ldf|fd|cbx|bbx|lbx|aux|tikz|pgf)$|(^|\/)(00README|README)[^/]*$/i;
export const isText = (p) => TEXT.test(p);
const dec = new TextDecoder('utf-8'), enc = new TextEncoder();

// strip a single shared top-level folder
function normalize(files) {
  const firsts = new Set(files.map((f) => (f.path.includes('/') ? f.path.split('/')[0] : '')));
  if (firsts.size === 1 && !firsts.has('')) { const cut = [...firsts][0].length + 1; return files.map((f) => ({ ...f, path: f.path.slice(cut) })); }
  return files;
}
const JUNK = /(^|\/)(__MACOSX|\.git)\/|(^|\/)(\.DS_Store|Thumbs\.db|\._[^/]*)$/;

export class Project {
  constructor(rawFiles, meta = {}) {
    this.meta = meta;
    this.files = new Map(); // path -> string (text) | Uint8Array (binary)
    for (const f of normalize(rawFiles.filter((f) => !JUNK.test(f.path)))) {
      this.files.set(f.path, isText(f.path) ? dec.decode(f.bytes) : f.bytes);
    }
    this.main = this.findMain();
    this.engine = this.detectEngine();
  }
  texts() { return [...this.files].filter(([, v]) => typeof v === 'string'); }
  findMain() {
    const roots = this.texts().filter(([p, t]) => /\.(tex|ltx)$/i.test(p) && /^[^%\n]*\\documentclass/m.test(t) && /\\begin\s*\{document\}/.test(t)).map(([p]) => p);
    const rank = (p) => (/(^|\/)(main|ms|paper|root|arxiv)\.tex$/i.test(p) ? 0 : 1);
    return roots.sort((a, b) => rank(a) - rank(b) || a.split('/').length - b.split('/').length || a.localeCompare(b))[0] || null;
  }
  detectEngine() {
    const all = this.texts().filter(([p]) => /\.(tex|ltx|sty|cls)$/i.test(p)).map(([, t]) => t).join('\n');
    const main = this.files.get(this.main) || '';
    const magic = /^\s*%\s*!TEX\s+(?:TS-)?program\s*=\s*(\w+)/im.exec(main);
    if (magic) { const m = magic[1].toLowerCase(); if (m.startsWith('xe')) return 'xe'; if (m.startsWith('lua')) return 'lua'; if (m.startsWith('pdf')) return 'pdf'; }
    if (/\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{[^}]*\b(?:fontspec|polyglossia|xeCJK|unicode-math)\b/.test(all)) return 'xe';
    if (/\\directlua|\\usepackage(?:\[[^\]]*\])?\{[^}]*\b(?:luacode|luatexja|lualatex-math)\b/.test(all)) return 'lua';
    return 'pdf';
  }
  // what the pipeline should do about the bibliography
  bibPlan() {
    const main = this.files.get(this.main) || '';
    const stem = this.main.replace(/\.tex$/i, '');
    if (this.files.has(stem + '.bbl')) return { bibtex: false, biber: false, why: 'ready-made .bbl' };
    const all = this.texts().filter(([p]) => /\.(tex|ltx)$/i.test(p)).map(([, t]) => t).join('\n');
    const hasBib = [...this.files.keys()].some((p) => /\.bib$/i.test(p));
    if (/\\usepackage(?:\[[^\]]*\])?\{[^}]*biblatex[^}]*\}/.test(all) && hasBib) {
      return /backend\s*=\s*bibtex/.test(all) ? { bibtex: true, biber: false, why: 'biblatex (bibtex backend)' } : { bibtex: true, biber: true, why: 'biblatex (biber)' };
    }
    if (/\\bibliography\s*\{/.test(all) && hasBib) return { bibtex: true, biber: false, why: 'BibTeX' };
    return { bibtex: false, biber: false, why: 'no bibliography run needed' };
  }
  title() {
    const t = this.files.get(this.main) || '';
    const m = /\\title\s*(?:\[[^\]]*\])?\s*\{((?:[^{}]|\{[^{}]*\})*)\}/.exec(t);
    return m ? m[1].replace(/\\\\|\\(?:thanks|footnote)\{[^}]*\}/g, ' ').replace(/[{}\\]/g, '').replace(/\s+/g, ' ').trim() : '';
  }
  static fromEntries(entries, meta = {}) {
    const p = Object.create(Project.prototype);
    p.meta = meta; p.files = new Map(entries); p.main = p.findMain(); p.engine = p.detectEngine();
    return p;
  }
  toEntries() { return [...this.files]; }
  // the main file's preamble plus one \input of the open file, so one chapter compiles alone
  chapterWrapper(path) {
    const main = this.files.get(this.main) || '';
    const i = main.search(/\\begin\s*\{document\}/);
    const dir = this.main.includes('/') ? this.main.slice(0, this.main.lastIndexOf('/') + 1) : '';
    const rel = (path.startsWith(dir) ? path.slice(dir.length) : path).replace(/\.tex$/i, '');
    return { path: dir + 'mt-chapter.tex', text: main.slice(0, i < 0 ? main.length : i) + '\\begin{document}\n\\input{' + rel + '}\n\\end{document}\n' };
  }
  allFiles() { return [...this.files].map(([path, content]) => ({ path, content })); }
  // files for the compiler: everything but the main file
  forCompile() {
    const out = [];
    for (const [path, v] of this.files) if (path !== this.main) out.push({ path, content: v });
    return out;
  }
  entries() { return [...this.files.keys()].sort((a, b) => a.localeCompare(b)); }
  toBytes(path) { const v = this.files.get(path); return typeof v === 'string' ? enc.encode(v) : v; }
}
