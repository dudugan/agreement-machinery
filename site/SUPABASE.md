# Reader notes with Supabase

Readers can select a passage in a chapter, press **Comment**, and leave a note that appears in the margin
for everyone. They can **reply** to a note, and **delete** their own notes and replies (from the browser they
posted them from). Notes are stored in a free [Supabase](https://supabase.com) database. Until it's set up,
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

-- … and add new ones, but never edit or delete anything directly
create policy "add notes" on public.notes
  for insert to anon with check (status = 'approved');

-- newer projects don't give the public key access to new tables automatically
grant select, insert on public.notes to anon;
```

Then run the SQL in [Replies and deleting](#replies-and-deleting) below as well.

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

- **Delete a note for good:** delete its row in the table editor. Its replies are deleted with it.

The site also refuses notes containing slurs or more than two links, as Invisible Cities does.

## Replies and deleting

Run this once in **SQL Editor → New query** (on a new project, right after the SQL above; on a project that
already has notes, on its own; existing notes are kept). Until it has been run, the site keeps working but
shows no **reply** or **delete** buttons.

```sql
-- a reply points at the note it answers
alter table public.notes add column parent_id bigint references public.notes(id) on delete cascade;
-- SHA-256 of a random key that only the poster's browser knows; it proves who may delete the note
alter table public.notes add column delete_hash text not null default '' check (char_length(delete_hash) <= 64);
-- a deleted note that still has replies is kept, blanked, so the replies stay readable
alter table public.notes add column deleted boolean not null default false;
create index notes_parent_id on public.notes (parent_id);

-- the only way the public key can remove anything: with the key whose hash was stored with the note
create function public.delete_note(note_id bigint, delete_key text) returns text
language plpgsql security definer set search_path = public as $$
declare n public.notes;
begin
  select * into n from public.notes where id = note_id;
  if not found or n.delete_hash = '' or char_length(coalesce(delete_key, '')) < 16
     or n.delete_hash <> encode(sha256(convert_to(delete_key, 'UTF8')), 'hex') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if exists (select 1 from public.notes where parent_id = note_id) then
    update public.notes set body = '(deleted)', name = '', deleted = true where id = note_id;
    return 'blanked';
  end if;
  delete from public.notes where id = note_id;
  -- deleting the last reply to a deleted note removes that note too
  delete from public.notes p where p.id = n.parent_id and p.deleted
    and not exists (select 1 from public.notes c where c.parent_id = p.id);
  return 'deleted';
end $$;

revoke execute on function public.delete_note(bigint, text) from public;
grant execute on function public.delete_note(bigint, text) to anon;
```

How it works: when someone posts, their browser makes a random key, keeps it in its own storage, and sends
only the key's hash. `delete_note` deletes a note only when given the key that matches. So people can delete
their own notes but no one else's, as long as they use the same browser (clearing site data, or switching
browser or device, loses the key; you can still delete the note in the table editor). Notes posted before
this upgrade have no key, so only you can delete them.

Replies go through the same moderation as notes: if notes are set to arrive as `pending`, so are replies.
Hiding a note also hides its replies.
