/* ══════════════════════════════════════════════════════════════════
   Έλεγχος της άντλησης στοιχείων από το ΚΗΜΔΗΣ (Open Data API).

   Ο mock απαντά στο /functions/v1/kimdis-lookup με payload στο ΑΚΡΙΒΕΣ
   σχήμα του πραγματικού API (επαληθευμένο με ζωντανή κλήση στη σύμβαση
   25SYMV017115178): πεδία title, referenceNumber, contractNumber,
   contractSignedDate, aaht, organization{key,value}, legalContext,
   contractingDataDetails.contractingMembersDataList[{name,vatNumber}],
   totalCostWithVAT/WithoutVAT, objectDetailsList[{vat,cpvs}] κ.λπ.

   1. node tools/mock/supabase-mock.mjs        (σε άλλο τερματικό)
   2. node tools/kimdis_test.mjs
   ══════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const cfg  = path.join(root, 'config.js');
const saved = fs.readFileSync(cfg, 'utf8');
fs.writeFileSync(cfg,
  "window.APE_SUPABASE_URL='http://127.0.0.1:8899';\nwindow.APE_SUPABASE_ANON='mock';\n");
process.on('exit', () => fs.writeFileSync(cfg, saved));

const MOCK = 'http://127.0.0.1:8899';
try {
  await fetch(MOCK + '/__reset', { headers: { apikey: 'x' } });
} catch {
  console.error('Ο mock δεν απαντά. Ξεκινήστε τον με: node tools/mock/supabase-mock.mjs');
  process.exit(1);
}
const setK = payload => fetch(MOCK + '/__kimdis', {
  method: 'POST', headers: { apikey: 'x' }, body: JSON.stringify(payload) });

/* Σύμβαση έργου ΚΑΤΩ των ορίων, στο σχήμα του πραγματικού ΚΗΜΔΗΣ. */
const SYMV = {
  ok: true, kind: 'SYMV', endpoint: 'contract', adam: '24SYMV014820133',
  attachmentUrl: 'https://cerpp.eprocurement.gov.gr/khmdhs-opendata/contract/attachment/24SYMV014820133',
  raw: {
    title: 'ΕΠΙΣΚΕΥΗ ΚΑΙ ΣΥΝΤΗΡΗΣΗ ΣΧΟΛΙΚΩΝ ΚΤΙΡΙΩΝ Δ.Ε. ΡΟΔΟΥ',
    referenceNumber: '24SYMV014820133',
    contractNumber: '2/16988',
    contractSignedDate: '2024-03-11',
    submissionDate: '2024-03-11T10:00:00.000',
    aaht: '206123',
    organization: { key: '6265', value: 'ΔΗΜΟΣ ΡΟΔΟΥ' },
    legalContext: { key: '2', value: 'ν.4412/2016 - Βιβλίο Ι – κάτω των ορίων' },
    contractType: { key: '1', value: 'Έργα' },
    procedureType: { key: '1', value: 'Ανοιχτή διαδικασία' },
    fundingDetails: { publicFundingRef: 'ΣΑΤΑ', publicFundingRefNum: '2023ΣΑΤΑ0001' },
    contractingDataDetails: {
      signers: { key: '1', value: 'ΔΗΜΑΡΧΟΣ ΡΟΔΟΥ' },
      contractingMembersDataList: [{ country: { key: 'GR', value: 'Ελλάδα' },
        vatNumber: '099123456', greekVatNumber: true, name: 'ΕΡΓΟΛΑΒΙΚΗ ΡΟΔΟΥ Α.Ε.' }],
    },
    totalCostWithVAT: 186000.00, totalCostWithoutVAT: 150000.00,
    objectDetailsList: [{ quantity: 1, costWithoutVAT: 150000, vat: '24',
      cpvs: [{ key: '45214200-2', value: 'Κατασκευαστικές εργασίες για σχολικά κτίρια' }] }],
    decisionRelatedAda: '6ΨΙΞΩ1Ρ-ΑΒΓ',
    noticeReferenceNumber: '24PROC014500000',
    cancelled: false, nextRefNo: null,
    paymentRefNo: ['25PAY015555555'],
  },
};

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const URL = pathToFileURL(path.join(root, 'index.html')).href;
const errs = [];
let fail = 0, total = 0;
const t = (name, ok, extra) => {
  total++;
  if (ok) console.log('✅ ' + name);
  else { console.log('❌ ' + name + (extra ? ' — ' + extra : '')); fail++; }
};

