/* Έλεγχος της λειτουργίας «Έλεγχος Α.Π.Ε. τρίτου» σε πραγματικό Chromium.
   Φορτώνει συνθετικό Πίνακα μέσα από την πλήρη διαδρομή (loadAuditFile),
   επαληθεύει το πόρισμα, την αναθεώρηση, την κρίση, τα έγγραφα, την
   υιοθέτηση στη σύνταξη και την επιβίωση της κατάστασης στην αποθήκευση. */
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
page.on('dialog', d => d.accept());          // τα confirm γίνονται δεκτά

await page.goto(url);
await page.waitForTimeout(600);
if (await page.evaluate(() => document.getElementById('login').innerHTML.length > 0)) {
  await page.evaluate(() => workOffline());
  await page.waitForTimeout(200);
}

let fail = 0, total = 0;
const t = (name, ok, extra) => {
  total++;
  if (ok) console.log('✓ ' + name);
  else { console.log('✗ ' + name + (extra ? ' — ' + extra : '')); fail++; }
};

/* Συνθετικός Α.Π.Ε. με συνεπή αριθμητική:
   ομάδα 2.000,00 / 2.000,00 · έκπτωση 10% · Γ.Ε.&Ο.Ε. 18% · απρόβλεπτα 15%.
   Το άρθρο 1 αυξάνεται (+200), το άρθρο 2 μειώνεται (−200): «επί έλασσον»
   εντός ομάδας, άρα αναμένεται ΠΡΟΣΟΧΗ για σύμφωνη γνώμη Τ.Σ. */
const APE_OK = `ΑΝΑΚΕΦΑΛΑΙΩΤΙΚΟΣ ΠΙΝΑΚΑΣ ΕΡΓΑΣΙΩΝ
ΧΩΜΑΤΟΥΡΓΙΚΑ
Εκσκαφη θεμελιων σε εδαφος γαιωδες 1 m3 100,00 10,00 1.000,00 120,00 10,00 1.200,00
Επιχωση με προϊοντα εκσκαφων 2 m3 50,00 20,00 1.000,00 40,00 20,00 800,00
Μερικό Σύνολο 2.000,00 2.000,00
Αφαιρείται ποσοστό έκπτωσης 10,00 % 200,00 200,00
Ενιαίο όφελος 18,00 % 324,00 324,00
Ενιαία απρόβλεπτα 318,60 318,60
ΣΥΜΒΑΤΙΚΟ ΠΟΣΟ 2.442,60 2.442,60
ΣΥΝΟΛΙΚΑ ΠΟΣΑ ΧΩΡΙΣ ΦΠΑ 2.442,60 2.442,60
Φ.Π.Α. 24,00 % 586,22 586,22
ΣΥΝΟΛΙΚΟ ΠΟΣΟ 3.028,82 3.028,82`;

/* Ίδιος Πίνακας με χαλασμένο άθροισμα ομάδας στη στήλη Α.Π.Ε. */
const APE_BAD = APE_OK.replace('Μερικό Σύνολο 2.000,00 2.000,00',
                               'Μερικό Σύνολο 2.000,00 2.100,00');

/* Φύλλο αναθεώρησης: σωστό σ για ν=3 (σ₁=0,07) και σωστός πολλαπλασιαστής. */
const REV_OK = `ΠΙΝΑΚΑΣ ΑΝΑΘΕΩΡΗΣΗΣ ΤΙΜΩΝ
ν = 3  σ = 0,10  1 - σ = 0,90
Δαπανη βασης 1.000,00 αναθεωρημενη 1.100,00 αποτελεσμα 90,00`;

/* ── 1. εναλλαγή λειτουργίας ── */
await page.evaluate(() => setMode('audit'));
t('εναλλαγή σε λειτουργία ελέγχου', await page.evaluate(() => isAudit() && tab === 'e1'));
t('η ράγα δείχνει δύο λειτουργίες',
  await page.evaluate(() => document.querySelectorAll('.modes button').length === 2));
t('μετρητές: «δεν έχει διαβαστεί Α.Π.Ε.»',
  await page.evaluate(() => document.getElementById('meters').innerText.includes('ΔΕΝ ΕΧΕΙ ΔΙΑΒΑΣΤΕΙ')));

