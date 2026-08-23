-- ════════════════════════════════════════════════════════════════════
-- ΑΠΕ 4412 — βασικό σχήμα
--
-- Μοντέλο πρόσβασης, όπως συμφωνήθηκε:
--   · Η εγγραφή γίνεται ΜΟΝΟ με πρόσκληση (ρυθμίζεται στο Auth, δείτε README).
--   · Κάθε συνδεδεμένος χρήστης ΔΙΑΒΑΖΕΙ όλα τα έργα.
--   · ΓΡΑΦΕΙ μόνο στα δικά του. Έτσι κανείς δεν σβήνει κατά λάθος ξένη δουλειά.
--   · Κάθε αποθήκευση αφήνει ίχνος: ποιος, πότε, τι.
--
-- Το έργο αποθηκεύεται ως ένα έγγραφο jsonb και όχι κανονικοποιημένο σε
-- πίνακες. Η εφαρμογή δουλεύει ήδη πάνω σε ένα ενιαίο αντικείμενο κατάστασης
-- και λειτουργεί offline· η κανονικοποίηση θα απαιτούσε επανεγγραφή της χωρίς
-- κανένα όφελος για το μέγεθος των δεδομένων (~200 KB ανά έργο).
-- ════════════════════════════════════════════════════════════════════

-- ── προφίλ χρηστών ──────────────────────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  eidikotita  text,                       -- π.χ. «Πολιτικός Μηχανικός Π.Ε.»
  ypiresia    text,                       -- Διεύθυνση / Τμήμα
  edra        text default 'Ρόδος',       -- έδρα που τυπώνεται στα έγγραφα
  created_at  timestamptz not null default now()
);

comment on column public.profiles.edra is
  'Η έδρα που τυπώνεται στις υπογραφές των εγγράφων. Ήταν καρφωτή «Ρόδος» σε 9 σημεία.';

-- Κάθε νέος χρήστης αποκτά αυτόματα προφίλ.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── έργα ────────────────────────────────────────────────────────────
create table if not exists public.projects (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users(id) on delete cascade,
  title           text not null default 'Νέο έργο',
  data            jsonb not null default '{}'::jsonb,
  schema_version  int  not null default 2,
  -- Αύξων αριθμός έκδοσης. Η ενημέρωση απαιτεί να ταιριάζει με αυτόν που
  -- κρατά ο client, ώστε δύο μηχανικοί στο ίδιο έργο να μη γράφουν
  -- ο ένας πάνω στον άλλο χωρίς να το καταλάβουν.
  revision        int  not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id)
);

create index if not exists projects_owner_idx   on public.projects(owner_id);
create index if not exists projects_updated_idx on public.projects(updated_at desc);

-- ── ιστορικό εκδόσεων ───────────────────────────────────────────────
-- Το αποτέλεσμα πηγαίνει σε Τεχνικό Συμβούλιο· πρέπει να μπορεί να
-- αποδειχθεί ποιος άλλαξε τι και πότε.
create table if not exists public.project_revisions (
  id          bigserial primary key,
  project_id  uuid not null references public.projects(id) on delete cascade,
  revision    int  not null,
  data        jsonb not null,
  changed_by  uuid references auth.users(id),
  changed_at  timestamptz not null default now(),
  note        text
);

create index if not exists revisions_project_idx
  on public.project_revisions(project_id, revision desc);

-- Κάθε αλλαγή αυξάνει την έκδοση και κρατά αντίγραφο της ΠΡΟΗΓΟΥΜΕΝΗΣ
-- κατάστασης, ώστε να υπάρχει πάντα σημείο επιστροφής.
create or replace function public.bump_revision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.data is distinct from old.data then
    insert into public.project_revisions (project_id, revision, data, changed_by)
    values (old.id, old.revision, old.data, auth.uid());
    new.revision   := old.revision + 1;
    new.updated_at := now();
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists on_project_update on public.projects;
create trigger on_project_update
  before update on public.projects
  for each row execute function public.bump_revision();

-- ════════════════════════════════════════════════════════════════════
-- ΑΣΦΑΛΕΙΑ ΓΡΑΜΜΗΣ
-- Ενεργοποιείται από την πρώτη μέρα, όχι ως τελευταίο βήμα.
-- ════════════════════════════════════════════════════════════════════
alter table public.profiles          enable row level security;
alter table public.projects          enable row level security;
alter table public.project_revisions enable row level security;

-- προφίλ: όλοι βλέπουν ποιος είναι ποιος· ο καθένας αλλάζει μόνο το δικό του
drop policy if exists profiles_read   on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_read   on public.profiles for select
  to authenticated using (true);
create policy profiles_update on public.profiles for update
  to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- έργα: ανάγνωση για όλους τους συνδεδεμένους, εγγραφή μόνο στον κάτοχο
drop policy if exists projects_read   on public.projects;
drop policy if exists projects_insert on public.projects;
drop policy if exists projects_update on public.projects;
drop policy if exists projects_delete on public.projects;
create policy projects_read   on public.projects for select
  to authenticated using (true);
create policy projects_insert on public.projects for insert
  to authenticated with check (owner_id = (select auth.uid()));
create policy projects_update on public.projects for update
  to authenticated using (owner_id = (select auth.uid()))
                    with check (owner_id = (select auth.uid()));
create policy projects_delete on public.projects for delete
  to authenticated using (owner_id = (select auth.uid()));

-- ιστορικό: ορατό σε όλους, γράφεται μόνο από το trigger (security definer).
-- Καμία πολιτική INSERT/UPDATE/DELETE — άρα κανείς δεν μπορεί να το πειράξει.
drop policy if exists revisions_read on public.project_revisions;
create policy revisions_read on public.project_revisions for select
  to authenticated using (true);
