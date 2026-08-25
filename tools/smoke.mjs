/* Εκτέλεση της εφαρμογής σε πραγματικό Chromium.
   Ελέγχει ότι κάθε βήμα αποδίδεται, ότι δεν υπάρχει σφάλμα κονσόλας, και ότι
   η μηχανή του άρθρου 156 βγάζει τα αναμενόμενα σε τέσσερα σενάρια. */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const url  = pathToFileURL(path.join(root, 'index.html')).href;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
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

let fail = 0;

/* Η εφαρμογή ξεκινά ολοκάθαρη: οθόνη εκκίνησης με τις τρεις επιλογές. */
const w = await page.evaluate(() => ({
  open: welcomeOpen,
  html: document.getElementById('welcome').innerHTML,
  clean: S.groups.length === 0 && !S.project.ergo,
}));
if (w.open && w.html.includes('Νέο έργο') && w.html.includes('Έλεγχος Α.Π.Ε. τρίτου') && w.clean)
  console.log('✓ οθόνη εκκίνησης: καθαρή αφετηρία με επιλογές');
else { console.log('✗ οθόνη εκκίνησης: ' + JSON.stringify({open:w.open, clean:w.clean})); fail++; }
await page.evaluate(() => welcomeChoose('new'));
const wc = await page.evaluate(() =>
  !welcomeOpen && document.getElementById('welcome').style.display === 'none' && tab === 'p1');
if (wc) console.log('✓ οθόνη εκκίνησης: η επιλογή «Νέο έργο» κλείνει την οθόνη');
else { console.log('✗ οθόνη εκκίνησης: δεν έκλεισε'); fail++; }

await page.evaluate(() => loadDemo());
for (const t of ['p1','p2','p3','p4','p5','p6','p7','e1','e2','e3','e4']) {
  await page.evaluate(id => go(id), t);
  await page.waitForTimeout(100);
  const len = await page.evaluate(() => document.getElementById('content').innerHTML.length);
  /* Τα e3/e4 χωρίς διαβασμένο Πίνακα δείχνουν μικρή καθοδήγηση — όχι κενό. */
  const min = t.charAt(0) === 'e' ? 150 : 400;
  if (len < min) { console.log(`✗ βήμα ${t}: κενό`); fail++; }
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

/* «Έξυπνη» ανάγνωση προϋπολογισμού: αριθμητική γραμμών, ανάκτηση στηλών,
   αθροίσματα ανά ομάδα, συνέχεια των Α.Τ. */
const BUD = `ΠΡΟΫΠΟΛΟΓΙΣΜΟΣ ΜΕΛΕΤΗΣ
1. ΧΩΜΑΤΟΥΡΓΙΚΑ
Εκσκαφη θεμελιων 1 m3 100,00 10,00 1.000,00
Επιχωση 2 m3 50,00 20,00 1.000,00
Σύνολο : 2.100,00
2. ΛΟΙΠΑ
Διαστρωση με ασφαλτο 150,00 4 m2 20,00 17,50 3.000,00
Αλλη εργασια 5 m 10,00 10,00 100,00
Χαλασμενη γραμμη 6 m 10,00 10,00 999,00
Άθροισμα 5.100,00`;
const pr = await page.evaluate(txt => {
  const r = parseBudget(txt);
  const items = []; r.groups.forEach(g => g.items.forEach(i => items.push(i)));
  const at = a => items.find(i => i.at === a) || {};
  return {
    n: items.length, arith: r.meta.arith,
    fixQ: at('4').posotita, fixP: at('4').timi,
    badMark: at('6').ocrAvevaio === true,
    grpIssue: r.meta.quality.issues.some(x => x.t.includes('αθροίζει')),
    gapIssue: r.meta.quality.issues.some(x => x.t.includes('κενά')),
  };
}, BUD);
const pt = (name, ok, extra) => {
  if (ok) console.log('✓ ' + name);
  else { console.log('✗ ' + name + (extra ? ' — ' + extra : '')); fail++; }
};
pt('αναγνωρίστηκαν και οι 5 γραμμές', pr.n === 5, JSON.stringify(pr));
pt('η αριθμητική κάθε γραμμής ελέγχθηκε (3 σωστές, 1 διόρθωση, 1 πρόβλημα)',
   pr.arith && pr.arith.ok === 3 && pr.arith.fix === 1 && pr.arith.bad === 1, JSON.stringify(pr.arith));
pt('μπερδεμένες στήλες ανακτώνται από τη δαπάνη (150 × 20 = 3.000)',
   pr.fixQ === 150 && pr.fixP === 20, pr.fixQ + '×' + pr.fixP);
pt('γραμμή που δεν επαληθεύεται σημαίνεται προς έλεγχο', pr.badMark);
pt('το άθροισμα ελέγχου της ομάδας εντοπίζει τη διαφορά', pr.grpIssue);
pt('τα κενά στην αρίθμηση των Α.Τ. εντοπίζονται', pr.gapIssue);

if (errs.length) { console.log('\nσφάλματα:'); errs.forEach(e => console.log('  ' + e)); fail += errs.length; }
await browser.close();
console.log(fail ? `\n${fail} αποτυχίες` : '\nΌλα πέρασαν');
process.exit(fail ? 1 : 0);
