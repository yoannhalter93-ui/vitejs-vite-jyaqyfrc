const fs = require('fs');
const files = fs.readdirSync('src').filter(f => /juggle/i.test(f));
console.log('FILES', files);
const app = fs.readFileSync('src/App.tsx', 'utf8');
const lines = app.split('\n');
lines.forEach((l, i) => {
  if (/JuggleGame/i.test(l)) console.log('APP_REF', i + 1, l.trim());
});
