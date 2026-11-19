#!/bin/sh
# Builds the app for https://voyager-from-space.github.io/maketitle/ and pushes it to the gh-pages branch.
# Usage: scripts/deploy-pages.sh   (needs VOYAGER_GITHUB_TOKEN in the environment; it is never printed or written)
set -e
cd "$(dirname "$0")/.."
(cd app && node build.mjs --base /maketitle/ --out dist)
# denylist grep over exactly what will be served
if grep -rniaF -f .identity-denylist app/dist >/dev/null 2>&1; then echo "IDENTITY LEAK in app/dist"; grep -rniaF -l -f .identity-denylist app/dist; exit 1; fi
echo "dist identity check: clean"
W=../maketitle-pages
if [ ! -d "$W/.git" ]; then mkdir -p "$W"; git -C "$W" init -q -b gh-pages; git -C "$W" remote add origin https://github.com/voyager-from-space/maketitle.git; fi
git -C "$W" config user.name voyager-from-space; git -C "$W" config user.email 258675602+voyager-from-space@users.noreply.github.com
find "$W" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -r app/dist/. "$W/"; touch "$W/.nojekyll"
git -C "$W" add -A; git -C "$W" commit -qm "deploy $(date -u +%Y-%m-%dT%H:%MZ)" || echo "nothing to commit"
git -C "$W" -c credential.helper= -c credential.helper="$HOME/.mt-cred.sh" push -q origin gh-pages
git -C "$W" log -1 --format='%H %an <%ae> / committer %cn <%ce>'
