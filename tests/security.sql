-- =============================================================================
-- Papillote — test de sécurité côté base (SQL)
-- Lance-le dans Supabase > SQL Editor (colle tout et clique Run) ou avec psql.
-- Tout est exécuté dans une transaction annulée à la fin (ROLLBACK) : rien ne reste.
-- Les requêtes tournent avec le rôle "anon", exactement comme un navigateur.
-- Résultat attendu : un NOTICE "TOUS LES TESTS SONT PASSÉS" et aucune erreur.
-- =============================================================================

begin;
set local role anon;

do $$
declare
  l jsonb;
  owner_s text;
  share_s text;
  item jsonb;
  item_id uuid;
  group_item_id uuid;
  r jsonb;
  r2 jsonb;
  owner_view jsonb;
  guest_view jsonb;
  keys text;
  n int;
begin
  -- 1. Aucun accès direct aux tables ------------------------------------------
  begin
    perform 1 from public.lists;
    raise exception 'ECHEC: lecture directe de lists possible';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.items;
    raise exception 'ECHEC: lecture directe de items possible';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.reservations;
    raise exception 'ECHEC: lecture directe de reservations possible';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.lists (title) values ('pirate');
    raise exception 'ECHEC: insertion directe possible';
  exception when insufficient_privilege then null; end;
  begin
    perform public._txt('a', 5);
    raise exception 'ECHEC: fonction interne appelable par anon';
  exception when insufficient_privilege then null; end;
  begin
    perform public._list_id_by_owner('x');
    raise exception 'ECHEC: _list_id_by_owner appelable par anon';
  exception when insufficient_privilege then null; end;

  -- 2. Création de liste + secrets longs --------------------------------------
  l := public.create_list('Noël test', 'noel');
  owner_s := l->>'owner_secret';
  share_s := l->>'share_secret';
  if length(owner_s) < 32 or length(share_s) < 32 or owner_s = share_s then
    raise exception 'ECHEC: secrets trop courts ou identiques';
  end if;
  if owner_s !~ '^[A-Za-z0-9_-]+$' or share_s !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'ECHEC: secrets non url-safe';
  end if;

  -- 3. Articles ---------------------------------------------------------------
  item := public.owner_upsert_item(owner_s, 'Casque audio', null, 'https://example.com/casque', 59.9, 'Noir', null, 'single');
  item_id := (item->>'id')::uuid;
  item := public.owner_upsert_item(owner_s, 'Vélo', null, null, 300, null, null, 'group');
  group_item_id := (item->>'id')::uuid;

  -- validations
  begin
    perform public.owner_upsert_item(owner_s, 'x', null, 'javascript:alert(1)');
    raise exception 'ECHEC: URL javascript: acceptée';
  exception when others then
    if sqlerrm <> 'invalid_input' then raise; end if;
  end;
  begin
    perform public.owner_upsert_item(owner_s, repeat('a', 201));
    raise exception 'ECHEC: titre trop long accepté';
  exception when others then
    if sqlerrm <> 'invalid_input' then raise; end if;
  end;
  begin
    perform public.owner_upsert_item(owner_s, 'Cagnotte sans prix', null, null, null, null, null, 'group');
    raise exception 'ECHEC: cagnotte sans prix acceptée';
  exception when others then
    if sqlerrm <> 'invalid_input' then raise; end if;
  end;

  -- 4. Mauvais secret ---------------------------------------------------------
  begin
    perform public.owner_get_list(share_s);
    raise exception 'ECHEC: le share_secret ouvre la vue propriétaire';
  exception when others then
    if sqlerrm <> 'not_found' then raise; end if;
  end;
  begin
    perform public.shared_get_list(owner_s);
    raise exception 'ECHEC: l''owner_secret ouvre la vue invité';
  exception when others then
    if sqlerrm <> 'not_found' then raise; end if;
  end;

  -- 5. Réservation d'un article 'single' --------------------------------------
  r := public.shared_reserve(share_s, item_id, 'Alice');
  if r->>'cancel_token' is null then raise exception 'ECHEC: pas de jeton d''annulation'; end if;

  begin
    perform public.shared_reserve(share_s, item_id, 'Bob');
    raise exception 'ECHEC: double réservation acceptée';
  exception when others then
    if sqlerrm <> 'already_taken' then raise; end if;
  end;

  -- 6. Le propriétaire ne voit RIEN des réservations --------------------------
  owner_view := public.owner_get_list(owner_s);
  if owner_view::text ~* 'alice' or owner_view::text ~* 'bob' then
    raise exception 'ECHEC: un nom d''invité fuit vers le propriétaire';
  end if;
  if owner_view::text ~* 'reserv' or owner_view::text ~* 'taken' or owner_view::text ~* 'cancel' then
    raise exception 'ECHEC: une information de réservation fuit vers le propriétaire';
  end if;
  select string_agg(k, ',' order by k) into keys from jsonb_object_keys(owner_view->'items'->0) k;
  if keys <> 'id,image_url,kind,note,position,price,title,url' then
    raise exception 'ECHEC: champs inattendus côté propriétaire: %', keys;
  end if;

  -- 7. Les invités voient la réservation, jamais le jeton ---------------------
  guest_view := public.shared_get_list(share_s);
  if guest_view::text !~ 'Alice' then raise exception 'ECHEC: la réservation est invisible des invités'; end if;
  if guest_view::text ~* 'cancel_token' then raise exception 'ECHEC: le jeton d''annulation fuit'; end if;

  -- 8. Annulation : mauvais jeton refusé, bon jeton accepté --------------------
  begin
    perform public.shared_cancel_reservation(share_s, (r->>'reservation_id')::uuid, 'mauvais-jeton');
    raise exception 'ECHEC: annulation avec un mauvais jeton';
  exception when others then
    if sqlerrm <> 'not_found' then raise; end if;
  end;
  perform public.shared_cancel_reservation(share_s, (r->>'reservation_id')::uuid, r->>'cancel_token');
  r2 := public.shared_reserve(share_s, item_id, 'Bob');  -- de nouveau disponible

  -- 9. Cagnotte -----------------------------------------------------------------
  begin
    perform public.shared_reserve(share_s, group_item_id, 'Carole');  -- montant manquant
    raise exception 'ECHEC: participation sans montant acceptée';
  exception when others then
    if sqlerrm <> 'invalid_input' then raise; end if;
  end;
  perform public.shared_reserve(share_s, group_item_id, 'Carole', 50);
  perform public.shared_reserve(share_s, group_item_id, 'David', 25.5);
  guest_view := public.shared_get_list(share_s);
  if (select count(*) from jsonb_array_elements(guest_view->'items') i,
        jsonb_array_elements(i->'reservations') x where i->>'kind' = 'group') <> 2 then
    raise exception 'ECHEC: la cagnotte devrait avoir 2 participations';
  end if;

  -- 10. Changement de type sans erreur ni fuite pour le propriétaire ------------
  perform public.owner_upsert_item(owner_s, 'Vélo', group_item_id, null, 300, null, null, 'single');
  perform public.owner_upsert_item(owner_s, 'Vélo', group_item_id, null, 300, null, null, 'group');

  -- 11. Suppression / cascade ---------------------------------------------------
  perform public.owner_delete_item(owner_s, item_id);
  perform public.owner_delete_list(owner_s);
  begin
    perform public.shared_get_list(share_s);
    raise exception 'ECHEC: la liste supprimée est encore accessible';
  exception when others then
    if sqlerrm <> 'not_found' then raise; end if;
  end;

  -- 12. Limites de création de listes -----------------------------------------
  -- Par visiteur (IP simulée via l'en-tête que Supabase fournit) : 5 par heure.
  perform set_config('request.headers', '{"cf-connecting-ip":"203.0.113.7"}', true);
  for n in 1..5 loop
    perform public.create_list('spam ' || n, 'autre');
  end loop;
  begin
    perform public.create_list('spam 6', 'autre');
    raise exception 'ECHEC: la limite par visiteur ne s''applique pas';
  exception when others then
    if sqlerrm <> 'rate_limited' then raise; end if;
  end;
  -- Un autre visiteur n'est pas bloqué...
  perform set_config('request.headers', '{"cf-connecting-ip":"203.0.113.8"}', true);
  perform public.create_list('autre visiteur', 'autre');
  -- ... mais le plafond global (40/heure) s'applique à tout le monde.
  for n in 1..60 loop
    perform set_config('request.headers', json_build_object('cf-connecting-ip', '198.51.100.' || n)::text, true);
    begin
      perform public.create_list('global ' || n, 'autre');
    exception when others then
      if sqlerrm <> 'rate_limited' then raise; end if;
      exit;
    end;
    if n = 60 then raise exception 'ECHEC: le plafond global ne s''applique pas'; end if;
  end loop;
  -- La table du journal reste inaccessible
  begin
    perform 1 from public.rate_events;
    raise exception 'ECHEC: rate_events lisible par anon';
  exception when insufficient_privilege then null; end;

  raise notice 'TOUS LES TESTS SONT PASSÉS';
end $$;

rollback;
