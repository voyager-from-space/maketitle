// arXiv ids and fetching. arxiv.org/src/<id> answers with Access-Control-Allow-Origin: *, so the browser asks arXiv directly.
const NEW = /(\d{4}\.\d{4,5})(v\d+)?/;
const OLD = /([a-z]+(?:-[a-z]+)*(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/;
export function parseId(s) {
  s = decodeURIComponent((s || '').trim()).replace(/\.pdf$/i, '').replace(/^arxiv:/i, '');
  const m = /^(?:https?:\/\/)?(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf|src|e-print|html)\/(.+)$/i.exec(s);
  if (m) s = m[1].replace(/[?#].*$/, '').replace(/\.pdf$/i, '');
  const a = new RegExp('^' + NEW.source + '$').exec(s) || new RegExp('^' + OLD.source + '$').exec(s);
  return a ? a[1] + (a[2] || '') : null;
}
export async function fetchSource(id, onProgress) {
  const url = 'https://arxiv.org/src/' + id;
  let res;
  try { res = await fetch(url); } catch (e) { throw new Error('Could not reach arXiv from this browser (' + e.message + ').'); }
  if (res.status === 404) throw new Error('arXiv has no paper with the id ' + id + '.');
  if (res.status === 429) throw new Error('arXiv asked us to slow down (HTTP 429). Wait a minute and reload.');
  if (!res.ok) throw new Error('arXiv answered HTTP ' + res.status + '.');
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader(); const parts = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; onProgress && onProgress(got, total); }
  const out = new Uint8Array(got); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
