-- ════════════════════════════════════════════════════════════════════
-- ΑΠΕ 4412 — αποθήκευση εγγράφων
--
-- Τα PDF του φακέλου ανεβαίνουν αντί να διαβάζονται και να πετιούνται.
-- Έτσι το μητρώο εγγράφων αποκτά αποδεικτική αξία, και όταν βελτιώνεται ο
-- αναγνώστης μπορούν να ξαναδιαβαστούν όσα έχουν ήδη ανέβει.
-- ════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('erga-docs', 'erga-docs', false, 52428800,
        array['application/pdf','text/plain','text/html',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv'])
on conflict (id) do update
  set file_size_limit  = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Διαδρομή αρχείου: <project_id>/<όνομα αρχείου>
-- Έτσι το πρώτο τμήμα της διαδρομής δηλώνει σε ποιο έργο ανήκει.
drop policy if exists docs_read   on storage.objects;
drop policy if exists docs_insert on storage.objects;
drop policy if exists docs_delete on storage.objects;

-- ανάγνωση: κάθε συνδεδεμένος χρήστης, όπως και τα ίδια τα έργα
create policy docs_read on storage.objects for select
  to authenticated
  using (bucket_id = 'erga-docs');

-- ανέβασμα και διαγραφή: μόνο ο κάτοχος του έργου στο οποίο ανήκει το αρχείο
create policy docs_insert on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'erga-docs'
    and exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(name))[1]
        and p.owner_id = (select auth.uid())
    )
  );

create policy docs_delete on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'erga-docs'
    and exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(name))[1]
        and p.owner_id = (select auth.uid())
    )
  );

-- ── μητρώο ανεβασμένων εγγράφων ─────────────────────────────────────
create table if not exists public.project_documents (
  id          bigserial primary key,
  project_id  uuid not null references public.projects(id) on delete cascade,
  path        text not null unique,      -- διαδρομή στο bucket
  filename    text not null,
  kind        text,                      -- είδος που αναγνώρισε η εφαρμογή
  ada         text,
  adam        text,
  prot        text,
  doc_date    text,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now()
);

create index if not exists project_documents_project_idx
  on public.project_documents(project_id);

alter table public.project_documents enable row level security;

drop policy if exists pdocs_read   on public.project_documents;
drop policy if exists pdocs_write  on public.project_documents;
drop policy if exists pdocs_delete on public.project_documents;

create policy pdocs_read on public.project_documents for select
  to authenticated using (true);

create policy pdocs_write on public.project_documents for insert
  to authenticated with check (
    exists (select 1 from public.projects p
            where p.id = project_id and p.owner_id = (select auth.uid())));

create policy pdocs_delete on public.project_documents for delete
  to authenticated using (
    exists (select 1 from public.projects p
            where p.id = project_id and p.owner_id = (select auth.uid())));
