#!/bin/sh
# local-build.sh <outdir>: builds the app with the overlay named in ../maketitle-texlive and points the TeX Live mirror at a local tlserve on :4310
cd "$(dirname "$0")/../app" || exit 2
O=$(ls ../../maketitle-texlive | grep '^overlay-' | head -1)
node -e "const f='public/mt-config.json',c=JSON.parse(require('fs').readFileSync(f));c.tl.overlay='$O';require('fs').writeFileSync(f,JSON.stringify(c,null,1)+'\n')"
node build.mjs --base / --out "$1" >/dev/null && node -e "const f='$1/mt-config.json',c=JSON.parse(require('fs').readFileSync(f));c.tl.mirrors=['http://localhost:4310/'];require('fs').writeFileSync(f,JSON.stringify(c))" && echo "built $1 with $O"
