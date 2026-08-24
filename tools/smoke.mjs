/* Εκτέλεση της εφαρμογής σε πραγματικό Chromium.
   Ελέγχει ότι κάθε βήμα αποδίδεται, ότι δεν υπάρχει σφάλμα κονσόλας, και ότι
   η μηχανή του άρθρου 156 βγάζει τα αναμενόμενα σε τέσσερα σενάρια. */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const url  = pathToFileURL(path.join(root, 'index.html')).href;

const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await page.goto(url);
await page.waitForTimeout(600);

/* Όταν το config.js δείχνει σε βάση, η εφαρμογή ανοίγει με την οθόνη
   σύνδεσης. Ο έλεγχος αφορά την ίδια την εφαρμογή, οπότε μπαίνουμε
   στη λειτουργία χωρίς σύνδεση. */
const gated = await page.evaluate(() => document.getElementById('login').innerHTML.length > 0);
if (gated) {
  await page.evaluate(() => workOffline());
  await page.waitForTimeout(200);
  console.log('✓ οθόνη σύνδεσης εμφανίστηκε και παρακάμφθηκε');
}
await page.evaluate(() => loadDemo());

let fail = 0;
for (const t of ['p1','p2','p3','p4','p5','p6','p7','e1','e2','e3','e4']) {
  await page.evaluate(id => go(id), t);
  await page.waitForTimeout(100);
  const len = await page.evaluate(() => document.getElementById('content').innerHTML.length);
  if (len < 400) { console.log(`✗ βήμα ${t}: κενό`); fail++; }
  else console.log(`✓ βήμα ${t} (${len} χαρ.)`);
}

const mk = (n,d,it) => ({id:'g'+n,name:n,discount:d,
  items: it.map((x,i) => ({id:n+i,at:''+i,perigrafi:'a',monada:'m',
    posotita:x[0],timi:x[1],posotitaApe:x[2],isNew:!!x[3]}))});
const setup = g => `S=blank();S.project.geoe=18;S.project.apr=15;S.project.fpa=24;S.groups=${JSON.stringify(g)};`;

const cases = [
  ['όριο 20% εντός ομάδας', [mk('A',0,[[100,10,200],[100,10,0]])], {eliUsed:472, aprNeed:708}],
  ['μεταφορά μεταξύ ομάδων', [mk('A',0,[[100,10,200]]), mk('B',0,[[100,10,0]])], {eliUsed:236, aprNeed:944}],
  ['νέα εργασία μόνο από απρόβλεπτα', [mk('A',0,[[1000,100,1000],[0,5000,1,true]])], {eliUsed:0, aprNeed:5900}],
  ['νέα εργασία με μεγάλη μείωση', [mk('A',0,[[1000,100,500],[0,5000,1,true]])], {eliUsed:0, aprNeed:5900}],
];
for (const [name, g, exp] of cases) {
  const r = await page.evaluate(s => { eval(s); const c = calc();
    return {eliUsed:c.eliUsed, aprNeed:c.aprNeed, symDelta:c.symDelta}; }, setup(g));
  const ok = Object.entries(exp).every(([k,v]) => Math.abs(r[k]-v) < 0.01);
  if (!ok) { console.log(`✗ ${name}: ${JSON.stringify(r)}`); fail++; }
  else console.log(`✓ ${name}`);
}

if (errs.length) { console.log('\nσφάλματα:'); errs.forEach(e => console.log('  ' + e)); fail += errs.length; }
await browser.close();
console.log(fail ? `\n${fail} αποτυχίες` : '\nΌλα πέρασαν');
process.exit(fail ? 1 : 0);
