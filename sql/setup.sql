-- MathQuest — the whole database, in one script.
--
-- Paste this into the SQL editor of a brand new Supabase project and you have a
-- working backend. Paste it into one that is already running and nothing is lost:
-- every statement either creates what is missing or leaves what is already there
-- exactly as it is. Re-run it as often as you like.
--
-- It replaces 02-friends.sql, 03-parent-review.sql, 04-owner-default.sql and
-- 05-reload.sql, which were written as migrations for a database that only ever
-- existed once. `check.sql` stays separate — it is read-only, for the next time
-- the database refuses something.
--
-- Re-running this is also the cure for "the database has not picked up the friends
-- functions yet": the last statement tells PostgREST to reload its schema cache.
--
-- THE RULE, if you change anything below. The policy on `child` stays exactly as
-- it is — "own children only". Friends see each other through SECURITY DEFINER
-- functions that return a fixed, narrow set of columns and check the caller's
-- claim to their own child on every call. The function IS the window; there is no
-- other one. Loosening that policy so families can see each other is the single
-- change most likely to expose every child on the service at once.


/* ============================== 1 · the players ============================== */

create table if not exists public.child (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 24),
  grade       smallint,
  grade_year  smallint,
  progress    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- For a table that predates any of these: add what is missing, touch nothing else.
-- `grade_year` in particular arrived late, and a child saved without it was once
-- quietly filed into Kindergarten.
alter table public.child
  add column if not exists grade       smallint,
  add column if not exists grade_year  smallint,
  add column if not exists progress    jsonb not null default '{}'::jsonb,
  add column if not exists created_at  timestamptz not null default now(),
  add column if not exists updated_at  timestamptz not null default now(),
  add column if not exists friend_code text;

-- An insert that does not name `owner` leaves it NULL, `auth.uid() = NULL` is NULL
-- rather than true, and the row is refused with 42501 — a message that reads like a
-- permissions problem and is really a missing value. The server names the owner
-- itself now; this is the belt to that pair of braces.
alter table public.child alter column owner set default auth.uid();

-- ONE CHILD PER NAME, PER ACCOUNT.
--
-- Two devices that each held an unlinked "Robin" before either had synced would
-- each create a row for him. The account then held the same seven-year-old twice,
-- with his progress split across two rows that could never catch up with each
-- other, and a parent page listing the same first name twice.
--
-- The server checks before it inserts, but a check in application code loses a
-- race between two devices by definition. This is the rule that actually holds.
--
-- Created only when it can be: a database that ALREADY has duplicates would fail
-- the index and take the whole re-runnable script down with it. Those have to be
-- merged by hand first — the notice says so rather than failing silently.
do $$
declare dupes int;
begin
  select count(*) into dupes from (
    select owner, lower(name) from public.child group by 1, 2 having count(*) > 1
  ) d;
  if dupes > 0 then
    raise notice 'Skipping the one-child-per-name index: % duplicate name(s) on this database. Merge them, then re-run this script.', dupes;
  else
    create unique index if not exists child_owner_name on public.child (owner, lower(name));
  end if;
end $$;

alter table public.child enable row level security;

-- The line that actually protects the data. Without it every row is readable by
-- anyone holding the anon key, which is a public value printed in the page source.
-- Created only if absent: if you have edited the policy by hand, your version wins
-- and the verification at the bottom will show you what is really there.
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'child'
       and policyname = 'own children only'
  ) then
    create policy "own children only" on public.child
      for all using (auth.uid() = owner) with check (auth.uid() = owner);
  end if;
end $$;


/* ============================= 2 · friend codes ============================== */
-- How one child is addressed by another. Not a directory: you cannot search for a
-- child, you cannot guess a code, and holding a code is the whole permission to
-- send ONE friend request — which still has to be accepted.

create or replace function public.gen_friend_code() returns text
language sql volatile as $$
  -- No vowels, no 0/O/1/I/l: a code gets read aloud by a seven-year-old and typed
  -- by another one, and it must not be able to spell anything.
  select string_agg(substr('BCDFGHJKMNPQRSTVWXYZ23456789', floor(random()*28)::int + 1, 1), '')
  from generate_series(1, 8);
$$;

create or replace function public.set_friend_code() returns trigger
language plpgsql security definer set search_path = public as $$
declare candidate text;
begin
  if new.friend_code is not null then return new; end if;
  -- Checked by looking, not by catching: this is a BEFORE trigger, so the unique
  -- violation it would need to catch has not happened yet.
  loop
    candidate := public.gen_friend_code();
    exit when not exists (select 1 from public.child c where c.friend_code = candidate);
  end loop;
  new.friend_code := candidate;
  return new;
end $$;

drop trigger if exists child_friend_code on public.child;
create trigger child_friend_code before insert on public.child
  for each row execute function public.set_friend_code();

-- Give a code to anyone who already exists. No-op on a fresh database, and a no-op
-- the second time you run this.
do $$
declare r record; candidate text;
begin
  for r in select id from public.child where friend_code is null loop
    loop
      candidate := public.gen_friend_code();
      exit when not exists (select 1 from public.child c where c.friend_code = candidate);
    end loop;
    update public.child set friend_code = candidate where id = r.id;
  end loop;
