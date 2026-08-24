/* ══════════════════════════════════════════════════════════════════
   Έλεγχος σύνδεσης και συγχρονισμού απέναντι στον τοπικό mock.

   1. node tools/mock/supabase-mock.mjs        (σε άλλο τερματικό)
   2. node tools/sync_test.mjs

   Το config.js αντικαθίσταται προσωρινά ώστε να δείχνει στον mock και
   επαναφέρεται στο τέλος.
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

/* Καθαρή αφετηρία: ο mock κρατά κατάσταση μεταξύ εκτελέσεων. */
const MOCK = 'http://127.0.0.1:8899';
try {
  await fetch(MOCK + '/__reset', { headers: { apikey: 'x' } });
} catch {
  console.error('Ο mock δεν απαντά. Ξεκινήστε τον με: node tools/mock/supabase-mock.mjs');
  process.exit(1);
}

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const URL = pathToFileURL(path.join(root, 'index.html')).href;
const ok=(n,c,x='')=>console.log(`${c?'✅':'❌'} ${n}${x?' — '+x:''}`);
const login=async(p,email)=>{
  await p.goto(URL); await p.waitForTimeout(600);
  await p.evaluate(e=>{loginEmail.value=e;loginPass.value='sw123456';},email);
  await p.evaluate(()=>document.querySelector('#login form').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})));
  await p.waitForTimeout(1300);
};
const errs=[];

// Α συνδέεται χωρίς να έχει κάνει τίποτα
const cA=await b.newContext(); const A=await cA.newPage();
A.on('pageerror',e=>errs.push('A: '+e.message));
await login(A,'a@dimos.gr');
ok('συνδέθηκε', await A.evaluate(()=>document.getElementById('login').innerHTML.length===0));

let log = await (await fetch(`${MOCK}/__log`,{headers:{apikey:'x'}})).json();
const posts0 = log.filter(l=>l.startsWith('POST /rest')).length;
ok('κενό έργο ΔΕΝ ανεβαίνει', posts0===0, `POST /rest = ${posts0}`);

// τώρα κάνει πραγματική δουλειά
await A.evaluate(()=>{ loadDemo(); S.project.ergo='ΑΝΑΠΛΑΣΗ ΠΛΑΤΕΙΑΣ'; libSave(); markDirty(); });
const r1 = await A.evaluate(async()=>{const r=await syncAll();
  const e=LIB.find(x=>x.id===curId); return {pushed:r.pushed, id:e.remoteId, rev:e.remoteRev};});
ok('ανέβηκε μετά τη δουλειά', !!r1.id && r1.rev===1, `id=${r1.id} rev=${r1.rev}`);

log = await (await fetch(`${MOCK}/__log`,{headers:{apikey:'x'}})).json();
ok('χωρίς περιττό PATCH μετά τη δημιουργία',
   log.filter(l=>l.startsWith('PATCH')).length===0,
   `POST=${log.filter(l=>l.startsWith('POST /rest')).length} PATCH=${log.filter(l=>l.startsWith('PATCH')).length}`);

// δεύτερη αλλαγή → PATCH με σωστή έκδοση
await A.evaluate(()=>{ S.project.anadoxos='ΑΝΑΔΟΧΟΣ ΑΕ'; libSave(); markDirty(); });
const r2 = await A.evaluate(async()=>{await syncAll(); const e=LIB.find(x=>x.id===curId);
  return {rev:e.remoteRev, dirty:e.dirty};});
ok('η έκδοση προχώρησε σε 2', r2.rev===2 && r2.dirty===false, `rev=${r2.rev}`);

// Β βλέπει, δεν διπλασιάζει
const cB=await b.newContext(); const B=await cB.newPage();
B.on('pageerror',e=>errs.push('B: '+e.message));
await login(B,'b@dimos.gr');
const r3 = await B.evaluate(()=>({n:LIB.length, names:LIB.map(x=>x.name),
  found:LIB.some(x=>x.name==='ΑΝΑΠΛΑΣΗ ΠΛΑΤΕΙΑΣ')}));
ok('ο Β βλέπει το έργο του Α', r3.found, r3.names.join(' · '));
// δεύτερος συγχρονισμός δεν πρέπει να ξαναδημιουργεί
const before = (await (await fetch(`${MOCK}/__log`,{headers:{apikey:'x'}})).json()).filter(l=>l.startsWith('POST /rest')).length;
await B.evaluate(async()=>{await syncAll();});
const after = (await (await fetch(`${MOCK}/__log`,{headers:{apikey:'x'}})).json()).filter(l=>l.startsWith('POST /rest')).length;
ok('ο Β δεν διπλασιάζει τα έργα', before===after, `POST πριν=${before} μετά=${after}`);
// ο Β δεν προσπαθεί να γράψει σε ξένο έργο
const r4 = await B.evaluate(async()=>{
  const e=LIB.find(x=>x.name==='ΑΝΑΠΛΑΣΗ ΠΛΑΤΕΙΑΣ'); e.dirty=true;
  const r=await syncAll(); return {pushed:r.pushed, conflicts:r.conflicts.length};});
ok('ο Β δεν γράφει σε ξένο έργο', r4.pushed===0 && r4.conflicts===0);

console.log('\nσφάλματα:', errs.length?errs:'κανένα');
await b.close();
fs.writeFileSync(cfg, saved);
process.exit(errs.length ? 1 : 0);
