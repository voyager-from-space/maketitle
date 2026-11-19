# maketitle

Replace arxiv.org with maketitle.vercel.app in any paper URL. The paper's LaTeX source opens and compiles in your browser tab. You can also paste an arXiv id or drop a zip. No account, no server-side compile.

This is the start of the project (19 Nov 2026). The editor shell is a static prototype. Fetch, unpack and BusyTeX compile are not wired yet, so the page does not yet compile a paper.

## Licence

AGPL-3.0-or-later. Required once texlyre-busytex is vendored; credit to BusyTeX and TeXlyre will land with the engine. The full licence text is in LICENSE.

## Hosting (planned)

The app and a small arXiv-id proxy will live at https://maketitle.vercel.app, on Vercel team voyagers-projectss only. The TeX engine assets (about 686 MB uncompressed on disk) will not ship inside the Vercel deployment. They will be chunked and loaded from GitHub Releases. First-load size will be measured and written here before launch.
