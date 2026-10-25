// Couche d'accès à Supabase : uniquement des appels RPC + l'Edge Function.
// IMPORTANT : on ne logue jamais les arguments (ils contiennent des secrets).

const SUPABASE_JS_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

const MESSAGES = {
  not_found: 'Lien introuvable, ou élément supprimé entre-temps.',
  invalid_input: 'Certaines informations ne sont pas valides. Vérifie les champs.',
  already_taken: 'Oups, quelqu’un vient de le prendre !',
  limit_reached: 'Limite atteinte (100 articles par liste, 100 réservations par article).',
  network: 'Connexion impossible. Vérifie ta connexion et réessaie.',
  unknown: 'Une erreur est survenue. Réessaie dans un instant.',
};

export class ApiError extends Error {
  constructor(code) {
    super(MESSAGES[code] ?? MESSAGES.unknown);
    this.code = MESSAGES[code] ? code : 'unknown';
  }
}

export class ConfigError extends Error {}

let client = null;
let config = null;

async function loadConfig() {
  let mod;
  try {
    mod = await import('../config.js');
  } catch {
    throw new ConfigError('config.js introuvable');
  }
  const { SUPABASE_URL: url, SUPABASE_ANON_KEY: key } = mod;
  if (!url || !key || /VOTRE/i.test(url + key)) throw new ConfigError('config.js non rempli');
  try {
    if (new URL(url).protocol !== 'https:') throw new Error();
  } catch {
    throw new ConfigError('SUPABASE_URL invalide');
  }
  return { url: url.replace(/\/+$/, ''), key };
}

export async function getConfig() {
  if (!config) config = await loadConfig();
  return config;
}

export async function getClient() {
  if (client) return client;
  const { url, key } = await getConfig();
  const { createClient } = await import(SUPABASE_JS_CDN);
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 5 } },
  });
  return client;
}

async function rpc(name, args) {
  const sb = await getClient();
  let res;
  try {
    res = await sb.rpc(name, args);
  } catch {
    throw new ApiError('network');
  }
  if (res.error) {
    const msg = (res.error.message ?? '').trim();
    if (MESSAGES[msg]) throw new ApiError(msg);
    throw new ApiError(/fetch|network/i.test(msg) ? 'network' : 'unknown');
  }
  return res.data;
}

// ---- Propriétaire -----------------------------------------------------------

export const createList = (title, occasion) =>
  rpc('create_list', { p_title: title, p_occasion: occasion });

export const ownerGetList = (ownerSecret) => rpc('owner_get_list', { p_owner_secret: ownerSecret });

export const ownerUpdateList = (ownerSecret, title, occasion) =>
  rpc('owner_update_list', { p_owner_secret: ownerSecret, p_title: title, p_occasion: occasion });

export const ownerDeleteList = (ownerSecret) =>
  rpc('owner_delete_list', { p_owner_secret: ownerSecret });

export const ownerUpsertItem = (ownerSecret, item) =>
  rpc('owner_upsert_item', {
    p_owner_secret: ownerSecret,
    p_item_id: item.id ?? null,
    p_title: item.title,
    p_url: item.url || null,
    p_price: item.price ?? null,
    p_note: item.note || null,
    p_image_url: item.image_url || null,
    p_kind: item.kind,
  });

export const ownerDeleteItem = (ownerSecret, itemId) =>
  rpc('owner_delete_item', { p_owner_secret: ownerSecret, p_item_id: itemId });

export const ownerReorderItems = (ownerSecret, itemIds) =>
  rpc('owner_reorder_items', { p_owner_secret: ownerSecret, p_item_ids: itemIds });

// ---- Invités ----------------------------------------------------------------

export const sharedGetList = (shareSecret) => rpc('shared_get_list', { p_share_secret: shareSecret });

export const sharedReserve = (shareSecret, itemId, name, amount = null) =>
  rpc('shared_reserve', {
    p_share_secret: shareSecret,
    p_item_id: itemId,
    p_name: name,
    p_amount: amount,
  });

export const sharedCancel = (shareSecret, reservationId, cancelToken) =>
  rpc('shared_cancel_reservation', {
    p_share_secret: shareSecret,
    p_reservation_id: reservationId,
    p_cancel_token: cancelToken,
  });

// ---- Aperçu de lien produit (jamais bloquant) ---------------------------------

/** Renvoie { title, image, price } ou null si l'info n'a pas pu être récupérée. */
export async function fetchProductInfo(url) {
  try {
    const sb = await getClient();
    const { data, error } = await sb.functions.invoke('fetch-product-info', { body: { url } });
    if (error || !data || !data.ok) return null;
    return { title: data.title ?? null, image: data.image ?? null, price: data.price ?? null };
  } catch {
    return null;
  }
}
