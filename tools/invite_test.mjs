/* ══════════════════════════════════════════════════════════════════
   Έλεγχος της ροής πρόσκλησης και ορισμού κωδικού.

   1. node tools/mock/supabase-mock.mjs
   2. node tools/invite_test.mjs

   Ο σύνδεσμος πρόσκλησης του Supabase φτάνει με τη συνεδρία στο fragment:
     .../index.html#access_token=…&type=invite
   ══════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const cfg  = path.join(root, 'config.js');
const saved = fs.readFileSync(cfg, 'utf8');
fs.writeFileSync(cfg, "window.APE_SUPABASE_URL='http://127.0.0.1:8899';\nwindow.APE_SUPABASE_ANON='mock';\n");
process.on('exit', () => fs.writeFileSync(cfg, saved));

const MOCK='http://127.0.0.1:8899';
try { await fetch(MOCK+'/__reset',{headers:{apikey:'x'}}); }
catch { console.error('Ο mock δεν απαντά: node tools/mock/supabase-mock.mjs'); process.exit(1); }

const b = await chromium.launch();
const BASE = pathToFileURL(path.join(root,'index.html')).href;
const ok=(n,c,x='')=>{ console.log(`${c?'✅':'❌'} ${n}${x?' — '+x:''}`); if(!c) fails++; };
let fails=0; const errs=[];

// ── σύνδεσμος πρόσκλησης ──
const c1 = await b.newContext(); const p1 = await c1.newPage();
p1.on('pageerror',e=>errs.push(e.message));
await p1.goto(BASE + '#access_token=tok-user-a&refresh_token=ref-user-a&expires_in=3600&type=invite');
await p1.waitForTimeout(700);

ok('εμφανίζεται οθόνη ορισμού κωδικού', await p1.evaluate(()=>!!document.getElementById('pw1')));
ok('το token φεύγει από τη διεύθυνση', !(await p1.evaluate(()=>location.hash)),
   'hash="'+await p1.evaluate(()=>location.hash)+'"');

// κωδικοί που δεν ταιριάζουν
await p1.evaluate(()=>{pw1.value='mystiko12';pw2.value='allo12345';});
await p1.evaluate(()=>document.querySelector('#login form').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})));
await p1.waitForTimeout(400);
ok('πιάνει τους κωδικούς που δεν ταιριάζουν',
   /δεν ταιριάζουν/.test(await p1.evaluate(()=>(document.querySelector('#login .note')||{}).textContent||'')));

// σωστός ορισμός
await p1.evaluate(()=>{pw1.value='mystiko12';pw2.value='mystiko12';});
await p1.evaluate(()=>document.querySelector('#login form').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})));
await p1.waitForTimeout(1200);
ok('μπαίνει στην εφαρμογή', await p1.evaluate(()=>document.getElementById('login').innerHTML.length===0));
const pwset = await (await fetch(MOCK+'/__pwset',{headers:{apikey:'x'}})).json();
ok('ο κωδικός στάλθηκε στη βάση', pwset.length===1 && pwset[0].pw==='mystiko12');

// ── ο νέος κωδικός δουλεύει σε κανονική σύνδεση ──
const c2 = await b.newContext(); const p2 = await c2.newPage();
p2.on('pageerror',e=>errs.push(e.message));
await p2.goto(BASE); await p2.waitForTimeout(700);
await p2.evaluate(()=>{loginEmail.value='a@dimos.gr';loginPass.value='mystiko12';});
await p2.evaluate(()=>document.querySelector('#login form').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})));
await p2.waitForTimeout(1200);
ok('σύνδεση με τον νέο κωδικό', await p2.evaluate(()=>document.getElementById('login').innerHTML.length===0));

// ── ληγμένος σύνδεσμος ──
const c3 = await b.newContext(); const p3 = await c3.newPage();
await p3.goto(BASE + '#error=access_denied&error_description=Email+link+is+invalid+or+has+expired');
await p3.waitForTimeout(700);
const m3 = await p3.evaluate(()=>(document.querySelector('#login .note')||{}).textContent||'');
ok('ληγμένος σύνδεσμος → κατανοητό μήνυμα', /δεν ισχύει πια/.test(m3) && !!(await p3.evaluate(()=>document.getElementById('loginEmail'))), m3.slice(0,60));

// ── αλλαγή κωδικού από μέσα ──
await p2.evaluate(()=>changePassword()); await p2.waitForTimeout(300);
ok('υπάρχει αλλαγή κωδικού για συνδεδεμένο', await p2.evaluate(()=>!!document.getElementById('pw1')));

console.log('\nσφάλματα:', errs.length?errs:'κανένα');
await b.close();
fs.writeFileSync(cfg, saved);
process.exit(fails+errs.length ? 1 : 0);
