-- Enable the vector extension for embeddings
create extension if not exists "vector" with schema public;

-- 1. Users Profile (Extending Supabase Auth native configuration)
create table if not exists public.profiles (
    id uuid references auth.users on delete cascade not null primary key,
    email text unique not null,
    first_name text,
    last_name text,
    role text default 'user' check (role in ('admin', 'user')),
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Documents (Storing reference text and vector embeddings)
create table if not exists public.documents (
    id uuid default gen_random_uuid() primary key,
    title text not null,
    content text not null,
    -- Assume usage of Gemini gemini-embedding-001 with outputDimensionality=1536
    embedding vector(1536),
    metadata jsonb default '{}'::jsonb,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- HNSW Vector Index for fast semantic search
create index on public.documents using hnsw (embedding vector_cosine_ops);

-- 3. Document Chunks (Chunk-level retrieval for questionnaire answering)
create table if not exists public.document_chunks (
    id uuid default gen_random_uuid() primary key,
    document_id uuid references public.documents(id) on delete cascade not null,
    chunk_index integer not null,
    content text not null,
    embedding vector(1536),
    metadata jsonb default '{}'::jsonb,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists document_chunks_document_id_idx
on public.document_chunks(document_id);

create index if not exists document_chunks_embedding_hnsw_idx
on public.document_chunks using hnsw (embedding vector_cosine_ops);

-- Match function for semantic chunk retrieval from pgvector.
create or replace function public.match_document_chunks(
    query_embedding vector(1536),
    match_count integer default 3,
    requesting_user uuid default null
)
returns table (
    chunk_id uuid,
    document_id uuid,
    document_title text,
    chunk_text text,
    similarity float
)
language sql
stable
as $$
    select
        dc.id as chunk_id,
        dc.document_id,
        d.title as document_title,
        dc.content as chunk_text,
        1 - (dc.embedding <=> query_embedding) as similarity
    from public.document_chunks dc
    join public.documents d on d.id = dc.document_id
    where dc.embedding is not null
      and (
        requesting_user is null
        or (dc.metadata ->> 'uploaded_by') = requesting_user::text
      )
    order by dc.embedding <=> query_embedding
    limit greatest(match_count, 1);
$$;

-- Compatibility wrapper for clients/databases expecting args as
-- (match_count, query_embedding, requesting_user).
create or replace function public.match_document_chunks(
    p_match_count integer,
    p_query_embedding vector(1536),
    p_requesting_user uuid default null
)
returns table (
    chunk_id uuid,
    document_id uuid,
    document_title text,
    chunk_text text,
    similarity float
)
language sql
stable
as $$
    select *
    from public.match_document_chunks(p_query_embedding, p_match_count, p_requesting_user);
$$;

-- 4. Questionnaires (Header table for tracking uploaded questionnaires)
create table if not exists public.questionnaires (
    id uuid default gen_random_uuid() primary key,
    title text not null,
    status text default 'draft' check (status in ('draft', 'processing', 'completed')),
    source_format text,
    source_payload jsonb default '{}'::jsonb,
    created_by uuid references public.profiles(id) on delete set null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 5. Questionnaire Items (Individual questions, citations, generated answers)
create table if not exists public.questionnaire_items (
    id uuid default gen_random_uuid() primary key,
    questionnaire_id uuid references public.questionnaires(id) on delete cascade not null,
    question_order integer,
    question_text text not null,
    generated_answer text,
    citations text[] default '{}',
    evidence_snippets text[] default '{}',
    confidence_score float,
    -- Tracks if LLM determines question is unanswerable from context
    is_answerable boolean default true,
    -- Store UUID array referencing the chunks/documents cited by the LLM
    cited_document_ids uuid[] default '{}',
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 6. Questionnaire Runs (History of full/partial generation executions)
create table if not exists public.questionnaire_runs (
    id uuid default gen_random_uuid() primary key,
    questionnaire_id uuid references public.questionnaires(id) on delete cascade not null,
    run_type text default 'full' check (run_type in ('full', 'partial')),
    status text default 'processing' check (status in ('processing', 'completed', 'failed')),
    requested_item_ids uuid[] default '{}',
    total_questions integer default 0,
    processed_count integer default 0,
    answered_count integer default 0,
    not_found_count integer default 0,
    error_message text,
    metadata jsonb default '{}'::jsonb,
    created_by uuid references public.profiles(id) on delete set null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    completed_at timestamp with time zone
);

create index if not exists questionnaire_runs_questionnaire_id_idx
on public.questionnaire_runs(questionnaire_id, created_at desc);

create index if not exists questionnaire_runs_created_by_idx
on public.questionnaire_runs(created_by, created_at desc);

-- 7. Questionnaire Item Runs (Snapshot of generated outputs per run and question)
create table if not exists public.questionnaire_item_runs (
    id uuid default gen_random_uuid() primary key,
    run_id uuid references public.questionnaire_runs(id) on delete cascade not null,
    questionnaire_item_id uuid references public.questionnaire_items(id) on delete cascade not null,
    question_order integer,
    question_text text not null,
    generated_answer text,
    citations text[] default '{}',
    evidence_snippets text[] default '{}',
    confidence_score float,
    is_answerable boolean default true,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists questionnaire_item_runs_run_id_idx
on public.questionnaire_item_runs(run_id, question_order, created_at);

create index if not exists questionnaire_item_runs_item_id_idx
on public.questionnaire_item_runs(questionnaire_item_id);

alter table public.questionnaire_items
add column if not exists citations text[] default '{}';

alter table public.questionnaire_items
add column if not exists evidence_snippets text[] default '{}';

alter table public.questionnaire_items
add column if not exists cited_document_ids uuid[] default '{}';

alter table public.questionnaire_items
add column if not exists confidence_score float8;

alter table public.questionnaire_items
add column if not exists is_answerable boolean default true;

alter table public.questionnaires
add column if not exists source_format text;

alter table public.questionnaires
add column if not exists source_payload jsonb default '{}'::jsonb;

alter table public.questionnaire_items
add column if not exists question_order integer;

create index if not exists questionnaire_items_questionnaire_id_question_order_idx
on public.questionnaire_items(questionnaire_id, question_order);

alter table public.questionnaire_runs
add column if not exists run_type text default 'full';

alter table public.questionnaire_runs
add column if not exists status text default 'processing';

alter table public.questionnaire_runs
add column if not exists requested_item_ids uuid[] default '{}';

alter table public.questionnaire_runs
add column if not exists total_questions integer default 0;

alter table public.questionnaire_runs
add column if not exists processed_count integer default 0;

alter table public.questionnaire_runs
add column if not exists answered_count integer default 0;

alter table public.questionnaire_runs
add column if not exists not_found_count integer default 0;

alter table public.questionnaire_runs
add column if not exists error_message text;

alter table public.questionnaire_runs
add column if not exists metadata jsonb default '{}'::jsonb;

alter table public.questionnaire_runs
add column if not exists created_by uuid references public.profiles(id) on delete set null;

alter table public.questionnaire_runs
add column if not exists completed_at timestamp with time zone;

alter table public.questionnaire_item_runs
add column if not exists question_order integer;

alter table public.questionnaire_item_runs
add column if not exists citations text[] default '{}';

alter table public.questionnaire_item_runs
add column if not exists evidence_snippets text[] default '{}';

alter table public.questionnaire_item_runs
add column if not exists confidence_score float8;

alter table public.questionnaire_item_runs
add column if not exists is_answerable boolean default true;

-- Enable basic RLS (Row Level Security) ensuring standard security posture 
alter table public.profiles enable row level security;
alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;
alter table public.questionnaires enable row level security;
alter table public.questionnaire_items enable row level security;
alter table public.questionnaire_runs enable row level security;
alter table public.questionnaire_item_runs enable row level security;

-- 8. RLS Policies
-- Profiles: each user can manage only their own profile row.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (id = auth.uid());

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Documents: ownership is recorded in metadata.uploaded_by as user UUID string.
drop policy if exists "documents_select_own" on public.documents;
create policy "documents_select_own"
on public.documents
for select
to authenticated
using ((metadata ->> 'uploaded_by') = auth.uid()::text);

drop policy if exists "documents_insert_own" on public.documents;
create policy "documents_insert_own"
on public.documents
for insert
to authenticated
with check ((metadata ->> 'uploaded_by') = auth.uid()::text);

drop policy if exists "documents_update_own" on public.documents;
create policy "documents_update_own"
on public.documents
for update
to authenticated
using ((metadata ->> 'uploaded_by') = auth.uid()::text)
with check ((metadata ->> 'uploaded_by') = auth.uid()::text);

drop policy if exists "documents_delete_own" on public.documents;
create policy "documents_delete_own"
on public.documents
for delete
to authenticated
using ((metadata ->> 'uploaded_by') = auth.uid()::text);

-- Document chunks: ownership recorded via metadata.uploaded_by.
drop policy if exists "document_chunks_select_own" on public.document_chunks;
create policy "document_chunks_select_own"
on public.document_chunks
for select
to authenticated
using ((metadata ->> 'uploaded_by') = auth.uid()::text);

drop policy if exists "document_chunks_insert_own" on public.document_chunks;
create policy "document_chunks_insert_own"
on public.document_chunks
for insert
to authenticated
with check ((metadata ->> 'uploaded_by') = auth.uid()::text);

drop policy if exists "document_chunks_update_own" on public.document_chunks;
create policy "document_chunks_update_own"
on public.document_chunks
for update
to authenticated
using ((metadata ->> 'uploaded_by') = auth.uid()::text)
with check ((metadata ->> 'uploaded_by') = auth.uid()::text);

drop policy if exists "document_chunks_delete_own" on public.document_chunks;
create policy "document_chunks_delete_own"
on public.document_chunks
for delete
to authenticated
using ((metadata ->> 'uploaded_by') = auth.uid()::text);

-- Questionnaires: user can only access questionnaires they created.
drop policy if exists "questionnaires_select_own" on public.questionnaires;
create policy "questionnaires_select_own"
on public.questionnaires
for select
to authenticated
using (created_by = auth.uid());

drop policy if exists "questionnaires_insert_own" on public.questionnaires;
create policy "questionnaires_insert_own"
on public.questionnaires
for insert
to authenticated
with check (created_by = auth.uid());

drop policy if exists "questionnaires_update_own" on public.questionnaires;
create policy "questionnaires_update_own"
on public.questionnaires
for update
to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());

drop policy if exists "questionnaires_delete_own" on public.questionnaires;
create policy "questionnaires_delete_own"
on public.questionnaires
for delete
to authenticated
using (created_by = auth.uid());

-- Questionnaire items: access via questionnaire ownership.
drop policy if exists "items_select_via_questionnaire_owner" on public.questionnaire_items;
create policy "items_select_via_questionnaire_owner"
on public.questionnaire_items
for select
to authenticated
using (
  exists (
    select 1
    from public.questionnaires q
    where q.id = questionnaire_id
      and q.created_by = auth.uid()
  )
);

drop policy if exists "items_insert_via_questionnaire_owner" on public.questionnaire_items;
create policy "items_insert_via_questionnaire_owner"
on public.questionnaire_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.questionnaires q
    where q.id = questionnaire_id
      and q.created_by = auth.uid()
  )
);

drop policy if exists "items_update_via_questionnaire_owner" on public.questionnaire_items;
create policy "items_update_via_questionnaire_owner"
on public.questionnaire_items
for update
to authenticated
using (
  exists (
    select 1
    from public.questionnaires q
    where q.id = questionnaire_id
      and q.created_by = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.questionnaires q
    where q.id = questionnaire_id
      and q.created_by = auth.uid()
  )
);

drop policy if exists "items_delete_via_questionnaire_owner" on public.questionnaire_items;
create policy "items_delete_via_questionnaire_owner"
on public.questionnaire_items
for delete
to authenticated
using (
  exists (
    select 1
    from public.questionnaires q
    where q.id = questionnaire_id
      and q.created_by = auth.uid()
  )
);

-- Questionnaire runs: user can only access runs they created.
drop policy if exists "questionnaire_runs_select_own" on public.questionnaire_runs;
create policy "questionnaire_runs_select_own"
on public.questionnaire_runs
for select
to authenticated
using (created_by = auth.uid());

drop policy if exists "questionnaire_runs_insert_own" on public.questionnaire_runs;
create policy "questionnaire_runs_insert_own"
on public.questionnaire_runs
for insert
to authenticated
with check (created_by = auth.uid());

drop policy if exists "questionnaire_runs_update_own" on public.questionnaire_runs;
create policy "questionnaire_runs_update_own"
on public.questionnaire_runs
for update
to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());

drop policy if exists "questionnaire_runs_delete_own" on public.questionnaire_runs;
create policy "questionnaire_runs_delete_own"
on public.questionnaire_runs
for delete
to authenticated
using (created_by = auth.uid());

-- Questionnaire item runs: access via run ownership.
drop policy if exists "questionnaire_item_runs_select_via_run_owner" on public.questionnaire_item_runs;
create policy "questionnaire_item_runs_select_via_run_owner"
on public.questionnaire_item_runs
for select
to authenticated
using (
  exists (
    select 1
    from public.questionnaire_runs qr
    where qr.id = run_id
      and qr.created_by = auth.uid()
  )
);

drop policy if exists "questionnaire_item_runs_insert_via_run_owner" on public.questionnaire_item_runs;
create policy "questionnaire_item_runs_insert_via_run_owner"
on public.questionnaire_item_runs
for insert
to authenticated
with check (
  exists (
    select 1
    from public.questionnaire_runs qr
    where qr.id = run_id
      and qr.created_by = auth.uid()
  )
);

drop policy if exists "questionnaire_item_runs_update_via_run_owner" on public.questionnaire_item_runs;
create policy "questionnaire_item_runs_update_via_run_owner"
on public.questionnaire_item_runs
for update
to authenticated
using (
  exists (
    select 1
    from public.questionnaire_runs qr
    where qr.id = run_id
      and qr.created_by = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.questionnaire_runs qr
    where qr.id = run_id
      and qr.created_by = auth.uid()
  )
);

drop policy if exists "questionnaire_item_runs_delete_via_run_owner" on public.questionnaire_item_runs;
create policy "questionnaire_item_runs_delete_via_run_owner"
on public.questionnaire_item_runs
for delete
to authenticated
using (
  exists (
    select 1
    from public.questionnaire_runs qr
    where qr.id = run_id
      and qr.created_by = auth.uid()
  )
);

-- 9. Profile backfill + auto-sync from Supabase Auth users
insert into public.profiles (id, email)
select u.id, u.email
from auth.users u
where u.email is not null
on conflict (id) do update
set email = excluded.email;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update
  set email = excluded.email;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
