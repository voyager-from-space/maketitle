// prints the "tl" section of maketitle's mt-config.json for a built maketitle-texlive tree
// usage: node mkconfig.mjs <treedir> <mirror1/> [mirror2/ ...]
import { readFileSync, readdirSync } from 'node:fs';
const [dir, ...mirrors] = process.argv.slice(2);
const { index } = JSON.parse(readFileSync(dir + '/latest.json', 'utf8'));
const files = {};
for (const f of readdirSync(dir + '/e')) { const m = /^(busytex|biber)-[0-9a-f]+\.(wasm|data)\.gz$/.exec(f); if (m) files[m[1] + '.' + m[2]] = 'e/' + f; }
console.log(JSON.stringify({ tl: { mirrors, index, files } }, null, 1));
