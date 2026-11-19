// PDF preview with pdf.js: pages are drawn when they scroll into view.
import * as pdfjs from 'pdfjs-dist/build/pdf.min.mjs';

export class Preview {
  constructor(el, workerSrc) {
    this.el = el; pdfjs.GlobalWorkerOptions.workerSrc = workerSrc; this.doc = null; this.gen = 0; this.pages = 0;
    this.io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) this.draw(e.target); }), { root: el, rootMargin: '600px 0px' });
  }
  // draw again at the pane's current width (window resized, or the PDF tab was hidden when the PDF arrived)
  relayout() {
    if (!this.bytes || this.busyLayout) return;
    const w = this.el.clientWidth; if (!w || (this.usedW && Math.abs(w - this.usedW) < 8)) return;
    this.show(this.bytes);
  }
  async show(bytes) {
    this.bytes = bytes;
    const gen = ++this.gen;
    const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    if (gen !== this.gen) return;
    const keep = this.el.scrollTop;
    this.io.disconnect();
    if (this.doc) this.doc.destroy();
    this.doc = doc; this.pages = doc.numPages;
    this.el.replaceChildren();
    const first = await doc.getPage(1);
    const cw = this.el.clientWidth; this.usedW = cw;
    const w = Math.min(980, Math.max(200, cw - (cw < 560 ? 20 : 40))); // a page wider than ~980 px only gets blurry and slow to draw
    if (!cw) { this.usedW = 0; }
    for (let i = 1; i <= doc.numPages; i++) {
      const box = document.createElement('div');
      box.className = 'pdfpage'; box.dataset.n = i;
      const vp = first.getViewport({ scale: 1 });
      box.style.width = w + 'px'; box.style.height = Math.round((w * vp.height) / vp.width) + 'px';
      box.setAttribute('aria-label', 'Page ' + i);
      this.el.appendChild(box); this.io.observe(box);
    }
    this.el.scrollTop = keep;
    return doc.numPages;
  }
  async draw(box) {
    try { await this.drawPage(box); } catch (e) { if (!/RenderingCancelled|destroyed|Worker was terminated/i.test(String((e && (e.name + e.message)) || e))) throw e; } // a re-layout replaced this page mid-render
  }
  async drawPage(box) {
    if (box.dataset.done) return; box.dataset.done = '1';
    const doc = this.doc; const page = await doc.getPage(Number(box.dataset.n));
    const w = box.clientWidth; const base = page.getViewport({ scale: 1 });
    const scale = (w / base.width) * (window.devicePixelRatio || 1);
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    c.style.width = '100%'; c.style.height = '100%';
    box.replaceChildren(c);
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    box.classList.add('drawn');
  }
}
