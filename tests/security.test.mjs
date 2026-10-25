// Test de bout en bout contre ton vrai projet Supabase (via l'API REST publique).
// Prouve que :
//   1. les tables sont inaccessibles directement avec la clé anon ;
//   2. le propriétaire ne reçoit aucune information de réservation ;
//   3. 25 réservations SIMULTANÉES du même article 'single' => exactement 1 réussit ;
//   4. une cagnotte accepte bien plusieurs participations en parallèle.
//
// Usage (Node 18+ requis, aucune dépendance) :
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=eyJ... node tests/security.test.mjs
//
// Le test crée une liste temporaire puis la supprime à la fin.

const URL_ = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_ANON_KEY ?? '';
if (!URL_ || !KEY) {
  console.error('Définis SUPABASE_URL et SUPABASE_ANON_KEY (voir en-tête du fichier).');
  process.exit(2);
}

const headers = {
  apikey: KEY,
  ...(KEY.startsWith('eyJ') ? { Authorization: `Bearer ${KEY}` } : {}), // clés "publishable" : apikey seul
  'Content-Type': 'application/json',
};
let failures = 0;

function check(ok, label, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function rpc(name, args) {
  const res = await fetch(`${URL_}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(args) });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: res.ok, status: res.status, body };
}

async function main() {
  // 1. Accès direct aux tables ---------------------------------------------------
  for (const table of ['lists', 'items', 'reservations']) {
    const res = await fetch(`${URL_}/rest/v1/${table}?select=*`, { headers });
    const body = await res.json().catch(() => null);
    const empty = Array.isArray(body) && body.length === 0;
    check(!res.ok || empty, `Lecture directe de "${table}" refusée ou vide (HTTP ${res.status})`);
    const ins = await fetch(`${URL_}/rest/v1/${table}`, { method: 'POST', headers, body: JSON.stringify({ title: 'pirate' }) });
    check(!ins.ok, `Insertion directe dans "${table}" refusée (HTTP ${ins.status})`);
  }

  // 2. Préparation ----------------------------------------------------------------
  const created = await rpc('create_list', { p_title: 'Test sécurité', p_occasion: 'autre' });
  if (!created.ok) throw new Error(`create_list a échoué: ${JSON.stringify(created.body)}`);
  const { owner_secret: owner, share_secret: share } = created.body;
  check(owner.length >= 32 && share.length >= 32, `Secrets longs (${owner.length} et ${share.length} caractères)`);

  const single = await rpc('owner_upsert_item', { p_owner_secret: owner, p_title: 'Casque', p_kind: 'single', p_price: 50 });
  const group = await rpc('owner_upsert_item', { p_owner_secret: owner, p_title: 'Vélo', p_kind: 'group', p_price: 400 });
  const singleId = single.body.id;
  const groupId = group.body.id;

  // 3. Concurrence : 25 réservations simultanées du même article -------------------
  const names = Array.from({ length: 25 }, (_, i) => `Invite${String(i).padStart(2, '0')}`);
  const results = await Promise.all(
    names.map((n) => rpc('shared_reserve', { p_share_secret: share, p_item_id: singleId, p_name: n, p_amount: null })),
  );
  const winners = results.filter((r) => r.ok);
  const losers = results.filter((r) => !r.ok && r.body?.message === 'already_taken');
  check(winners.length === 1, `Réservations simultanées d'un article 'single' : ${winners.length} réussie(s) sur 25 (attendu : 1)`);
  check(losers.length === 24, `Les 24 autres reçoivent "already_taken" (${losers.length})`);

  // 4. Cagnotte : plusieurs participations en parallèle ----------------------------
  const pots = await Promise.all(
    ['Ana', 'Ben', 'Cléo', 'Dan', 'Eva'].map((n) =>
      rpc('shared_reserve', { p_share_secret: share, p_item_id: groupId, p_name: n, p_amount: 20 }),
    ),
  );
  check(pots.every((r) => r.ok), 'Cagnotte : 5 participations simultanées acceptées');

  // 5. Le propriétaire ne voit rien ---------------------------------------------------
  const ownerView = await rpc('owner_get_list', { p_owner_secret: owner });
  const text = JSON.stringify(ownerView.body);
  check(!names.some((n) => text.includes(n)) && !/Ana|Ben|Cléo|Dan|Eva/.test(text), 'owner_get_list ne contient aucun nom d\'invité');
  check(!/reserv|taken|cancel|amount/i.test(text), 'owner_get_list ne contient aucun champ de réservation');

  // 6. Les invités, eux, voient tout -------------------------------------------------------
  const guestView = await rpc('shared_get_list', { p_share_secret: share });
  const gtext = JSON.stringify(guestView.body);
  check(gtext.includes(winners.length ? 'Invite' : '???') && gtext.includes('Ana'), 'shared_get_list affiche les réservations');
  check(!/cancel_token/.test(gtext), 'shared_get_list ne renvoie jamais les jetons d\'annulation');

  // 7. Mauvais secrets -----------------------------------------------------------------------
  const wrong1 = await rpc('owner_get_list', { p_owner_secret: share });
  const wrong2 = await rpc('shared_get_list', { p_share_secret: owner });
  check(!wrong1.ok && !wrong2.ok, 'Un secret ne fonctionne pas à la place de l\'autre');

  // Nettoyage ----------------------------------------------------------------------------------
  const del = await rpc('owner_delete_list', { p_owner_secret: owner });
  check(del.ok, 'Liste de test supprimée');
}

main()
  .catch((e) => {
    console.error('Erreur inattendue :', e.message);
    failures++;
  })
  .finally(() => {
    console.log(failures === 0 ? '\n🎉 Tous les tests sont passés.' : `\n${failures} test(s) en échec.`);
    process.exit(failures === 0 ? 0 : 1);
  });
