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

Measured in headless Chrome on the build box against the live site (fresh browser profile, 25 Nov 2026), counting bytes over the network:

| Case | Downloaded |
|---|---|
| 1706.03762 (Attention Is All You Need), first visit, everything | 24.5 MB: 20.7 MB TeX Live and engine, 0.5 MB this site, 3.4 MB from arXiv (source and PDF) |
| 2005.14165 (GPT-3), TeX Live and engine | 21.1 MB |
| Later visits in the same browser | 0 MB of TeX Live (Cache Storage `mt-tl-v1`); the service worker keeps this site's own scripts |

Before November 2026 a first visit pulled whole TeX Live bundles: 166.5 MB for a plain article and 416.6 MB for most papers. Now the engine reads TeX Live one file at a time: an index of 23,796 files points into gzip packs of at most 512 KB, the packages named in `\usepackage` are fetched in parallel before the build, and any other file is fetched the first time TeX opens it. 1 MB here is 1,000,000 bytes.

## Which papers build

`test/papers-30.txt` lists 33 well-known arXiv papers. On the live site on 25 Nov 2026, 28 built on the first try. 2205.14135 timed out once and built on a second try (34 pages, 18.5 s). 4 fail:

| Paper | Why |
|---|---|
| 1502.03167 | EPS figures need a converter (epstopdf/Ghostscript) that does not run in the browser |
| 2203.02155 | uses `pythonhighlight.sty`, which is not in TeX Live |
| 1907.11692 | a package patch written for an older TeX Live fails ("patch failed") |
| 1207.7214 | loads a package inside a group, which the 2026 LaTeX kernel rejects |

When a build fails, or while it is still running, the PDF pane shows arXiv's own PDF with a note saying so. It is never blank.

Older papers get three compatibility steps, each reported on screen: METAFONT-only fonts are swapped for close Type 1 fonts (cmttb10 becomes cmtt10, bbm becomes doublestroke), a "`\theH...` already defined" error is retried with `\providecommand`, and a `.bbl` written by another biblatex version is rebuilt with biber.

## Is this new?

Only as a combination. Swapping the domain in an arXiv link is something alphaXiv already does, and other sites already compile arXiv papers in the browser. What maketitle puts together is: the swapped link, the full source in an editor, the compile on your own machine, and offline use after one visit.

## Where things live

- App, primary: Vercel project `maketitle`, a static deploy of `node build.mjs --base /` (`app/vercel.json` rewrites `/abs/<id>` and `/pdf/<id>` to the app). No functions, no proxy.
- App, mirror: GitHub Pages of this repo, branch `gh-pages` (built by `scripts/deploy-pages.sh`, base `/maketitle/`).
- TeX Live and the engine: two repos, [maketitle-tl-a](https://github.com/voyager-from-space/maketitle-tl-a) and [maketitle-tl-b](https://github.com/voyager-from-space/maketitle-tl-b), each a half of the tree under jsDelivr's 150 MB per-repo limit, served at `cdn.jsdelivr.net/gh/voyager-from-space/maketitle-tl-{a,b}@tl1/`. If jsDelivr fails for a file, the worker fetches it from the GitHub Pages copy in [maketitle-texlive](https://github.com/voyager-from-space/maketitle-texlive). The mirror list is `app/public/mt-config.json`.
- Extra CTAN packages that TeX Live's BusyTeX build lacks (inconsolata, newtx, algorithms, algorithmicx, llncs, elsarticle, mhchem, bbm, doublestroke and a few more) are in an overlay built by `scripts/texlive/build-overlay.mjs`.
- GitHub Releases do not work for these files: the download redirect carries no CORS headers.

## Build

    cd app && npm install && node build.mjs --base /maketitle/ --out dist
    node serve.mjs dist 8801 /maketitle/

`app/public/core/` holds the BusyTeX JavaScript files. `busytex_pipeline.js` has one small change (marked `maketitle:`): when the caller names the data packages, packages the index cannot place no longer pull in every data package. The `texlive-*.js` and `biber.js` loaders have one fix (marked `maketitle:`): chunks of a cached package are put back in order when they finish out of order. If a cached package still fails to mount on a cold start, the compile restarts the worker once or twice and the timing panel says so.

## Checks

    node scripts/verify.mjs https://maketitle.vercel.app/ 1706.03762 --demo
    node scripts/verify-zip.mjs https://maketitle.vercel.app/ test/zips/plain.zip
    node scripts/first-visit.mjs https://maketitle.vercel.app/ 1706.03762   # bytes per host on a fresh profile
    node scripts/features.mjs https://maketitle.vercel.app/ 1706.03762   # modes, timing panel, autosave, /pdf view, offline, phone layout
    scripts/check-identity.sh

## Not in v1

Accounts, collaboration, comments, track changes, git, AI, a template gallery and server-side compile.

## Licence

AGPL-3.0-or-later (see LICENSE). The compile engine is BusyTeX/texlyre-busytex (AGPL-3.0) with TeX Live packages under their own licences. pdf.js is Apache-2.0, CodeMirror MIT, fflate MIT. Fonts are EB Garamond and IBM Plex under the SIL Open Font License (`app/public/fonts/OFL.txt`).

maketitle is an independent tool and is not affiliated with arXiv.
