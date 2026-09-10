const fs = require('fs');
const path = require('path');

let bad = 0;
const re = /from\s*['"](\.[^'"]+)['"]|import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;

function check(f) {
  const src = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = re.exec(src))) {
    const spec = m[1] || m[2];
    const target = path.resolve(path.dirname(f), spec);
    if (!fs.existsSync(target)) {
      console.log('MISSING: ' + spec + ' (imported by ' + f + ')');
      bad++;
    }
  }
}

function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js') || e.name.endsWith('.mjs')) check(p);
  }
}

walk(path.join(__dirname, '..', 'src'));
walk(path.join(__dirname));
console.log(bad ? 'IMPORT ERRORS: ' + bad : 'Import graph OK');
process.exit(bad ? 1 : 0);