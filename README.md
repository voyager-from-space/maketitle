# maketitle

Swap `arxiv.org` for this site in a paper link and the paper's LaTeX source opens in an editor and compiles in your browser tab. You can also paste an arXiv id or drop a zip (Overleaf and Prism exports work). No account, no upload, no server compile.

    https://arxiv.org/abs/1706.03762
    https://maketitle.vercel.app/abs/1706.03762

Live: https://maketitle.vercel.app/ (static deploy on Vercel, no functions). Mirror: https://voyager-from-space.github.io/maketitle/ (same build with the base path `/maketitle/`, so the swapped link there is `/maketitle/abs/<id>`).

## What it does

- Fetches `arxiv.org/src/<id>` straight from the browser (arXiv sends `Access-Control-Allow-Origin: *`, so there is no proxy and no server), unpacks the tar.gz or zip, and finds the main file, the engine (pdfLaTeX, XeLaTeX or LuaLaTeX) and the bibliography plan.
- Compiles with [BusyTeX](https://github.com/busytex/busytex) (TeX Live 2026 in WebAssembly, packaged by [texlyre-busytex](https://github.com/TeXlyre/texlyre-busytex)) in a Web Worker.
- Editor (CodeMirror 6), file tree, PDF preview (pdf.js), error list that jumps to the line, Ctrl+Enter to recompile, PDF and project zip download.
- Three build modes: Full build (all passes plus bibliography), Preview (one pass, no bibliography) and This file only (the main preamble plus the open chapter, for big theses; citations and references to other files show as `?`).
- `/pdf/<id>` opens the paper wide with the source hidden (like arXiv's PDF page); Edit switches to the editor without reloading.
- Timing panel: engine, total, engine start, bytes downloaded, a bar per TeX pass, the most repeated warnings, and the [texdiet](https://github.com/voyager-from-space/texdiet) rules over the project (heavy images, TikZ not externalized, big bibliographies) with file:line links.
- Autosave: every edit is saved to IndexedDB in your browser. Reload and your edited copy opens again (a banner offers "Start over from arXiv"). The home page lists saved papers.
- Offline: a service worker keeps the app, and the engine files are kept in Cache Storage and IndexedDB. After one compile, a saved paper opens and recompiles with no network at all (checked with every host's DNS blocked).
- Phone layout (up to 800 px wide): one pane at a time (Files, Source, PDF) with a tab bar, 44 px touch targets, no sideways scrolling.
- arXiv requests from the page are spaced at least 3 seconds apart (arXiv's terms).
- Scans fetched source for emails, credentials, private cloud links and to-dos and shows a warning before the source (and its comments) is displayed. The scan is a heuristic and can miss things.

## First-load size

Measured in Chrome (headless) on the build box, from the live site, counting bytes over the network:

| Case | Downloaded |
|---|---|
| Plain article (amsmath, graphicx), engine plus the recommended TeX Live set | 166.5 MB |
| The five test papers below, which each need the extra set (multirow, tabulary, nicefrac, tcolorbox, environ) | 416.6 MB |
| Later visits in the same browser (TeX Live data in IndexedDB, engine .wasm in Cache Storage) | 0 MB of TeX Live; the service worker keeps about 15 MB of this site's own scripts |

1 MB here is 1,048,576 bytes. Files are stored gzip-compressed and unpacked in the browser. The counter covers the TeX Live files from the assets site, not this site's own scripts.

Memory: with the extra set loaded the tab is heavy. Chrome on the build box held about 1.3 GB for it when the box ran out of memory once. Not tested on low-memory machines.

## Where things live

- App, primary: Vercel project `maketitle`, a static deploy of `node build.mjs --base /` (`app/vercel.json` rewrites `/abs/<id>` and `/pdf/<id>` to the app). No functions, no proxy.
- App, mirror: GitHub Pages of this repo, branch `gh-pages` (built by `scripts/deploy-pages.sh`, base `/maketitle/`).
- Engine and TeX Live data: [voyager-from-space/maketitle-assets](https://github.com/voyager-from-space/maketitle-assets), served from GitHub Pages as gzip streams cut into 80 MB parts (Pages rejects files over 100 MB). `app/public/core/busytex_worker.js` answers the engine's `fetch()` for `.data` and `.wasm` files by downloading the parts in order and gunzipping them with `DecompressionStream`.
- GitHub Releases were tried first for the big files and do not work: the download redirect carries no CORS headers, so a browser page cannot fetch it.

## Build

    cd app && npm install && node build.mjs --base /maketitle/ --out dist
    node serve.mjs dist 8801 /maketitle/

`app/public/core/` holds the BusyTeX JavaScript files. `busytex_pipeline.js` has one small change (marked `maketitle:`): when the caller names the data packages, packages the index cannot place no longer pull in every data package. The `texlive-*.js` and `biber.js` loaders have one fix (marked `maketitle:`): chunks of a cached package are put back in order when they finish out of order. If a cached package still fails to mount on a cold start, the compile restarts the worker once or twice and the timing panel says so.

## Checks

    node scripts/verify.mjs https://maketitle.vercel.app/ 1706.03762 --demo
    node scripts/verify-zip.mjs https://maketitle.vercel.app/ test/zips/plain.zip
    node scripts/features.mjs https://maketitle.vercel.app/ 1706.03762   # modes, timing panel, autosave, /pdf view, offline, phone layout
    scripts/check-identity.sh

## Not in v1

Accounts, collaboration, comments, track changes, git, AI, a template gallery and server-side compile.

## Licence

AGPL-3.0-or-later (see LICENSE). The compile engine is BusyTeX/texlyre-busytex (AGPL-3.0) with TeX Live packages under their own licences. pdf.js is Apache-2.0, CodeMirror MIT, fflate MIT. Fonts are EB Garamond and IBM Plex under the SIL Open Font License (`app/public/fonts/OFL.txt`).

maketitle is an independent tool and is not affiliated with arXiv.
