const fs = require('fs');
const path = require('path');

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(entry.name)) out.push(full);
  }
}

const files = [];
walk('src', files);

const hookRe = /\buse(State|Effect|Context|Ref|Memo|Callback|Reducer)\s*(<[^>]*>)?\s*\(/;
const report = [];

for (const f of files) {
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split(String.fromCharCode(10));
  let firstReturnLine = -1;
  let firstReturnIndent = -1;
  let hooksAfterReturn = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const trimmed = l.trim();
    const indent = l.length - l.replace(/^\s+/, '').length;
    const isComponentLevelReturn = trimmed.startsWith('return') && indent <= 6 && !trimmed.startsWith('return (') === false || (trimmed.startsWith('return') && indent <= 6);
    if (firstReturnLine === -1 && trimmed.startsWith('if (') && indent <= 6) {
      // check if this if-block contains a return on the same or next couple lines (early return pattern)
      const lookahead = lines.slice(i, i + 5).join(' ');
      if (/return/.test(lookahead)) {
        firstReturnLine = i + 1;
        firstReturnIndent = indent;
      }
    }
    if (firstReturnLine !== -1 && i + 1 > firstReturnLine && hookRe.test(l)) {
      hooksAfterReturn.push((i + 1) + ': ' + trimmed.slice(0, 80));
    }
  }
  if (firstReturnLine !== -1 && hooksAfterReturn.length > 0) {
    report.push({ file: f, firstReturnLine, hooksAfterReturn });
  }
}

const out = [];
if (report.length === 0) {
  out.push('NO ISSUES FOUND — no hooks detected after an early conditional return in any src file.');
} else {
  for (const r of report) {
    out.push('=== ' + r.file + ' (first early-return-ish "if" at line ' + r.firstReturnLine + ') ===');
    r.hooksAfterReturn.forEach(h => out.push('  ' + h));
  }
}
fs.writeFileSync('audit_out.txt', out.join(String.fromCharCode(10)), 'utf8');
console.log('WROTE audit_out.txt, ' + report.length + ' file(s) flagged');
