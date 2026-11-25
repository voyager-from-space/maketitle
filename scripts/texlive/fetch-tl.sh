#!/bin/sh
# fetch-tl.sh <dir> <tlpkg>...: unpacks TeX Live packages from a CTAN tlnet mirror (TDS layout) for build-overlay.mjs
d=$1; shift; mkdir -p "$d"
for p in "$@"; do mkdir -p "$d/$p" && { curl -sfL "https://mirrors.mit.edu/CTAN/systems/texlive/tlnet/archive/$p.tar.xz" || curl -sfL "https://mirrors.ctan.org/systems/texlive/tlnet/archive/$p.tar.xz"; } | tar xJ -C "$d/$p" && rm -rf "$d/$p/tlpkg"; [ -d "$d/$p/texmf-dist" ] && { mv "$d/$p/texmf-dist/"* "$d/$p/"; rmdir "$d/$p/texmf-dist"; } && echo "$p $(du -sh "$d/$p" | cut -f1)" || echo "$p FAILED"; done
