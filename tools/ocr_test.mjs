/* ══════════════════════════════════════════════════════════════════
   Έλεγχος της ανάγνωσης σαρωμένων εγγράφων και φωτογραφιών.

   1. node tools/mock/supabase-mock.mjs        (σε άλλο τερματικό)
   2. node tools/ocr_test.mjs

   Ελέγχεται ο πελάτης, όχι το μοντέλο: ότι ζητείται συγκατάθεση, ότι η άρνηση
   δεν αφήνει μισοτελειωμένη κατάσταση, ότι κάθε γραμμή επαληθεύεται αριθμητικά
   πριν μπει στο έργο, και ότι οι αβέβαιες γραμμές μένουν σημασμένες.
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
const H = { headers: { apikey: 'x', 'Content-Type': 'application/json' } };
try { await fetch(MOCK + '/__reset', H); }
catch { console.error('Ο mock δεν απαντά. Ξεκινήστε τον με: node tools/mock/supabase-mock.mjs'); process.exit(1); }

const setOcr = body => fetch(MOCK + '/__ocr', { ...H, method: 'POST', body: JSON.stringify(body) });
const seen   = () => fetch(MOCK + '/__ocr', H).then(r => r.json());

/* Πίνακας που κλείνει: 2 × 10,00 = 20,00 και 3 × 5,00 = 15,00, άθροισμα 35,00 */
const CLEAN = {
  ok: true, einai_pinakas: true, eidos: 'proypologismos',
  ergo: 'ΑΝΑΠΛΑΣΗ ΠΛΑΤΕΙΑΣ ΑΓΙΟΥ ΓΕΩΡΓΙΟΥ', geoe: 18, apr: 15, fpa: 24, athroisma: 35,
  simeioseis: '',
  groups: [{ name: 'ΧΩΜΑΤΟΥΡΓΙΚΑ', items: [
    { at:'1.01', kodikos:'ΝΑΟΙΚ 20.02', kodAnath:'ΟΙΚ 2112', perigrafi:'Γενικές εκσκαφές',
      monada:'m3', posotita:2, timi:10, dapani:20, avevaio:false },
    { at:'1.02', kodikos:'ΝΑΟΙΚ 22.23', kodAnath:'ΟΙΚ 2252', perigrafi:'Καθαίρεση πλακοστρώσεων',
      monada:'m2', posotita:3, timi:5, dapani:15, avevaio:false }]}]
};
/* Ο ίδιος πίνακας με λάθος διαβασμένη ποσότητα στη 2η γραμμή και σημασμένη
   αβεβαιότητα: 8 × 5,00 = 40,00 ενώ το χαρτί γράφει 15,00. */
const DIRTY = JSON.parse(JSON.stringify(CLEAN));
DIRTY.groups[0].items[1].posotita = 8;
DIRTY.groups[0].items[1].avevaio  = true;

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const URL = pathToFileURL(path.join(root, 'index.html')).href;
const ok = (n, c, x='') => { if(!c) fails++; console.log(`${c?'✅':'❌'} ${n}${x?' — '+x:''}`); };
let fails = 0;
const errs = [];

const ctx = await b.newContext();
const p = await ctx.newPage();
p.on('pageerror', e => errs.push(e.message));

let asked = '', accept = true;
p.on('dialog', async d => { asked = d.message(); await (accept ? d.accept() : d.dismiss()); });

await p.goto(URL); await p.waitForTimeout(500);
await p.evaluate(() => { loginEmail.value='a@dimos.gr'; loginPass.value='sw123456'; });
await p.evaluate(() => document.querySelector('#login form')
  .dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})));
await p.waitForTimeout(1200);
ok('συνδέθηκε', await p.evaluate(() => document.getElementById('login').innerHTML.length===0));

/* Ένα ελάχιστο PNG 1×1 — το περιεχόμενο δεν έχει σημασία, ο mock απαντά σεναριακά. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const feed = (name, b64) => p.evaluate(async ([n, d]) => {
  const bin = atob(d), u = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i);
  const f = new File([u], n, { type: n.endsWith('.png') ? 'image/png' : 'application/pdf' });
  await loadBudgetFile({ target: { files: [f], value: '' } });
}, [name, b64]);

/* ── 1. άρνηση συγκατάθεσης ─────────────────────────────────────── */
await setOcr(CLEAN);
accept = false; asked = '';
await feed('proypologismos.png', PNG);
await p.waitForTimeout(400);
ok('ζητείται συγκατάθεση πριν φύγει το αρχείο', /Να σταλεί;/.test(asked), asked.split('\n')[0]);
ok('η άρνηση δεν στέλνει το αρχείο', (await seen()) === null);
ok('η άρνηση δεν αφήνει μήνυμα σφάλματος',
   await p.evaluate(() => flashMsg === null && S.groups.length === 0));

/* ── 2. αποδοχή, καθαρός πίνακας ────────────────────────────────── */
accept = true;
await feed('proypologismos.png', PNG);
await p.waitForTimeout(800);
const s1 = await seen();
ok('στάλθηκε ως εικόνα σε λειτουργία πίνακα',
   s1 && s1.mime === 'image/png' && s1.mode === 'pinakas', JSON.stringify(s1));
