// Stockage local (localStorage) : listes de cet appareil, prénom, jetons d'annulation.
// Tout est enveloppé dans try/catch : le navigateur peut bloquer le stockage.

const K_LISTS = 'papillote.lists.v1';
const K_NAME = 'papillote.name.v1';
const K_RES = 'papillote.reservations.v1';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// ---- Listes du propriétaire (contiennent les deux secrets) -----------------

export function getLists() {
  const lists = read(K_LISTS, []);
  return Array.isArray(lists) ? lists.filter((l) => l && l.owner_secret) : [];
}

export function saveList({ owner_secret, share_secret, title, occasion }) {
  const lists = getLists();
  const entry = { owner_secret, share_secret, title, occasion };
  const i = lists.findIndex((l) => l.owner_secret === owner_secret);
  if (i >= 0) lists[i] = { ...lists[i], ...entry };
  else lists.unshift(entry);
  return write(K_LISTS, lists);
}

export function removeList(owner_secret) {
  return write(
    K_LISTS,
    getLists().filter((l) => l.owner_secret !== owner_secret),
  );
}

/** Si ce lien de partage est celui d'une de MES listes, la renvoie. */
export function findByShareSecret(share_secret) {
  return getLists().find((l) => l.share_secret === share_secret) ?? null;
}

// Liste tout juste créée (en mémoire seulement) : sert à afficher le bandeau d'accueil.
const justCreated = new Set();
export const markNew = (secret) => justCreated.add(secret);
export const consumeNew = (secret) => justCreated.delete(secret);

// ---- Invités ------------------------------------------------------------------

export const getName = () => {
  const n = read(K_NAME, '');
  return typeof n === 'string' ? n : '';
};
export const setName = (name) => write(K_NAME, String(name).slice(0, 40));

export function addReservation(id, cancelToken) {
  const all = read(K_RES, {});
  all[id] = cancelToken;
  return write(K_RES, all);
}
export const getCancelToken = (id) => read(K_RES, {})[id] ?? null;
export const isMine = (id) => getCancelToken(id) !== null;
export function removeReservation(id) {
  const all = read(K_RES, {});
  delete all[id];
  return write(K_RES, all);
}
