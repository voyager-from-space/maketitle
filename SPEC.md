# maketitle v1 spec

Sharpened (what a careful author would do instead of starting from a mock editor): start from a real arXiv source tarball and a real BusyTeX compile. Those compiles are already proven on this box for the acceptance papers, in /workspace/busytest. Beat existing browser editors on two things we can show: the one-swap URL, and compiling those papers without a server timeout.

1. Open: a researcher replaces arxiv.org with maketitle.vercel.app in any paper URL (routes /abs/<id> and /pdf/<id> are domain-agnostic), or pastes an arXiv URL or id on the home page, or drops an Overleaf, Prism or LaTeX zip. No account. Done when: opening https://maketitle.vercel.app/abs/1706.03762 starts fetch and compile with no other click; a pasted id or a dropped zip on the home page does the same.

2. Compile: BusyTeX in a Web Worker. Load the recommended preset first; load the extra set only when the providespackage index says the project needs it. Preview is one pass; Full build runs every pass plus bib. Cache assets in Cache Storage or a service worker. Show first-load MB and progress honestly. Done when: 1706.03762, 1512.03385, 1810.04805, 2106.09685 and 2310.06825 compile with 0 unresolved refs; a warm recompile of 1706.03762 is under 10 s, measured in the timing panel; the TikZ+pgfplots, beamer, biblatex+biber and fontspec/XeLaTeX samples in /workspace/busytest/public/docs pass; at least 8 of 10 papers pass on a wider list that includes one beamer, one biblatex and one XeLaTeX paper.

3. Proxy: one Vercel function, team voyagers-projectss only, GET arxiv.org/src/<id>. It accepts arXiv ids only, caches results, and waits at least 3 s between upstream requests. Papers that have only a PDF get a clear message. Done when: verify calls the function with a valid id (source comes back), a non-id (rejected), and a PDF-only id (clear message); it cannot be used as an open proxy.

4. Work: CodeMirror 6, file tree, PDF.js preview, error log with jump-to-line, Ctrl+Enter to recompile, download of the PDF and the project zip, autosave in IndexedDB, a second visit works offline. Timing panel shows time per pass, total, engine and top warnings. Done when: the demo works (open 1706.03762, change the title to "Attention Is Not All You Need", press Ctrl+Enter, a new PDF appears); an Overleaf zip imports and compiles; with the network off, a second visit still opens the last project; the README states the measured first-load size.

5. Ship: no "arxiv" in the product name or domain (copy may say it works with arXiv papers). AGPL-3.0 with credit to BusyTeX/TeXlyre. Denylist grep is clean on the repo and the deploy. Deploy only to voyagers-projectss. Fetched sources are leak-scanned (reuse papershed's scanner) and the page warns before comments are shown. Done when: scripts/verify and scripts/check-identity are green against the live URL.

Cut from v1: accounts, collaboration, comments, track changes, git, AI, a template gallery, server-side compile, mobile polish.

## Day 0 name
Picked: maketitle. Host: maketitle.vercel.app. Repo: voyager-from-space/maketitle.
Also considered: paperopen (clear, less distinctive) and galleys (fits proof marks, too close to galley.tools and galley.media). Rejected: shipout (ShipOut Inc. WMS at shipout.com), texpress (TeXpresso), offprint (offprint.app and offprint.vercel.app are Offprint, an AI-document product).
