-- ════════════════════════════════════════════════════════════════════
-- Δοκιμή των πολιτικών ασφαλείας.
--
-- Εκτελείται στο SQL Editor του Supabase. Δημιουργεί δύο πλασματικούς
-- χρήστες, δοκιμάζει κάθε πολιτική, και τα σβήνει όλα στο τέλος.
-- Κάθε γραμμή του αποτελέσματος πρέπει να λέει OK.
-- ════════════════════════════════════════════════════════════════════
create temporary table rls_results (ord serial, step text, got text, want text, ok boolean) on commit drop;
grant all on rls_results to authenticated, anon;
grant usage, select on all sequences in schema pg_temp to authenticated, anon;

do $$
declare
  ua uuid := '11111111-1111-1111-1111-111111111111';
  ub uuid := '22222222-2222-2222-2222-222222222222';
  pid uuid; n int;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (ua,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
          'a@test.local','x',now(),now(),now()),
         (ub,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
          'b@test.local','x',now(),now(),now())
  on conflict (id) do nothing;

  set local role authenticated;

  -- ο Α δημιουργεί δικό του έργο
  perform set_config('request.jwt.claims', json_build_object('sub',ua,'role','authenticated')::text, true);
  insert into public.projects (owner_id, title, data)
  values (ua,'Έργο του Α','{"project":{"ergo":"ΔΟΚΙΜΗ"}}'::jsonb) returning id into pid;
  insert into rls_results(step,got,want,ok) values ('Α δημιουργεί δικό του έργο','επέτρεψε','επέτρεψε',true);

  -- ο Β βλέπει, αλλά δεν γράφει
  perform set_config('request.jwt.claims', json_build_object('sub',ub,'role','authenticated')::text, true);
  select count(*) into n from public.projects where id=pid;
  insert into rls_results(step,got,want,ok) values ('Β διαβάζει το έργο του Α', n||' γραμμές','1 γραμμή', n=1);

  update public.projects set title='ΠΑΡΑΒΙΑΣΗ' where id=pid;
  get diagnostics n = row_count;
  insert into rls_results(step,got,want,ok) values ('Β αλλάζει το έργο του Α', n||' γραμμές','0 γραμμές', n=0);

  delete from public.projects where id=pid;
  get diagnostics n = row_count;
  insert into rls_results(step,got,want,ok) values ('Β διαγράφει το έργο του Α', n||' γραμμές','0 γραμμές', n=0);

  begin
    insert into public.projects (owner_id,title) values (ua,'Πλαστό');
    insert into rls_results(step,got,want,ok) values ('Β δημιουργεί έργο ως Α','πέρασε','απορρίφθηκε',false);
  exception when others then
    insert into rls_results(step,got,want,ok) values ('Β δημιουργεί έργο ως Α','απορρίφθηκε','απορρίφθηκε',true);
  end;

  -- ιστορικό και αισιόδοξο κλείδωμα
  perform set_config('request.jwt.claims', json_build_object('sub',ua,'role','authenticated')::text, true);
  update public.projects set data='{"project":{"ergo":"ΑΛΛΑΓΜΕΝΟ"}}'::jsonb where id=pid;
  select revision into n from public.projects where id=pid;
  insert into rls_results(step,got,want,ok) values ('η έκδοση προχωρά μετά την αλλαγή','έκδοση '||n,'έκδοση 2', n=2);
  select count(*) into n from public.project_revisions where project_id=pid;
  insert into rls_results(step,got,want,ok) values ('κρατήθηκε η προηγούμενη κατάσταση', n||' εγγραφή','1 εγγραφή', n=1);

  update public.projects set data='{"x":1}'::jsonb where id=pid and revision=1;
  get diagnostics n = row_count;
  insert into rls_results(step,got,want,ok) values ('ενημέρωση με ξεπερασμένη έκδοση', n||' γραμμές','0 γραμμές', n=0);

  begin
    delete from public.project_revisions where project_id=pid;
    get diagnostics n = row_count;
    insert into rls_results(step,got,want,ok) values ('διαγραφή ιστορικού', n||' γραμμές','0 γραμμές', n=0);
  exception when others then
    insert into rls_results(step,got,want,ok) values ('διαγραφή ιστορικού','απορρίφθηκε','απόρριψη',true);
  end;

  -- ανώνυμος επισκέπτης
  perform set_config('request.jwt.claims', null, true);
  set local role anon;
  begin
    select count(*) into n from public.projects;
    insert into rls_results(step,got,want,ok) values ('ανώνυμος βλέπει έργα', n||' γραμμές','0 γραμμές', n=0);
  exception when others then
    insert into rls_results(step,got,want,ok) values ('ανώνυμος βλέπει έργα','απορρίφθηκε','απόρριψη',true);
  end;

  reset role;
  delete from public.projects where id=pid;
  delete from auth.users where id in (ua,ub);
end $$;

select case when ok then 'OK' else 'FAIL' end as krisi, step, got, want
from rls_results order by ord;
