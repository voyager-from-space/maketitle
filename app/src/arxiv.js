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
// arXiv's terms ask for at most one automated request every 3 seconds: keep that even across tabs
async function politeWait() {
  const last = Number(localStorage.getItem('mt-last-arxiv') || 0); const wait = Math.max(0, last + 3000 - Date.now());
  localStorage.setItem('mt-last-arxiv', String(Date.now() + (wait <= 3000 ? wait : 0))); // book the slot before waiting, so a second call queues behind it
  if (wait > 0 && wait <= 3000) await new Promise((r) => setTimeout(r, wait));
}
export async function fetchSource(id, onProgress) {
  await politeWait();
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
// arXiv's own PDF for the preview while the tab's build runs (arxiv.org/pdf/<id> also sends Access-Control-Allow-Origin: *)
export async function fetchPdf(id) {
  await politeWait();
  const res = await fetch('https://arxiv.org/pdf/' + id);
  if (!res.ok || !/pdf/.test(res.headers.get('content-type') || '')) throw new Error('arXiv PDF: HTTP ' + res.status);
  return new Uint8Array(await res.arrayBuffer());
}
