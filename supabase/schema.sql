-- =============================================================================
-- Papillote — schéma Supabase (Postgres)
-- À exécuter dans Supabase > SQL Editor > New query > Run.
-- Idempotent : tu peux le relancer sans danger (create ... if not exists /
-- create or replace).
--
-- MODÈLE DE SÉCURITÉ
--  * RLS activée sur toutes les tables, AUCUNE policy => anon/authenticated
--    ne peuvent rien lire ni écrire directement.
--  * Les droits sur les tables sont aussi révoqués (double verrou).
--  * Tout passe par des fonctions SECURITY DEFINER (RPC) qui reçoivent un
--    secret (owner_secret ou share_secret) en paramètre.
--  * Chaque fonction fixe search_path = '' (tout est qualifié) et valide ses
--    entrées. EXECUTE est révoqué à PUBLIC puis accordé explicitement.
--  * owner_get_list ne renvoie JAMAIS aucune information de réservation.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- 1. Fonctions utilitaires internes (non appelables depuis l'API)
-- -----------------------------------------------------------------------------

-- Secret aléatoire url-safe : 32 octets => 43 caractères (256 bits d'entropie).
create or replace function public._gen_secret()
returns text
language sql
volatile
set search_path = ''
as $$
  select translate(
    rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='),
    '+/', '-_'
  );
$$;

-- Nettoie et valide un texte : supprime les caractères de contrôle, trim,
-- impose une longueur maximale. Lève 'invalid_input' si invalide.
create or replace function public._txt(
  p text,
  p_max int,
  p_required boolean default false,
  p_multiline boolean default false
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := p;
begin
  if v is null then
    if p_required then raise exception 'invalid_input'; end if;
    return null;
  end if;

  if p_multiline then
    -- on garde tabulation et retours à la ligne
    v := regexp_replace(v, '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', '', 'g');
  else
    v := regexp_replace(v, '[\x01-\x1f\x7f]+', ' ', 'g');
  end if;
  v := btrim(v);

  if v = '' then
    if p_required then raise exception 'invalid_input'; end if;
    return null;
  end if;
  if char_length(v) > p_max then
    raise exception 'invalid_input';
  end if;
  return v;
end;
$$;

-- Valide une URL : http(s) uniquement, sans espace ni caractère dangereux.
create or replace function public._url(p text, p_max int default 2000)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := public._txt(p, p_max, false);
begin
  if v is null then
    return null;
  end if;
  if v !~* '^https?://[^/\s<>"''\\]+([/?#][^\s<>"''\\]*)?$' then
    raise exception 'invalid_input';
  end if;
  return v;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Tables
-- -----------------------------------------------------------------------------

create table if not exists public.lists (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(title) between 1 and 120),
  occasion     text not null default 'autre'
                 check (occasion in ('noel', 'anniversaire', 'autre')),
  owner_secret text not null unique default public._gen_secret()
                 check (char_length(owner_secret) >= 32),
  share_secret text not null unique default public._gen_secret()
                 check (char_length(share_secret) >= 32),
  created_at   timestamptz not null default now(),
  check (owner_secret <> share_secret)
);

create table if not exists public.items (
  id         uuid primary key default gen_random_uuid(),
  list_id    uuid not null references public.lists (id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 200),
  url        text check (url is null or char_length(url) <= 2000),
  price      numeric(10, 2) check (price is null or (price >= 0 and price <= 1000000)),
  note       text check (note is null or char_length(note) <= 1000),
  image_url  text check (image_url is null or char_length(image_url) <= 2000),
  kind       text not null default 'single' check (kind in ('single', 'group')),
  position   int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists items_list_position_idx on public.items (list_id, position);

create table if not exists public.reservations (
  id           uuid primary key default gen_random_uuid(),
  item_id      uuid not null references public.items (id) on delete cascade,
  taker_name   text not null check (char_length(taker_name) between 1 and 40),
  amount       numeric(10, 2) check (amount is null or (amount > 0 and amount <= 1000000)),
  -- jeton secret gardé par l'invité (dans son navigateur) pour annuler
  cancel_token text not null default public._gen_secret(),
  -- vrai pour la réservation d'un article 'single' : l'index unique ci-dessous
  -- garantit au niveau base qu'il ne peut y en avoir qu'une par article.
  is_exclusive boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists reservations_item_idx on public.reservations (item_id);
create unique index if not exists reservations_one_exclusive_per_item
  on public.reservations (item_id) where is_exclusive;

-- -----------------------------------------------------------------------------
-- 3. Row Level Security : activée, sans AUCUNE policy + droits révoqués
-- -----------------------------------------------------------------------------

alter table public.lists        enable row level security;
alter table public.items        enable row level security;
alter table public.reservations enable row level security;

revoke all on table public.lists        from public, anon, authenticated;
revoke all on table public.items        from public, anon, authenticated;
revoke all on table public.reservations from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Résolution des secrets (internes)
-- -----------------------------------------------------------------------------

create or replace function public._list_id_by_owner(p_secret text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid;
begin
  if p_secret is null or char_length(p_secret) < 32 or char_length(p_secret) > 128 then
    raise exception 'not_found';
  end if;
  select id into v from public.lists where owner_secret = p_secret;
  if v is null then
    raise exception 'not_found';
  end if;
  return v;
end;
$$;

create or replace function public._list_id_by_share(p_secret text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid;
begin
  if p_secret is null or char_length(p_secret) < 32 or char_length(p_secret) > 128 then
    raise exception 'not_found';
  end if;
  select id into v from public.lists where share_secret = p_secret;
  if v is null then
    raise exception 'not_found';
  end if;
  return v;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. RPC publiques
-- -----------------------------------------------------------------------------

-- Petit ping pour le workflow "keepalive" (évite la mise en pause du projet).
create or replace function public.ping()
returns text
language sql
security definer
set search_path = ''
as $$
  select 'pong'::text;
$$;

-- Crée une liste et renvoie les deux secrets (seule fois où ils sont générés).
create or replace function public.create_list(p_title text, p_occasion text default 'autre')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.lists;
  v_occasion text := coalesce(p_occasion, 'autre');
begin
  if v_occasion not in ('noel', 'anniversaire', 'autre') then
    raise exception 'invalid_input';
  end if;

  insert into public.lists (title, occasion)
  values (public._txt(p_title, 120, true), v_occasion)
  returning * into v;

  return jsonb_build_object(
    'id', v.id,
    'title', v.title,
    'occasion', v.occasion,
    'owner_secret', v.owner_secret,
    'share_secret', v.share_secret,
    'created_at', v.created_at
  );
end;
$$;

-- ---- Côté propriétaire : AUCUNE donnée de réservation, pas même un booléen --

create or replace function public.owner_get_list(p_owner_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := public._list_id_by_owner(p_owner_secret);
begin
  return (
    select jsonb_build_object(
      'id', l.id,
      'title', l.title,
      'occasion', l.occasion,
      'share_secret', l.share_secret,
      'created_at', l.created_at,
      'items', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', i.id,
            'title', i.title,
            'url', i.url,
            'price', i.price,
            'note', i.note,
            'image_url', i.image_url,
            'kind', i.kind,
            'position', i.position
          )
          order by i.position, i.created_at
        )
        from public.items i
        where i.list_id = l.id
      ), '[]'::jsonb)
    )
    from public.lists l
    where l.id = v_id
  );
end;
$$;

create or replace function public.owner_update_list(
  p_owner_secret text,
  p_title text,
  p_occasion text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := public._list_id_by_owner(p_owner_secret);
begin
  if p_occasion is null or p_occasion not in ('noel', 'anniversaire', 'autre') then
    raise exception 'invalid_input';
  end if;
  update public.lists
     set title = public._txt(p_title, 120, true),
         occasion = p_occasion
   where id = v_id;
end;
$$;

create or replace function public.owner_delete_list(p_owner_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := public._list_id_by_owner(p_owner_secret);
begin
  delete from public.lists where id = v_id; -- cascade : articles + réservations
end;
$$;

-- Crée (p_item_id null) ou modifie un article.
create or replace function public.owner_upsert_item(
  p_owner_secret text,
  p_title text,
  p_item_id uuid default null,
  p_url text default null,
  p_price numeric default null,
  p_note text default null,
  p_image_url text default null,
  p_kind text default 'single'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_list uuid := public._list_id_by_owner(p_owner_secret);
  v_title text := public._txt(p_title, 200, true);
  v_url text := public._url(p_url);
  v_image text := public._url(p_image_url);
  v_note text := public._txt(p_note, 1000, false, true);
  v_price numeric(10, 2);
  v_item public.items;
begin
  if p_kind is null or p_kind not in ('single', 'group') then
    raise exception 'invalid_input';
  end if;
  if p_price is not null then
    if p_price < 0 or p_price > 1000000 then
      raise exception 'invalid_input';
    end if;
    v_price := round(p_price, 2);
  end if;
  -- une cagnotte a besoin d'un montant cible
  if p_kind = 'group' and (v_price is null or v_price <= 0) then
    raise exception 'invalid_input';
  end if;

  if p_item_id is null then
    -- verrou sur la liste pour que la limite de 100 articles tienne en concurrence
    perform 1 from public.lists where id = v_list for update;
    if (select count(*) from public.items where list_id = v_list) >= 100 then
      raise exception 'limit_reached';
    end if;

    insert into public.items (list_id, title, url, price, note, image_url, kind, position)
    values (
      v_list, v_title, v_url, v_price, v_note, v_image, p_kind,
      coalesce((select max(position) from public.items where list_id = v_list), 0) + 1
    )
    returning * into v_item;
  else
    update public.items
       set title = v_title, url = v_url, price = v_price, note = v_note,
           image_url = v_image, kind = p_kind
     where id = p_item_id and list_id = v_list
    returning * into v_item;
    if not found then
      raise exception 'not_found';
    end if;

    -- Si le type change, on remet à jour l'exclusivité des réservations
    -- existantes (sans rien révéler au propriétaire, aucune erreur possible :
    -- au plus une ligne exclusive par article).
    update public.reservations r
       set is_exclusive = (
         p_kind = 'single'
         and r.id = (
           select r2.id from public.reservations r2
            where r2.item_id = r.item_id
            order by r2.created_at, r2.id
            limit 1
         )
       )
     where r.item_id = v_item.id;
  end if;

  return jsonb_build_object(
    'id', v_item.id,
    'title', v_item.title,
    'url', v_item.url,
    'price', v_item.price,
    'note', v_item.note,
    'image_url', v_item.image_url,
    'kind', v_item.kind,
    'position', v_item.position
  );
end;
$$;

create or replace function public.owner_delete_item(p_owner_secret text, p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_list uuid := public._list_id_by_owner(p_owner_secret);
begin
  delete from public.items where id = p_item_id and list_id = v_list;
  if not found then
    raise exception 'not_found';
  end if;
end;
$$;

-- Réordonne : p_item_ids dans le nouvel ordre souhaité.
create or replace function public.owner_reorder_items(p_owner_secret text, p_item_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_list uuid := public._list_id_by_owner(p_owner_secret);
begin
  if p_item_ids is null or cardinality(p_item_ids) > 200 then
    raise exception 'invalid_input';
  end if;

  update public.items i
     set position = o.ord
    from unnest(p_item_ids) with ordinality as o(id, ord)
   where i.id = o.id and i.list_id = v_list;
end;
$$;

-- ---- Côté invités : liste + articles + réservations -------------------------
-- cancel_token n'est JAMAIS renvoyé ici.

create or replace function public.shared_get_list(p_share_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := public._list_id_by_share(p_share_secret);
begin
  return (
    select jsonb_build_object(
      'title', l.title,
      'occasion', l.occasion,
      'items', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', i.id,
            'title', i.title,
            'url', i.url,
            'price', i.price,
            'note', i.note,
            'image_url', i.image_url,
            'kind', i.kind,
            'reservations', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'id', r.id,
                  'taker_name', r.taker_name,
                  'amount', r.amount
                )
                order by r.created_at, r.id
              )
              from public.reservations r
              where r.item_id = i.id
            ), '[]'::jsonb)
          )
          order by i.position, i.created_at
        )
        from public.items i
        where i.list_id = l.id
      ), '[]'::jsonb)
    )
    from public.lists l
    where l.id = v_id
  );
end;
$$;

-- Réserve un article. Concurrence : on verrouille la ligne de l'article
-- (FOR UPDATE), ce qui sérialise les réservations d'un même article ; l'index
-- unique partiel reservations_one_exclusive_per_item sert de filet de sécurité.
create or replace function public.shared_reserve(
  p_share_secret text,
  p_item_id uuid,
  p_name text,
  p_amount numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_list uuid := public._list_id_by_share(p_share_secret);
  v_name text := public._txt(p_name, 40, true);
  v_item public.items;
  v_res public.reservations;
begin
  select * into v_item
    from public.items
   where id = p_item_id and list_id = v_list
   for update;
  if not found then
    raise exception 'not_found';
  end if;

  if (select count(*) from public.reservations where item_id = v_item.id) >= 100 then
    raise exception 'limit_reached';
  end if;

  if v_item.kind = 'single' then
    if exists (select 1 from public.reservations where item_id = v_item.id) then
      raise exception 'already_taken';
    end if;
    insert into public.reservations (item_id, taker_name, amount, is_exclusive)
    values (v_item.id, v_name, null, true)
    returning * into v_res;
  else
    if p_amount is null or p_amount <= 0 or p_amount > 1000000 then
      raise exception 'invalid_input';
    end if;
    insert into public.reservations (item_id, taker_name, amount, is_exclusive)
    values (v_item.id, v_name, round(p_amount, 2), false)
    returning * into v_res;
  end if;

  return jsonb_build_object(
    'reservation_id', v_res.id,
    'cancel_token', v_res.cancel_token
  );
exception
  when unique_violation then
    raise exception 'already_taken';
end;
$$;

create or replace function public.shared_cancel_reservation(
  p_share_secret text,
  p_reservation_id uuid,
  p_cancel_token text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_share_secret is null or p_cancel_token is null
     or char_length(p_share_secret) > 128 or char_length(p_cancel_token) > 128 then
    raise exception 'not_found';
  end if;

  delete from public.reservations r
   using public.items i, public.lists l
   where r.id = p_reservation_id
     and r.cancel_token = p_cancel_token
     and i.id = r.item_id
     and l.id = i.list_id
     and l.share_secret = p_share_secret;

  if not found then
    raise exception 'not_found';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Droits d'exécution
--    Supabase accorde EXECUTE à anon/authenticated par défaut sur les nouvelles
--    fonctions : on révoque tout, puis on accorde uniquement les RPC publiques.
-- -----------------------------------------------------------------------------

-- Fonctions internes : personne via l'API
revoke all on function public._gen_secret()                         from public, anon, authenticated;
revoke all on function public._txt(text, int, boolean, boolean)     from public, anon, authenticated;
revoke all on function public._url(text, int)                       from public, anon, authenticated;
revoke all on function public._list_id_by_owner(text)               from public, anon, authenticated;
revoke all on function public._list_id_by_share(text)               from public, anon, authenticated;

-- RPC publiques
revoke all on function public.ping()                                                      from public, anon, authenticated;
revoke all on function public.create_list(text, text)                                     from public, anon, authenticated;
revoke all on function public.owner_get_list(text)                                        from public, anon, authenticated;
revoke all on function public.owner_update_list(text, text, text)                         from public, anon, authenticated;
revoke all on function public.owner_delete_list(text)                                     from public, anon, authenticated;
revoke all on function public.owner_upsert_item(text, text, uuid, text, numeric, text, text, text) from public, anon, authenticated;
revoke all on function public.owner_delete_item(text, uuid)                               from public, anon, authenticated;
revoke all on function public.owner_reorder_items(text, uuid[])                           from public, anon, authenticated;
revoke all on function public.shared_get_list(text)                                       from public, anon, authenticated;
revoke all on function public.shared_reserve(text, uuid, text, numeric)                   from public, anon, authenticated;
revoke all on function public.shared_cancel_reservation(text, uuid, text)                 from public, anon, authenticated;

grant execute on function public.ping()                                                      to anon, authenticated;
grant execute on function public.create_list(text, text)                                     to anon, authenticated;
grant execute on function public.owner_get_list(text)                                        to anon, authenticated;
grant execute on function public.owner_update_list(text, text, text)                         to anon, authenticated;
grant execute on function public.owner_delete_list(text)                                     to anon, authenticated;
grant execute on function public.owner_upsert_item(text, text, uuid, text, numeric, text, text, text) to anon, authenticated;
grant execute on function public.owner_delete_item(text, uuid)                               to anon, authenticated;
grant execute on function public.owner_reorder_items(text, uuid[])                           to anon, authenticated;
grant execute on function public.shared_get_list(text)                                       to anon, authenticated;
grant execute on function public.shared_reserve(text, uuid, text, numeric)                   to anon, authenticated;
grant execute on function public.shared_cancel_reservation(text, uuid, text)                 to anon, authenticated;

-- Aucune table n'est ajoutée à la publication supabase_realtime : le temps réel
-- passe uniquement par Realtime Broadcast (messages sans données).
