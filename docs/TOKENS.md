# Design tokens (critiqued before code)

Who: a researcher who already has an arXiv URL or a LaTeX zip.
One job: open that source and compile it in the tab.
Feeling: the paper was already editable. The swap did the work.

Vernacular: galley proofs and proofreader marks (strike the old host, write in the new one), TeX type, a printer's imposing stone vs the sheet of paper. Not a SaaS marketing page.

Tokens
- stone #1e1d1b  editor chrome (the imposing stone)
- stone-2 #2a2926  raised chrome
- paper #f7f7f4  the sheet (cool off-white, not cream)
- ink #171614  type on paper
- rule #8a8578  metal rules, muted
- proof #c41e3a  strikethrough and errors only
- insert #1f4e79  the written-in host (blue pencil)
- muted #6e6a60  secondary labels

Type
- Display and home body: EB Garamond (academic book face, already on the box; OFL, will self-host).
- UI chrome: IBM Plex Sans (OFL).
- URLs, ids, source: IBM Plex Mono (OFL).

Spacing: 8 px scale. Home is a single column, measure about 36 rem, wide margins like a preprint. Editor is a header plus three panes.

Memorable element (one): the URL set as a proof correction. arxiv.org is struck in proof red; maketitle.vercel.app is written in with the blue pencil; the path stays. No second gimmick, no feature-card grid.

Critique: with Inter, white cards and a gradient this would be any dev tool. Garamond, the stone/sheet split, and the correction mark belong to typesetting. Cream + terracotta and acid green are out.
