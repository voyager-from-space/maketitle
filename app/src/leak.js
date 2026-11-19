// Leak scan, reused from papershed (same author): heuristic, flags things worth a second look before you read a paper's comments.
// index of the first unescaped %, or -1. Skips \verb|...| and escaped chars.
export function commentStart(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\') {
      const v = /^\\verb\*?([^a-zA-Z\s*])/.exec(line.slice(i));
      if (v) { const end = line.indexOf(v[1], i + v[0].length); if (end < 0) return -1; i = end; continue; }
      i++; continue;
    }
    if (c === '%') return i;
  }
  return -1;
}

// ---------- leak scan (heuristic) ----------
export const LEAK_RULES = [
  { id: 'private-key', kind: 'credential', label: 'Private key block', re: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/g },
  { id: 'aws-key', kind: 'credential', label: 'AWS access key id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'github-token', kind: 'credential', label: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/g },
  { id: 'api-key', kind: 'credential', label: 'API key', re: /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|xox[abprs]-[A-Za-z0-9-]{10,}|hf_[A-Za-z0-9]{30,})\b/g },
  { id: 'password', kind: 'credential', label: 'Password or secret', re: /\b(?:pass(?:word|wd)?|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*[^\s,;}]{4,}/gi },
  { id: 'url-login', kind: 'credential', label: 'Login inside a URL', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@[^\s/]+/gi },
  { id: 'cloud-link', kind: 'cloud link', label: 'Private cloud link', re: /\bhttps?:\/\/(?:(?:drive|docs)\.google\.com|(?:www\.)?dropbox\.com|dl\.dropboxusercontent\.com|(?:www\.)?overleaf\.com\/(?:project|read|\d)|onedrive\.live\.com|1drv\.ms|[a-z0-9-]+\.sharepoint\.com|(?:app\.)?box\.com\/s\/|(?:www\.)?notion\.so|wetransfer\.com|we\.tl)[^\s}\])>"']*/gi },
  { id: 'email', kind: 'email', label: 'Email address', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g },
  { id: 'todo', kind: 'leftover', label: 'To-do left in', re: /\\(?:todo|missingfigure|fixme|note|hl)\b|\b(?:TODO|FIXME|XXX)\b/g },
];
const TEXT_FILE = /\.(tex|ltx|sty|cls|bib|bbl|bst|txt|md|cfg|clo|def|dtx|ins|json|ya?ml|py|r|m|jl|sh|csv|tsv|ini|toml|env|xml|html?|js|lua)$|(^|\/)(00README|README|\.env)[^/]*$/i;
export const isText = (p) => TEXT_FILE.test(p);

// show a few leading chars and hide the rest; never put a whole secret in the report
export function mask(kind, s) {
  if (kind === 'email' || kind === 'leftover') return s;
  if (kind === 'cloud link') { const u = s.match(/^https?:\/\/[^/]+\/?/); return u ? u[0] + '…' : s.slice(0, 20) + '…'; }
  const eq = s.match(/^([^:=]*[:=]\s*)(.*)$/);
  if (eq && /pass|pwd|secret|key|token/i.test(eq[1])) return eq[1] + eq[2].slice(0, 2) + '…';
  return s.slice(0, 4) + '…';
}

export function scanText(path, text) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const claimed = [];
    for (const r of LEAK_RULES) {
      r.re.lastIndex = 0;
      for (const m of line.matchAll(r.re)) {
        const s = m.index, e = s + m[0].length;
        if (claimed.some(([a, b]) => s < b && e > a)) continue; // one finding per span (an email inside a URL login, etc.)
        if (r.id === 'email' && /\.(png|jpe?g|pdf|tex)$/i.test(m[0])) continue;
        claimed.push([s, e]);
        const at = commentStart(line);
        hits.push({ rule: r.id, kind: r.kind, label: r.label, file: path, line: i + 1, match: m[0], inComment: at >= 0 && s > at });
      }
    }
  });
  return hits;
}