end $$;

-- Only now, with every row filled in, can these hold.
create unique index if not exists child_friend_code_key on public.child (friend_code);
alter table public.child alter column friend_code set not null;


/* ============================== 3 · friendships ============================== */

create table if not exists public.friendship (
  id          uuid primary key default gen_random_uuid(),
  asked_by    uuid not null references public.child(id) on delete cascade,
  asked_of    uuid not null references public.child(id) on delete cascade,
  status      text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  check (asked_by <> asked_of)
);

alter table public.friendship
  add column if not exists status      text not null default 'pending',
  add column if not exists created_at  timestamptz not null default now(),
  add column if not exists accepted_at timestamptz;

-- One friendship per pair, whichever way round it was asked.
create unique index if not exists friendship_pair
  on public.friendship (least(asked_by, asked_of), greatest(asked_by, asked_of));

alter table public.friendship enable row level security;

-- Deliberately NO permissive policies. Every route in and out of this table is a
-- definer function below. A table a client can query directly is a table whose
-- policy has to be perfect; a table reachable only through four functions has four
-- places to be right instead of one place to be wrong.
revoke all on public.friendship from anon, authenticated;


/* ================================ 4 · helpers =============================== */

create or replace function public.owns_child(kid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.child c where c.id = kid and c.owner = auth.uid());
$$;


/* =============================== 5 · the window ============================== */
-- Dropped before they are created, not replaced. Several of these return a TABLE,
-- and Postgres refuses to REPLACE a function whose output columns have changed —
-- which is exactly what happens when you re-run this after editing one. Dropping
-- first makes an edit land instead of erroring.

drop function if exists public.friend_request(uuid, text);
drop function if exists public.friend_accept(uuid, uuid);
drop function if exists public.friend_remove(uuid, uuid);
drop function if exists public.friends_of(uuid);
drop function if exists public.friends_who_solved(uuid, text);
drop function if exists public.my_friend_code(uuid);
drop function if exists public.friends_overview();


/* -- ask to be friends ------------------------------------------------------- */
-- `mine` must be a child of the caller's. `code` is the other child's friend code.
-- Returns the other child's first name, so the app can say who was asked.

create function public.friend_request(mine uuid, code text)
returns table (friend_name text, friend_status text)
language plpgsql security definer set search_path = public as $$
declare theirs uuid; their_name text; existing public.friendship%rowtype;
begin
  if not public.owns_child(mine) then raise exception 'not your player'; end if;

  select c.id, c.name into theirs, their_name
  from public.child c where upper(c.friend_code) = upper(trim(code));
  if theirs is null then raise exception 'no such code'; end if;
  if theirs = mine then raise exception 'that is you'; end if;

  -- Two children on the SAME account are already visible to their own parent, and
  -- letting siblings friend each other is a nicety rather than a risk.
  select * into existing from public.friendship f
   where least(f.asked_by, f.asked_of) = least(mine, theirs)
     and greatest(f.asked_by, f.asked_of) = greatest(mine, theirs);

  if existing.id is not null then
    -- They asked us first: answering with a request of our own is an accept.
    if existing.status = 'pending' and existing.asked_of = mine then
      update public.friendship set status = 'accepted', accepted_at = now() where id = existing.id;
      return query select their_name, 'accepted'::text;
      return;   -- `return query` APPENDS rows; it does not leave the function.
    end if;
    return query select their_name, existing.status;
    return;     -- Without this the insert below runs anyway and hits friendship_pair.
  end if;

  insert into public.friendship (asked_by, asked_of) values (mine, theirs);
  return query select their_name, 'pending'::text;
end $$;


/* -- accept, and undo -------------------------------------------------------- */

