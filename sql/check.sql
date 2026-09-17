-- MathQuest — read-only diagnostics. Paste the whole file into the Supabase SQL
-- editor when the database refuses something. It changes nothing.
--
-- The editor shows only the LAST result, so this file is arranged for that: one
-- row per thing worth knowing, and an `ok` column that should read true all the
-- way down. When something says false, the fix is nearly always to run
-- `sql/setup.sql` again — it is safe to re-run, it creates only what is missing,
-- and its last statement clears the PostgREST cache behind most mystery 404s.
--
-- If the very first query below errors with `relation "public.child" does not
-- exist`, that IS the diagnosis: nothing has been set up here yet.

select count(*) as children, count(friend_code) as with_code from public.child;


-- Everything else reads the system catalogues, so it answers even when a table or
-- a function is missing rather than erroring on the way past it.

select 'child table'                         as thing,
       coalesce(to_regclass('public.child')::text, 'missing')        as detail,
       to_regclass('public.child') is not null                       as ok

union all select 'friendship table',
       coalesce(to_regclass('public.friendship')::text, 'missing'),
       to_regclass('public.friendship') is not null

-- The line that actually protects the data. Without it every row is readable by
-- anyone holding the anon key, which is a public value printed in the page source.
union all select 'row level security on child',
       coalesce((select case when relrowsecurity then 'enabled' else 'OFF' end
                   from pg_class where oid = to_regclass('public.child')), 'no table'),
       coalesce((select relrowsecurity from pg_class
                  where oid = to_regclass('public.child')), false)

-- Exactly one policy expected. More than one, or a broader one, is the thing to
-- worry about — the `detail` column names whatever is really there.
union all select 'policy on child',
       coalesce((select string_agg(policyname || ' (' || cmd || ')', ', ')
                   from pg_policies where schemaname = 'public' and tablename = 'child'),
                'none — every row is readable'),
       coalesce((select count(*) = 1 and bool_and(policyname = 'own children only')
                   from pg_policies where schemaname = 'public' and tablename = 'child'),
                false)

-- An insert that does not name `owner` leaves it NULL, `auth.uid() = NULL` is NULL
-- rather than true, and the row is refused with 42501 — a message that reads like
-- a permissions problem and is really a missing value.
union all select 'owner fills itself in',
       coalesce((select column_default from information_schema.columns
                  where table_schema = 'public' and table_name = 'child'
                    and column_name = 'owner'), 'no default'),
       coalesce((select column_default like '%auth.uid()%' from information_schema.columns
                  where table_schema = 'public' and table_name = 'child'
                    and column_name = 'owner'), false)

union all select 'friend_code column',
       coalesce((select case when is_nullable = 'NO' then 'not null' else 'nullable' end
                   from information_schema.columns
                  where table_schema = 'public' and table_name = 'child'
                    and column_name = 'friend_code'), 'missing'),
       coalesce((select is_nullable = 'NO' from information_schema.columns
                  where table_schema = 'public' and table_name = 'child'
                    and column_name = 'friend_code'), false)

-- Arrived late, and a child saved without it was once quietly filed into Kindergarten.
union all select 'grade_year column',
       coalesce((select 'present' from information_schema.columns
                  where table_schema = 'public' and table_name = 'child'
                    and column_name = 'grade_year'), 'missing'),
       exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'child'
                  and column_name = 'grade_year')

union all select 'friend-code trigger',
       coalesce((select string_agg(tgname, ', ') from pg_trigger
                  where tgrelid = to_regclass('public.child') and not tgisinternal),
                'not attached'),
       exists (select 1 from pg_trigger
                where tgrelid = to_regclass('public.child')
                  and tgname = 'child_friend_code' and not tgisinternal)

-- A function that exists but is not granted gives PostgREST a 404 that looks
-- exactly like a missing one, which is an afternoon nobody gets back.
union all select 'the 7 friend functions, callable by a signed-in parent',
       (select count(*) || ' of 7' from pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and p.proname in ('friend_request', 'friend_accept', 'friend_remove', 'friends_of',
                             'friends_who_solved', 'my_friend_code', 'friends_overview')
           and has_function_privilege('authenticated', p.oid, 'execute')),
       (select count(*) = 7 from pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and p.proname in ('friend_request', 'friend_accept', 'friend_remove', 'friends_of',
                             'friends_who_solved', 'my_friend_code', 'friends_overview')
           and has_function_privilege('authenticated', p.oid, 'execute'))

-- `friendship` is reachable only through those functions. A table a client can
-- query directly is a table whose policy has to be perfect.
union all select 'friendship is not readable directly',
       coalesce((select case when has_table_privilege('authenticated', c.oid, 'select')
                               or has_table_privilege('anon', c.oid, 'select')
                             then 'READABLE' else 'definer functions only' end
                   from pg_class c where c.oid = to_regclass('public.friendship')), 'no table'),
       coalesce((select not (has_table_privilege('authenticated', c.oid, 'select')
                             or has_table_privilege('anon', c.oid, 'select'))
                   from pg_class c where c.oid = to_regclass('public.friendship')), false);