const r1 = await p.evaluate(() => ({
  groups: S.groups.length,
  items: S.groups.reduce((a,g)=>a+g.items.length,0),
  ergo: S.project.ergo, geoe: S.project.geoe, apr: S.project.apr, fpa: S.project.fpa,
  works: calc().budW, k: flashMsg && flashMsg.k, d: flashMsg && flashMsg.d,
}));
ok('μπήκαν οι γραμμές', r1.groups===1 && r1.items===2, `${r1.groups} ομάδες / ${r1.items} άρθρα`);
ok('μπήκαν τα μεγέθη κεφαλίδας',
   r1.ergo.startsWith('ΑΝΑΠΛΑΣΗ') && r1.geoe===18 && r1.apr===15 && r1.fpa===24);
ok('το άθροισμα βγαίνει 35,00 €', Math.abs(r1.works-35)<0.005, r1.works+' €');
ok('το άθροισμα δηλώνεται επαληθευμένο', /συμφωνεί με το «Άθροισμα»/.test(r1.d||''));
ok('δεν εμφανίζεται ως πράσινο, ούτε σε καθαρή ανάγνωση', r1.k==='w', 'k='+r1.k);

/* ── 3. λάθος αριθμητική → πρέπει να φανεί ──────────────────────── */
await setOcr(DIRTY);
await feed('proypologismos.png', PNG);
await p.waitForTimeout(800);
const r2 = await p.evaluate(() => ({ k: flashMsg && flashMsg.k, d: flashMsg && flashMsg.d,
  marked: S.groups[0].items.filter(i=>i.ocrAvevaio).length,
  html: document.getElementById('content').innerHTML }));
ok('η ασυμφωνία ποσότητα × τιμή αναφέρεται',
   /δεν δίνει τη δαπάνη του εγγράφου/.test(r2.d||''));
ok('αναφέρεται και η ασυμφωνία αθροίσματος', /Το άθροισμα δεν συμφωνεί/.test(r2.d||''));
ok('το μήνυμα σημαίνεται ως σφάλμα', r2.k==='b', 'k='+r2.k);
ok('η αβέβαιη γραμμή είναι σημασμένη στα δεδομένα', r2.marked===1, r2.marked+' γραμμές');
ok('η αβέβαιη γραμμή είναι σημασμένη στην οθόνη',
   /class="ocrq"/.test(r2.html) && /ocrmark/.test(r2.html));
ok('υπάρχει επεξήγηση πάνω από τον πίνακα',
   /id="ocrbanner"><div class="note w">/.test(r2.html)
   && /από εικόνα χωρίς βεβαιότητα/.test(r2.html));

/* ── 4. το άγγιγμα της γραμμής σβήνει τη σήμανση ────────────────── */
await p.evaluate(() => setItem(0,1,'perigrafi','Καθαίρεση πλακοστρώσεων πεζοδρομίου'));
await p.waitForTimeout(200);
const r3 = await p.evaluate(() => ({
  flag: S.groups[0].items[1].ocrAvevaio,
  row: (document.getElementById('bt-0-1')||{}).className,
  mark: !!document.querySelector('#bt-0-1 .ocrmark'),
  banner: (document.getElementById('ocrbanner')||{}).innerHTML }));
ok('η σήμανση φεύγει μόλις ελεγχθεί η γραμμή',
   r3.flag===false && !/ocrq/.test(r3.row||'') && !r3.mark, `class="${r3.row}"`);
ok('η επεξήγηση εξαφανίζεται όταν δεν μένει αβέβαιη γραμμή', r3.banner==='');

/* ── 5. διοικητικό έγγραφο → λειτουργία κειμένου ────────────────── */
await setOcr({ ok:true, mode:'keimeno', keimeno:
  'ΕΛΛΗΝΙΚΗ ΔΗΜΟΚΡΑΤΙΑ\nΔΗΜΟΣ ΡΟΔΟΥ\nΑρ. πρωτ. 45678/12-3-2024\nΑΔΑ: 6ΨΙ2ΩΡΞ-Λ7Θ\n'
  +'ΘΕΜΑ: Έγκριση 1ου Ανακεφαλαιωτικού Πίνακα Εργασιών\nΑπόφαση 214/2024\n' });
const r4 = await p.evaluate(async () => {
  const bin=atob('aGVsbG8='), u=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i);
  const f=new File([u],'apofasi.png',{type:'image/png'});
  docTarget='project.apofEgkrisis';
  await loadDocFile({target:{files:[f],value:''}});
  return { findings:(docFindings||[]).map(x=>x.type+'='+x.value) };
});
await p.waitForTimeout(300);
const s2 = await seen();
ok('το διοικητικό έγγραφο στέλνεται σε λειτουργία κειμένου',
   s2 && s2.mode === 'keimeno', JSON.stringify(s2));
ok('τα αναγνωριστικά εντοπίστηκαν στο μεταγραμμένο κείμενο',
   r4.findings.some(x=>/^ada=/.test(x)) && r4.findings.some(x=>/^prot=/.test(x)),
   r4.findings.join(' · '));

/* ── 6. χωρίς κλειδί στον διακομιστή → καθαρό μήνυμα ────────────── */
await fetch(MOCK + '/__ocr', { ...H, method:'POST', body:'null' });
await feed('proypologismos.png', PNG);
await p.waitForTimeout(600);
const r5 = await p.evaluate(() => ({ k:flashMsg&&flashMsg.k, t:flashMsg&&flashMsg.t, d:flashMsg&&flashMsg.d }));
ok('η αποτυχία του διακομιστή εξηγείται στον χρήστη',
   r5.k==='b' && /ANTHROPIC_API_KEY/.test(r5.d||''), r5.d||'');

console.log('\nσφάλματα σελίδας:', errs.length?errs:'κανένα');
await b.close();
fs.writeFileSync(cfg, saved);
process.exit(fails||errs.length ? 1 : 0);