create function public.friend_accept(mine uuid, friendship_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.owns_child(mine) then raise exception 'not your player'; end if;
  -- Only the child who was ASKED can accept. Accepting a request you sent yourself
  -- would make a friendship out of one side's say-so.
  update public.friendship set status = 'accepted', accepted_at = now()
   where id = friendship_id and asked_of = mine and status = 'pending';
  get diagnostics n = row_count;
  return n > 0;
end $$;

create function public.friend_remove(mine uuid, other uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.owns_child(mine) then raise exception 'not your player'; end if;
  delete from public.friendship
   where least(asked_by, asked_of) = least(mine, other)
     and greatest(asked_by, asked_of) = greatest(mine, other);
  get diagnostics n = row_count;
  return n > 0;
end $$;


/* -- what a friend sees ------------------------------------------------------ */
-- THE NARROW WINDOW. Everything a child can learn about a friend is these columns
-- and nothing else: no email, no owner, no school year, no misconceptions, no
-- reasoning summary, no puzzle text. Progress is reduced to three numbers HERE, in
-- the database, so a wider blob cannot escape by accident later.

create function public.friends_of(mine uuid)
returns table (
  friendship_id uuid,
  child_id      uuid,
  name          text,
  status        text,
  direction     text,   -- 'in' = they asked us and we have not answered; 'out' = we asked
  solved        int,
  stars         int,
  planets       int,
  asked_at      timestamptz,
  accepted_at   timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    f.id,
    other.id,
    other.name,
    f.status,
    case when f.asked_of = mine then 'in' else 'out' end,
    coalesce((other.progress #>> '{totals,solved}')::int, 0),
    coalesce((other.progress #>> '{totals,stars}')::int, 0),
    coalesce((other.progress #>> '{totals,planets}')::int, 0),
    f.created_at,
    f.accepted_at
  from public.friendship f
  join public.child other
    on other.id = case when f.asked_by = mine then f.asked_of else f.asked_by end
  where public.owns_child(mine)
    and (f.asked_by = mine or f.asked_of = mine)
  order by f.status desc, other.name;
$$;

-- The bit a seven-year-old actually cares about. Names only, and only for
-- friendships both sides accepted.
create function public.friends_who_solved(mine uuid, puzzle text)
returns table (name text)
language sql stable security definer set search_path = public as $$
  select other.name
  from public.friendship f
  join public.child other
    on other.id = case when f.asked_by = mine then f.asked_of else f.asked_by end
  where public.owns_child(mine)
    and f.status = 'accepted'
    and (f.asked_by = mine or f.asked_of = mine)
    and other.progress -> 'recent' ? puzzle
  order by other.name;
$$;

create function public.my_friend_code(mine uuid)
returns text
language sql stable security definer set search_path = public as $$
  select c.friend_code from public.child c
   where c.id = mine and c.owner = auth.uid();
$$;


/* -- what a parent sees ------------------------------------------------------ */
-- A parent has one question and it spans their whole family, so this answers it in
-- one call rather than one per child. Note what is NOT here: no progress numbers.
-- A parent reviewing who their child has befriended does not need another family's
-- child's star count, and a function that does not select a column cannot leak it.

create function public.friends_overview()
returns table (
  friendship_id uuid,
  my_child_id   uuid,
  my_child_name text,
  friend_id     uuid,
  friend_name   text,
  status        text,
  direction     text,
  asked_at      timestamptz,
  accepted_at   timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    f.id,
    mine.id,
    mine.name,
    other.id,
    other.name,
    f.status,
    case when f.asked_of = mine.id then 'in' else 'out' end,
    f.created_at,
    f.accepted_at
  from public.child mine
  join public.friendship f
    on f.asked_by = mine.id or f.asked_of = mine.id
  join public.child other
    on other.id = case when f.asked_by = mine.id then f.asked_of else f.asked_by end
  where mine.owner = auth.uid()
  order by coalesce(f.accepted_at, f.created_at) desc;
$$;


/* ================================ 6 · grants ================================= */

grant execute on function public.friend_request(uuid, text)      to authenticated;
grant execute on function public.friend_accept(uuid, uuid)       to authenticated;
grant execute on function public.friend_remove(uuid, uuid)       to authenticated;
grant execute on function public.friends_of(uuid)                to authenticated;
grant execute on function public.friends_who_solved(uuid, text)  to authenticated;
grant execute on function public.my_friend_code(uuid)            to authenticated;
grant execute on function public.friends_overview()              to authenticated;


/* ================================ 7 · reload ================================= */
-- PostgREST — the thing Supabase puts in front of Postgres — caches the list of
-- functions it may call. One created after it started is invisible until the cache
-- is told to reload, and the error is a 404 "Could not find the function in the
-- schema cache", which reads like a missing route and is really a stale cache.

notify pgrst, 'reload schema';


/* ================================ 8 · verify ================================= */
-- Every row should say true. The Supabase editor shows only the last result, so
-- this is the one you will see.

select 'child table'                                as thing,
       to_regclass('public.child') is not null      as ok
union all select 'friendship table',
       to_regclass('public.friendship') is not null
union all select 'row level security on child',
       coalesce((select relrowsecurity from pg_class where oid = 'public.child'::regclass), false)
union all select 'policy "own children only"',
       exists (select 1 from pg_policies
                where schemaname = 'public' and tablename = 'child'
                  and policyname = 'own children only')
union all select 'friendship is not directly readable',
       not has_table_privilege('authenticated', 'public.friendship', 'select')
union all select 'owner fills itself in',
       (select column_default like '%auth.uid()%' from information_schema.columns
         where table_schema = 'public' and table_name = 'child' and column_name = 'owner')
union all select 'one child per name, per account (merge duplicates and re-run if false)',
       exists (select 1 from pg_indexes
                where schemaname = 'public' and indexname = 'child_owner_name')
union all select 'friend-code trigger attached',
       exists (select 1 from pg_trigger
                where tgrelid = 'public.child'::regclass
                  and tgname = 'child_friend_code' and not tgisinternal)
union all select 'every player has a friend code',
       (select count(*) = count(friend_code) from public.child)
union all select 'all 7 friend functions callable by a signed-in parent',
       (select count(*) = 7 from pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and p.proname in ('friend_request', 'friend_accept', 'friend_remove',
                             'friends_of', 'friends_who_solved', 'my_friend_code',
                             'friends_overview')
           and has_function_privilege('authenticated', p.oid, 'execute'));
