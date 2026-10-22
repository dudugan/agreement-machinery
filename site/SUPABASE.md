# Reader notes with Supabase

Readers can select a passage in a chapter, press **Comment**, and leave a note that appears in the margin
for everyone. Notes are stored in a free [Supabase](https://supabase.com) database. Until it's set up,
notes are saved only in the reader's own browser, so you can try everything locally first.

## 1. Create the project

1. Sign up at https://supabase.com and create a new project (the free plan is plenty).
2. In the project, open **SQL Editor → New query**, paste the SQL below, and press **Run**.

```sql
create table public.notes (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  page        text not null check (char_length(page)  between 1 and 120),
  quote       text not null check (char_length(quote) between 1 and 400),
  prefix      text not null default '' check (char_length(prefix) <= 60),
  suffix      text not null default '' check (char_length(suffix) <= 60),
  name        text not null default '' check (char_length(name)   <= 60),
  body        text not null check (char_length(body)  between 1 and 2000),
  status      text not null default 'approved' check (status in ('approved', 'pending', 'hidden'))
);

alter table public.notes enable row level security;

-- the public key can read approved notes …
create policy "read approved notes" on public.notes
  for select to anon using (status = 'approved');

-- … and add new ones, but never edit or delete anything
create policy "add notes" on public.notes
  for insert to anon with check (status = 'approved');

-- newer projects don't give the public key access to new tables automatically
grant select, insert on public.notes to anon;
```

## 2. Connect the site

In Supabase, open **Project Settings → API** (or **Connect**) and copy:

- the **Project URL** (`https://xxxx.supabase.co`)
- the **publishable** key (older projects call it the **anon / public** key). It is meant to be public; the
  policies above are what protect the table. Never use the `service_role` / secret key here.

Put them in `site/content/manifest.json`:

```json
"comments": { "supabaseUrl": "https://xxxx.supabase.co", "supabaseKey": "sb_publishable_…" }
```

Commit and push. Notes now go to Supabase and everyone sees them.

## Moderating

- **Hide a note:** open **Table Editor → notes** in Supabase and change its `status` to `hidden`. It disappears
  from the site on the next page load. Set it back to `approved` to restore it, or delete the row.
- **Approve notes before they appear:** run this once, and new notes arrive as `pending` until you set them
  to `approved`:

```sql
alter table public.notes alter column status set default 'pending';
drop policy "add notes" on public.notes;
create policy "add notes" on public.notes for insert to anon with check (status = 'pending');
```

The site also refuses notes containing slurs or more than two links, as Invisible Cities does.