const ctx = await b.newContext();
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('dialog', d => d.accept());
await page.goto(URL); await page.waitForTimeout(600);
await page.evaluate(() => { loginEmail.value = 'a@dimos.gr'; loginPass.value = 'sw123456'; });
await page.evaluate(() => document.querySelector('#login form')
  .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })));
await page.waitForTimeout(1200);
t('συνδέθηκε', await page.evaluate(() => document.getElementById('login').innerHTML.length === 0));
await page.evaluate(() => welcomeChoose('new'));

/* ── 1. άντληση σε κενό έργο: όλα τα κενά πεδία συμπληρώνονται ── */
await setK(SYMV);
await page.evaluate(async () => {
  document.getElementById('kimq').value = '24SYMV014820133';
  await kimdisLookup();
});
await page.waitForTimeout(200);
const r1 = await page.evaluate(() => ({
  ergo: S.project.ergo, adam: S.project.adam, esidis: S.project.esidis,
  anadoxos: S.project.anadoxos, afm: S.project.afm,
  imSymvasis: S.project.imSymvasis, arPrwt: S.project.arPrwtSymvasis,
  xrima: S.project.xrimatodotisi,
  flash: (flashMsg && (flashMsg.t + ' ' + flashMsg.d)) || '',
  doc: (S.docs || []).at(-1) || {},
}));
t('ο τίτλος του έργου ήρθε από το ΚΗΜΔΗΣ', r1.ergo === SYMV.raw.title, r1.ergo);
t('ΑΔΑΜ και Α/Α ΕΣΗΔΗΣ συμπληρώθηκαν', r1.adam === '24SYMV014820133' && r1.esidis === '206123');
t('ανάδοχος και Α.Φ.Μ. από την επίσημη εγγραφή',
  r1.anadoxos === 'ΕΡΓΟΛΑΒΙΚΗ ΡΟΔΟΥ Α.Ε.' && r1.afm === '099123456');
t('η ημερομηνία γύρισε σε ελληνική γραφή', r1.imSymvasis === '11-03-2024', r1.imSymvasis);
t('αριθμός σύμβασης και χρηματοδότηση', r1.arPrwt === '2/16988' && r1.xrima === 'ΣΑΤΑ — 2023ΣΑΤΑ0001');
t('η αναφορά δείχνει το συνολικό ποσό με Φ.Π.Α.', r1.flash.includes('186.000,00'));
t('η αναφορά δείχνει «κάτω των ορίων»', r1.flash.includes('κάτω των ορίων'));
t('η πράξη καταχωρίστηκε στο μητρώο με τον ΑΔΑΜ της',
  r1.doc.adam === '24SYMV014820133' && r1.doc.auth === 'ΚΗΜΔΗΣ Open Data' && r1.doc.ada === '6ΨΙΞΩ1Ρ-ΑΒΓ',
  JSON.stringify(r1.doc));
t('ο mock είδε το σωστό ερώτημα',
  (await (await fetch(MOCK + '/__kimdis', { headers: { apikey: 'x' } })).json()).q === '24SYMV014820133');
t('προτείνεται άντληση της συνδεδεμένης διακήρυξης', r1.flash.includes('24PROC014500000'));

