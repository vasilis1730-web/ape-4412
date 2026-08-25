/* ══════════════════════════════════════════════════════════════════
   Τοπικός mock του Supabase — GoTrue (/auth/v1) και PostgREST (/rest/v1).

   Επιτρέπει να ελεγχθεί ο πλήρης κύκλος σύνδεσης και συγχρονισμού χωρίς να
   χρειάζεται πραγματική βάση: δύο χρήστες, αισιόδοξο κλείδωμα, δικαίωμα
   εγγραφής μόνο στον κάτοχο.

   Εκκίνηση:  node tools/mock/supabase-mock.mjs
   Δοκιμή:    node tools/sync_test.mjs
   ══════════════════════════════════════════════════════════════════ */
import http from 'node:http';
/* Οι αρχικοί κωδικοί κρατιούνται χωριστά: η δοκιμή πρόσκλησης τους αλλάζει,
   και χωρίς επαναφορά η επόμενη δοκιμή θα αποτύγχανε χωρίς λόγο. */
const SEED = { 'a@dimos.gr': { pw:'sw123456', id:'user-a' }, 'b@dimos.gr': { pw:'sw123456', id:'user-b' } };
let USERS = structuredClone(SEED);
let rows = [];  // {id,owner_id,title,data,revision}
let seq = 0;
const LOG = [];
const PWSET = [];
/* Η απάντηση της υπηρεσίας ανάγνωσης ορίζεται από τη δοκιμή με POST /__ocr. */
let OCR = null;
/* Η απάντηση του ΚΗΜΔΗΣ ορίζεται από τη δοκιμή με POST /__kimdis. */
let KIMDIS = null;

const send = (res, code, obj) => {
  res.writeHead(code, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'});
  res.end(obj===undefined?'':JSON.stringify(obj));
};
const uid = () => 'p'+(++seq);

http.createServer((req,res)=>{
  let body='';
  req.on('data',c=>body+=c);
  req.on('end',()=>{
    const u = new URL(req.url,'http://x');
    LOG.push(`${req.method} ${u.pathname}${u.search}`);
    if(req.method==='OPTIONS') return send(res,204);
    if(!req.headers['apikey']) return send(res,401,{message:'No API key'});

    if(u.pathname==='/auth/v1/token'){
      const b=JSON.parse(body||'{}');
      if(u.searchParams.get('grant_type')==='password'){
        const rec=USERS[b.email];
        if(!rec||rec.pw!==b.password) return send(res,400,{error:'invalid_grant',error_description:'Invalid login credentials'});
        return send(res,200,{access_token:'tok-'+rec.id, refresh_token:'ref-'+rec.id,
          expires_in:3600, user:{id:rec.id, email:b.email}});
      }
      if(u.searchParams.get('grant_type')==='refresh_token'){
        const id=(b.refresh_token||'').replace('ref-','');
        return send(res,200,{access_token:'tok-'+id, refresh_token:'ref-'+id, expires_in:3600,
          user:{id, email:Object.keys(USERS).find(k=>USERS[k].id===id)}});
      }
    }
    if(u.pathname==='/auth/v1/logout') return send(res,204);

    // ορισμός/αλλαγή κωδικού από συνδεδεμένο χρήστη (πρόσκληση ή επαναφορά)
    if(u.pathname==='/auth/v1/user' && req.method==='PUT'){
      const tok=(req.headers.authorization||'').replace('Bearer ','');
      if(!tok) return send(res,401,{msg:'invalid claim: missing sub claim'});
      if(tok==='tok-expired') return send(res,401,{msg:'invalid JWT: token is expired'});
      const b=JSON.parse(body||'{}');
      const id=tok.replace('tok-','');
      const email=Object.keys(USERS).find(k=>USERS[k].id===id);
      if(b.password && email) USERS[email].pw=b.password;
      PWSET.push({id, pw:b.password});
      return send(res,200,{id, email});
    }

    if(u.pathname==='/functions/v1/ocr-pinaka'){
      if(!(req.headers.authorization||'').startsWith('Bearer ')) return send(res,401,{message:'JWT required'});
      if(!OCR) return send(res,500,{error:'Δεν έχει ρυθμιστεί το ANTHROPIC_API_KEY στο Edge Function.'});
      const b=JSON.parse(body||'{}');
      OCR.__seen={mime:b.mime, filename:b.filename, mode:b.mode, bytes:(b.data||'').length};
      return send(res, OCR.__status||200, OCR);
    }
    if(u.pathname==='/functions/v1/kimdis-lookup'){
      if(!(req.headers.authorization||'').startsWith('Bearer ')) return send(res,401,{message:'JWT required'});
      if(!KIMDIS) return send(res,404,{error:'Δεν βρέθηκε εγγραφή στο ΚΗΜΔΗΣ.'});
      const b=JSON.parse(body||'{}');
      KIMDIS.__seen={q:b.q||null, attachment:b.attachment||null};
      return send(res, KIMDIS.__status||200, KIMDIS);
    }

    const auth=(req.headers.authorization||'').replace('Bearer ','');
    const me=auth.replace('tok-','');

    if(u.pathname==='/rest/v1/projects'){
      if(!me) return send(res,401,{message:'JWT required'});
      if(req.method==='GET') return send(res,200,
        rows.map(r=>({...r, updated_at:new Date().toISOString()})));
      if(req.method==='POST'){
        const b=JSON.parse(body);
        if(b.owner_id!==me) return send(res,403,{message:'new row violates row-level security policy'});
        const row={id:uid(), owner_id:b.owner_id, title:b.title, data:b.data, revision:1,
                   updated_at:new Date().toISOString()};
        rows.push(row); return send(res,201,[row]);
      }
      if(req.method==='PATCH'){
        const b=JSON.parse(body);
        const idEq=(u.searchParams.get('id')||'').replace('eq.','');
        const revEq=Number((u.searchParams.get('revision')||'').replace('eq.',''));
        const hit=rows.filter(r=>r.id===idEq && r.revision===revEq && r.owner_id===me);
        hit.forEach(r=>{ if(b.title!==undefined)r.title=b.title;
                         if(b.data!==undefined){r.data=b.data; r.revision++;} });
        return send(res,200,hit.map(r=>({...r, updated_at:new Date().toISOString()})));
      }
    }
    if(u.pathname==='/__reset'){ rows=[]; seq=0; LOG.length=0; PWSET.length=0; OCR=null; KIMDIS=null; USERS=structuredClone(SEED); return send(res,200,{ok:true}); }
    if(u.pathname==='/__ocr'){
      if(req.method==='POST'){ OCR=JSON.parse(body||'null'); return send(res,200,{ok:true}); }
      return send(res,200,OCR&&OCR.__seen?OCR.__seen:null);
    }
    if(u.pathname==='/__kimdis'){
      if(req.method==='POST'){ KIMDIS=JSON.parse(body||'null'); return send(res,200,{ok:true}); }
      return send(res,200,KIMDIS&&KIMDIS.__seen?KIMDIS.__seen:null);
    }
    if(u.pathname==='/__pwset') return send(res,200,PWSET);
    if(u.pathname==='/__log') return send(res,200,LOG);
    if(u.pathname==='/__seed'){ const b=JSON.parse(body); rows.push(b); return send(res,200,{ok:true}); }
    send(res,404,{message:'not found'});
  });
}).listen(8899, ()=>console.log('mock ready on 8899'));