/* ── 2. στοιχεία ελέγχου ── */
await page.evaluate(() => {
  setv('audit.meta.syntaktis', 'ΤΕΧΝΙΚΗ ΑΕ', false);
  setv('audit.meta.elegktis', 'Νικόλαος Μεταξωτός', false);
  setv('audit.meta.arYpovolis', '16/65437', false);
  setv('audit.meta.imElegxou', '15-09-2026', false);
  S.project.ergo = 'ΔΟΚΙΜΑΣΤΙΚΟ ΕΡΓΟ ΕΛΕΓΧΟΥ';
});
t('βήμα 1 αποδίδεται με τα πεδία',
  await page.evaluate(() => { go('e1'); return document.getElementById('content').innerHTML.includes('Συντάκτης'); }));

/* ── 3. πλήρης διαδρομή ανάγνωσης: καθαρός Πίνακας + φύλλο αναθεώρησης ── */
await page.evaluate(async ([ape, rev]) => {
  const f1 = new File([ape], 'ape.txt', { type: 'text/plain' });
  const f2 = new File([rev], 'anatheorisi.txt', { type: 'text/plain' });
  await loadAuditFile({ target: { files: [f1, f2], value: '' } });
}, [APE_OK, REV_OK]);
await page.waitForTimeout(200);

t('μετά την ανάγνωση ανοίγει το πόρισμα', await page.evaluate(() => tab === 'e3'));
t('διαβάστηκαν 2 αρχεία', await page.evaluate(() => S.audit.names.length === 2));
t('αναγνωρίστηκαν 2 άρθρα', await page.evaluate(() => S.audit.data && S.audit.data.articles.length === 2));

const r1 = await page.evaluate(() => {
  const A = S.audit;
  return {
    nErr:  A.findings.filter(x => x.sev === 'err').length,
    nWarn: A.findings.filter(x => x.sev === 'warn').length,
    areas: [...new Set(A.findings.map(x => x.area))].sort().join(','),
    eli:   A.summary.eli, aprNeed: A.summary.aprNeed,
    symC:  A.summary.symC, totA: A.summary.totA,
    verdict: audVerdict(),
  };
});
t('καθαρός Πίνακας: κανένα σφάλμα', r1.nErr === 0, JSON.stringify(r1));
t('«επί έλασσον» εντός ομάδας: 212,40 €', Math.abs(r1.eli - 212.40) < 0.01, String(r1.eli));
t('απρόβλεπτα σε χρήση: 0,00 €', Math.abs(r1.aprNeed) < 0.01, String(r1.aprNeed));
t('δηλωθέν συμβατικό πέρασε στη σύνοψη', Math.abs(r1.symC - 2442.60) < 0.01, String(r1.symC));
t('δηλωθέν γενικό σύνολο πέρασε στη σύνοψη', Math.abs(r1.totA - 3028.82) < 0.01, String(r1.totA));
t('πόρισμα: έγκριση με παρατηρήσεις (γνώμη Τ.Σ.)', r1.verdict === 'obs', r1.verdict);
t('η αναθεώρηση ελέγχθηκε χωρίς σφάλμα',
  await page.evaluate(() =>
    S.audit.findings.some(x => x.area === 'Αναθεώρηση' && x.sev === 'ok') &&
    !S.audit.findings.some(x => x.area === 'Αναθεώρηση' && x.sev === 'err')));

/* ── 4. παρουσίαση πορίσματος ── */
const e3html = await page.evaluate(() => { go('e3'); return document.getElementById('content').innerHTML; });
t('το πόρισμα δείχνει τα βήματα με εξηγήσεις',
  e3html.includes('Βήμα 1 — Αριθμητική άρθρων') && e3html.includes('ποσότητα × τιμή μονάδας'));
t('το πόρισμα δείχνει τον πίνακα ορίων', e3html.includes('Ανεξάρτητος υπολογισμός ορίων'));
t('το πόρισμα δείχνει την κρίση του ελεγκτή', e3html.includes('Κρίση του ελεγκτή'));
t('οι μετρητές δείχνουν το πόρισμα του ελέγχου',
  await page.evaluate(() => document.getElementById('meters').innerText.includes('ΕΓΚΡΙΣΗ ΜΕ ΠΑΡΑΤΗΡΗΣΕΙΣ')));

/* ── 5. έγγραφα ελέγχου ── */
const ekth = await page.evaluate(() => { go('e4'); curAudDoc = 'ekth'; render();
  return document.getElementById('docv').innerHTML; });
