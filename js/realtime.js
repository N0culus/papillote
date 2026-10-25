// Temps réel SANS fuite : Supabase Realtime *Broadcast*, jamais postgres_changes.
// Le canal porte un nom dérivé (SHA-256) du share_secret et le message ne contient
// AUCUNE donnée : c'est juste un signal "refresh". Chaque client re-télécharge via les RPC.
//
// Le propriétaire n'écoute JAMAIS ce canal : il envoie seulement le signal (via l'API REST
// de Realtime), pour que les invités voient ses modifications.

import { getClient, getConfig } from './api.js';
import { sha256Hex } from './utils.js';

async function channelName(shareSecret) {
  return `papillote-${(await sha256Hex(`papillote:v1:${shareSecret}`)).slice(0, 40)}`;
}

/**
 * Écoute le signal "refresh" d'une liste partagée.
 * onStatus(true|false) : canal connecté ou non (point vert "en direct").
 */
export async function subscribe(shareSecret, { onRefresh, onStatus }) {
  const sb = await getClient();
  const name = await channelName(shareSecret);
  const channel = sb
    .channel(name, { config: { broadcast: { self: false } } })
    .on('broadcast', { event: 'refresh' }, () => onRefresh())
    .subscribe((status) => onStatus(status === 'SUBSCRIBED'));
  return {
    close() {
      sb.removeChannel(channel);
    },
  };
}

/** Envoie le signal "refresh" (sans donnée). N'échoue jamais : le polling prend le relais. */
export async function notify(shareSecret) {
  try {
    const { url, key } = await getConfig();
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        apikey: key,
        // les nouvelles clés "publishable" (sb_publishable_…) ne sont pas des JWT : apikey seul
        ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ topic: await channelName(shareSecret), event: 'refresh', payload: {}, private: false }],
      }),
      referrerPolicy: 'no-referrer',
    });
  } catch {
    /* le rafraîchissement de secours (30 s) rattrapera */
  }
}
