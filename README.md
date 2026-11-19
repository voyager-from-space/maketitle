# maketitle

Swap `arxiv.org` for this site in any paper link and the paper's LaTeX source opens in an editor and compiles in your browser tab. You can also paste an arXiv id or drop a zip (Overleaf and Prism exports work). No account, no upload, no server compile.

    https://arxiv.org/abs/1706.03762
    https://voyager-from-space.github.io/maketitle/abs/1706.03762

Live: https://voyager-from-space.github.io/maketitle/

## What it does

- Fetches `arxiv.org/src/<id>` straight from the browser (arXiv sends `Access-Control-Allow-Origin: *`, so there is no proxy and no server), unpacks the tar.gz or zip, and finds the main file, the engine (pdfLaTeX, XeLaTeX or LuaLaTeX) and the bibliography plan.
- Compiles with [BusyTeX](https://github.com/busytex/busytex) (TeX Live 2026 in WebAssembly, packaged by [texlyre-busytex](https://github.com/TeXlyre/texlyre-busytex)) in a Web Worker.
- Editor (CodeMirror 6), file tree, PDF preview (pdf.js), error list that jumps to the line, Ctrl+Enter to recompile, PDF and project zip download, a timing line with the time of each TeX pass.
- Scans fetched source for emails, credentials, private cloud links and to-dos and shows a warning before the source (and its comments) is displayed. The scan is a heuristic and can miss things.

## First-load size

Measured in Chrome (headless) on the build box, from the live site, counting bytes over the network:

| Case | Downloaded |
|---|---|
| Plain article (amsmath, graphicx), engine plus the recommended TeX Live set | 166.5 MB |
| The five test papers below, which each need the extra set (multirow, tabulary, nicefrac, tcolorbox, environ) | 416.6 MB |
| Later visits (the TeX Live data is kept in the browser's IndexedDB) | 12 MB (the engine .wasm) |

1 MB here is 1,048,576 bytes. Files are stored gzip-compressed and unpacked in the browser.

## Where things live

- App: GitHub Pages of this repo, branch `gh-pages` (built by `scripts/deploy-pages.sh`).
- Engine and TeX Live data: [voyager-from-space/maketitle-assets](https://github.com/voyager-from-space/maketitle-assets), served from GitHub Pages as gzip streams cut into 80 MB parts (Pages rejects files over 100 MB). `app/public/core/busytex_worker.js` answers the engine's `fetch()` for `.data` and `.wasm` files by downloading the parts in order and gunzipping them with `DecompressionStream`.
- GitHub Releases were tried first for the big files and do not work: the download redirect carries no CORS headers, so a browser page cannot fetch it.

## Build

    cd app && npm install && node build.mjs --base /maketitle/ --out dist
    node serve.mjs dist 8801 /maketitle/

`app/public/core/` holds the BusyTeX JavaScript files. `busytex_pipeline.js` has one small change (marked `maketitle:`): when the caller names the data packages, packages the index cannot place no longer pull in every data package.

## Checks

    node scripts/verify.mjs https://voyager-from-space.github.io/maketitle/ 1706.03762 --demo
    node scripts/verify-zip.mjs https://voyager-from-space.github.io/maketitle/ test/zips/plain.zip
    scripts/check-identity.sh

## Not in v1

Offline mode and service worker, autosave in IndexedDB, a `/pdf/<id>` view that differs from `/abs/<id>` (both open the editor), compile-only-this-chapter, accounts, collaboration, mobile layout.

## Licence

AGPL-3.0-or-later (see LICENSE). The compile engine is BusyTeX/texlyre-busytex (AGPL-3.0) with TeX Live packages under their own licences. pdf.js is Apache-2.0, CodeMirror MIT, fflate MIT. Fonts are EB Garamond and IBM Plex under the SIL Open Font License (`app/public/fonts/OFL.txt`).

maketitle is an independent tool and is not affiliated with arXiv.