t('έκθεση: τίτλος και μέθοδος', ekth.includes('ΕΚΘΕΣΗ ΕΛΕΓΧΟΥ') && ekth.includes('ΜΕΘΟΔΟΣ ΕΛΕΓΧΟΥ'));
t('έκθεση: στοιχεία υποβολής και ελεγκτή', ekth.includes('ΤΕΧΝΙΚΗ ΑΕ') && ekth.includes('Νικόλαος Μεταξωτός'));
t('έκθεση: πίνακας ορίων ανά ομάδα', ekth.includes('ΟΡΙΑ ΤΟΥ ΑΡΘΡΟΥ 156'));
const eis = await page.evaluate(() => { curAudDoc = 'eisA'; render();
  return document.getElementById('docv').innerHTML; });
t('εισήγηση: ΕΙΣΗΓΕΙΤΑΙ έγκριση με παρατηρήσεις',
  eis.includes('ΕΙΣΗΓΕΙΤΑΙ') && eis.includes('με τις παρατηρήσεις'));

/* ── 6. χειροκίνητη κρίση ── */
await page.evaluate(() => setv('audit.meta.symperasma', 'return', false));
t('η χειροκίνητη κρίση υπερισχύει', await page.evaluate(() => audVerdict() === 'return'));
const eis2 = await page.evaluate(() => { render(); return document.getElementById('docv').innerHTML; });
t('εισήγηση: γυρίζει σε επιστροφή για διόρθωση', eis2.includes('επιστροφή του στον συντάκτη'));
await page.evaluate(() => setv('audit.meta.symperasma', 'auto', false));

/* ── 7. επιβίωση στην αποθήκευση (normalize) ── */
t('η κατάσταση ελέγχου επιβιώνει στο normalize',
  await page.evaluate(() => {
    const round = normalize(JSON.parse(JSON.stringify(S)));
    return round.audit.findings.length === S.audit.findings.length &&
           round.audit.meta.elegktis === 'Νικόλαος Μεταξωτός' &&
           round.audit.data.articles.length === 2;
  }));

/* ── 8. Πίνακας με σφάλμα ── */
await page.evaluate(async ape => {
  Object.assign(S.audit, { names: [], findings: [], summary: null, data: null });
  const f = new File([ape], 'ape-lathos.txt', { type: 'text/plain' });
  await loadAuditFile({ target: { files: [f], value: '' } });
}, APE_BAD);
await page.waitForTimeout(200);
const r2 = await page.evaluate(() => ({
  verdict: audVerdict(),
  hasSumErr: S.audit.findings.some(x => x.sev === 'err' && x.what.includes('άθροισμα Α.Π.Ε.')),
}));
t('χαλασμένο άθροισμα ομάδας εντοπίζεται', r2.hasSumErr);
t('πόρισμα: επιστροφή για διόρθωση', r2.verdict === 'return', r2.verdict);
t('μετρητές: επιστροφή για διόρθωση',
  await page.evaluate(() => document.getElementById('meters').innerText.includes('ΕΠΙΣΤΡΟΦΗ ΓΙΑ ΔΙΟΡΘΩΣΗ')));

/* ── 9. υιοθέτηση στη σύνταξη ── */
await page.evaluate(() => adoptAudit());
await page.waitForTimeout(100);
const r3 = await page.evaluate(() => ({
  tab, groups: S.groups.length,
  items: S.groups.reduce((a, g) => a + g.items.length, 0),
  mode: isAudit(),
}));
t('η υιοθέτηση οδηγεί στη σύνταξη (p4)', r3.tab === 'p4' && !r3.mode, JSON.stringify(r3));
t('τα άρθρα μεταφέρθηκαν στο έργο', r3.groups === 1 && r3.items === 2, JSON.stringify(r3));

/* ── 10. καθαρισμός ── */
await page.evaluate(() => { go('e3'); clearAudit(); });
t('ο καθαρισμός αδειάζει ευρήματα, κρατά τα στοιχεία',
  await page.evaluate(() =>
    S.audit.findings.length === 0 && S.audit.data === null &&
    S.audit.meta.elegktis === 'Νικόλαος Μεταξωτός'));

if (errs.length) { console.log('\nσφάλματα σελίδας:'); errs.forEach(e => console.log('  ' + e)); fail += errs.length; }
await browser.close();
console.log(fail ? `\n${fail} αποτυχίες` : `\nΌλα πέρασαν (${total} έλεγχοι)`);
process.exit(fail ? 1 : 0);