/* ── 2. συμπληρωμένο πεδίο δεν πειράζεται — η διαφορά αναφέρεται ── */
await page.evaluate(() => { S.project.anadoxos = 'ΑΛΛΟΣ ΕΡΓΟΛΑΒΟΣ Ε.Ε.'; });
await page.evaluate(async () => {
  go('p1');
  document.getElementById('kimq').value = '24SYMV014820133';
  await kimdisLookup();
});
await page.waitForTimeout(200);
const r2 = await page.evaluate(() => ({
  anadoxos: S.project.anadoxos,
  flash: (flashMsg && flashMsg.d) || '',
}));
t('το συμπληρωμένο πεδίο έμεινε ως έχει', r2.anadoxos === 'ΑΛΛΟΣ ΕΡΓΟΛΑΒΟΣ Ε.Ε.');
t('η διαφορά με το ΚΗΜΔΗΣ αναφέρεται ρητά',
  r2.flash.includes('παραμένει') && r2.flash.includes('ΕΡΓΟΛΑΒΙΚΗ ΡΟΔΟΥ Α.Ε.'));

/* ── 3. προειδοποιήσεις: άνω των ορίων + νεότερη τροποποιητική πράξη ── */
const WARN = JSON.parse(JSON.stringify(SYMV));
WARN.raw.legalContext = { key: '4', value: 'ν.4412/2016 - Βιβλίο Ι – άνω των ορίων' };
WARN.raw.nextRefNo = '25SYMV099999999'; WARN.raw.nextModified = true;
await setK(WARN);
await page.evaluate(async () => {
  document.getElementById('kimq').value = '24SYMV014820133';
  await kimdisLookup();
});
await page.waitForTimeout(200);
const r3 = await page.evaluate(() => (flashMsg && flashMsg.d) || '');
t('προειδοποίηση για έργο άνω των ορίων', r3.includes('ΑΝΩ των ορίων'));
t('προειδοποίηση για νεότερη τροποποιητική πράξη', r3.includes('25SYMV099999999'));

/* ── 4. η κάρτα Α του ελέγχου μετρά το ΚΗΜΔΗΣ στα επίσημα έγγραφα ── */
t('ο έλεγχος βλέπει τα έγγραφα ΑΔΑ/ΑΔΑΜ στην επίσημη βάση',
  await page.evaluate(() => { go('e2');
    return document.getElementById('content').innerHTML.includes('Έχουν ήδη καταχωριστεί'); }));
t('η κάρτα ελέγχου έχει και αναζήτηση ΚΗΜΔΗΣ',
  await page.evaluate(() => !!document.getElementById('kimq')));

/* ── 4β. αλυσιδωτή άντληση: διακήρυξη → μέση τεκμαρτή έκπτωση ──
   Σύμβαση 150.000 € χωρίς Φ.Π.Α. έναντι εκτιμώμενης αξίας 187.500 € → 20%. */
const PROC = { ok: true, kind: 'PROC', endpoint: 'notice', adam: '24PROC014500000',
  raw: { title: SYMV.raw.title, referenceNumber: '24PROC014500000', aaht: '206123',
         estTotalCost: 187500.00, signedDate: '2024-01-15' } };
await setK(PROC);
await page.evaluate(async () => { await kimdisLookup('24PROC014500000'); });
await page.waitForTimeout(200);
const r4 = await page.evaluate(() => (flashMsg && flashMsg.d) || '');
t('η διακήρυξη δίνει μέση τεκμαρτή έκπτωση 20%',
  r4.includes('τεκμαρτή έκπτωση') && r4.includes('20,00'), r4.slice(0, 220));

/* ── 5. αποτυχία: κατανοητό μήνυμα ── */
await fetch(MOCK + '/__kimdis', { method: 'POST', headers: { apikey: 'x' }, body: 'null' });
await page.evaluate(async () => {
  document.getElementById('kimq').value = '24SYMV000000000';
  await kimdisLookup();
});
await page.waitForTimeout(200);
const r5 = await page.evaluate(() => (flashMsg && (flashMsg.k + '|' + flashMsg.t + flashMsg.d)) || '');
t('η αποτυχία εξηγείται στον χρήστη', r5.startsWith('b|') && r5.includes('ΚΗΜΔΗΣ'), r5);

if (errs.length) { console.log('\nσφάλματα σελίδας:'); errs.forEach(e => console.log('  ' + e)); fail += errs.length; }
await b.close();
console.log(fail ? `\n${fail} αποτυχίες` : `\nΌλα πέρασαν (${total} έλεγχοι)`);
process.exit(fail ? 1 : 0);
