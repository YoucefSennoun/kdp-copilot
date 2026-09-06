const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'src', 'dashboard');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const files = [
  'views/explorer.js',
  'views/niches.js',
  'views/settings.js',
  'views/suggestions.js',
  'views/detail.js'
];

let missing = [];
for (const f of files) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  for (const m of src.matchAll(/\$\('([^']+)'\)/g)) {
    if (!ids.has(m[1])) missing.push(f + ': $("' + m[1] + '")');
  }
}
console.log(missing.length ? 'MISSING IDS:\n' + missing.join('\n') : 'All referenced dashboard IDs exist');