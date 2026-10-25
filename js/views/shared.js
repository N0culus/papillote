// Vue invité (lien de partage) : voir la liste, réserver, annuler, cagnottes, temps réel.
import * as api from '../api.js';
import * as store from '../store.js';
import * as realtime from '../realtime.js';
import { navigate } from '../router.js';
import { setTheme, burst, OCCASION_LABELS } from '../theme.js';
import { h, formatPrice, hostOf, toast, announce, debounce } from '../utils.js';
import { shell, skeletonCards, errorState } from './ui.js';

const FALLBACK_REFRESH_MS = 30_000;

export async function sharedView(root, { secret }, ctx) {
  // Garde-fou "spoil" : si ce lien de partage est celui d'une de MES listes, on ne
  // télécharge même pas les réservations.
  const mine = store.findByShareSecret(secret);
  if (mine) {
    setTheme(mine.occasion);
    document.title = 'Attention — c’est ta liste — Papillote';
    shell(root).append(
      h(
        'section',
        { class: 'empty spoil', role: 'alert' },
        h('div', { class: 'empty-emoji', 'aria-hidden': 'true' }, '🙈'),
        h('h1', null, 'Attention, c’est ta liste : la surprise serait gâchée'),
        h('p', null, `Tu as ouvert le lien de partage de « ${mine.title} ». Pour ne rien découvrir, les réservations ne sont pas affichées.`),
        h('a', { class: 'btn btn-primary btn-lg', href: `#/o/${mine.owner_secret}` }, 'Revenir à l’édition de ma liste'),
      ),
    );
    return;
  }

  setTheme('autre');
  document.title = 'Liste de souhaits — Papillote';

  const liveDot = h('span', { class: 'live', 'data-on': 'false' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', { class: 'live-text' }, 'Connexion…'));
  const main = shell(root, { headerRight: liveDot });
  main.append(skeletonCards(3));

  let data;
  try {
    data = await api.sharedGetList(secret);
  } catch (e) {
    if (!ctx.alive()) return;
    main.replaceChildren(
      errorState({
        title: e.code === 'not_found' ? 'Liste introuvable' : 'Impossible de charger la liste',
        message:
          e.code === 'not_found'
            ? 'Ce lien ne correspond à aucune liste : elle a peut-être été supprimée, ou le lien est incomplet.'
            : e.message,
        retry: e.code === 'not_found' ? null : () => navigate(location.hash),
      }),
    );
    return;
  }
  if (!ctx.alive()) return;

  // ---------------------------------------------------------------- état local
  let signature = JSON.stringify(data);
  let seq = 0;
  const amounts = new Map(); // montants en cours de saisie, conservés entre deux rendus

  const nameInput = h('input', {
    id: 'guest-name',
    type: 'text',
    maxlength: 40,
    autocomplete: 'given-name',
    placeholder: 'Ton prénom',
    value: store.getName(),
  });
  nameInput.addEventListener('input', debounce(() => store.setName(nameInput.value.trim()), 300));

  const heroEl = h('section', { class: 'guest-hero' });
  const itemsEl = h('div', { class: 'grid items-grid' });

  main.replaceChildren(
    heroEl,
    h(
      'div',
      { class: 'card panel name-bar' },
      h('label', { for: 'guest-name' }, 'Ton prénom (pour réserver)'),
      nameInput,
      h('small', { class: 'hint' }, 'Il sera visible des autres invités, pas de la personne qui reçoit les cadeaux.'),
    ),
    itemsEl,
  );

  // ------------------------------------------------------------------- rendu
  function render() {
    setTheme(data.occasion);
    document.title = `${data.title} — Papillote`;
    const occ = OCCASION_LABELS[data.occasion] ?? OCCASION_LABELS.autre;
    heroEl.replaceChildren(
      h('h1', null, h('span', { 'aria-hidden': 'true' }, `${occ.emoji} `), data.title),
      h('p', { class: 'lead' }, 'Choisis un cadeau et clique « Je le prends » : les autres invités le voient tout de suite, pour éviter les doublons. Chut, la personne concernée ne verra rien !'),
    );

    const active = document.activeElement?.id;
    itemsEl.replaceChildren();
    if (data.items.length === 0) {
      itemsEl.append(
        h('div', { class: 'empty' }, h('div', { class: 'empty-emoji', 'aria-hidden': 'true' }, '🍬'), h('h2', null, 'Rien dans la liste pour l’instant'), h('p', null, 'Repasse bientôt : de nouvelles idées arriveront peut-être.')),
      );
    } else {
      data.items.forEach((item) => itemsEl.append(itemCard(item)));
    }
    if (active && active !== 'guest-name') document.getElementById(active)?.focus({ preventScroll: true });
  }

  function itemCard(item) {
    const res = item.reservations;
    const taken = item.kind === 'single' && res.length > 0;
    const media = item.image_url
      ? h('img', { src: item.image_url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => e.target.replaceWith(h('div', { class: 'item-media-empty', 'aria-hidden': 'true' }, '🎁')) })
      : h('div', { class: 'item-media-empty', 'aria-hidden': 'true' }, '🎁');

    return h(
      'article',
      { class: `card item-card${taken ? ' is-taken' : ''}`, 'aria-labelledby': `t-${item.id}` },
      h('div', { class: 'item-media' }, media),
      h(
        'div',
        { class: 'item-body' },
        h('h2', { id: `t-${item.id}`, class: 'item-title' }, item.title),
        h(
          'div',
          { class: 'meta' },
          item.price != null ? h('span', { class: 'price' }, formatPrice(item.price)) : null,
          item.kind === 'group' ? h('span', { class: 'badge badge-group' }, 'Cadeau à plusieurs') : null,
        ),
        item.note ? h('p', { class: 'note' }, item.note) : null,
        item.url
          ? h('a', { class: 'product-link', href: item.url, target: '_blank', rel: 'noopener noreferrer nofollow' }, `Voir le produit (${hostOf(item.url)}) ↗`)
          : null,
      ),
      h('div', { class: 'item-foot' }, item.kind === 'group' ? groupFoot(item) : singleFoot(item)),
    );
  }

  function singleFoot(item) {
    const r = item.reservations[0];
    if (!r) {
      const btn = h('button', { id: `b-${item.id}`, class: 'btn btn-primary btn-block', type: 'button', onclick: () => reserve(item, btn) }, 'Je le prends 🎁');
      return btn;
    }
    if (store.isMine(r.id)) {
      return h(
        'div',
        { class: 'state' },
        h('span', { class: 'badge badge-mine' }, '✓ Tu le prends'),
        h('button', { id: `c-${r.id}`, class: 'btn btn-ghost btn-small', type: 'button', onclick: (e) => cancel(r, e.currentTarget) }, 'Annuler ma réservation'),
      );
    }
    return h('div', { class: 'state' }, h('span', { class: 'badge badge-taken' }, `Réservé par ${r.taker_name}`));
  }

  function groupFoot(item) {
    const total = item.reservations.reduce((s, r) => s + Number(r.amount ?? 0), 0);
    const target = Number(item.price ?? 0);
    const pct = target > 0 ? Math.min(100, Math.round((total / target) * 100)) : 0;
    const complete = target > 0 && total >= target;

    const bar = h(
      'div',
      { class: 'progress', role: 'progressbar', 'aria-label': `Cagnotte « ${item.title} »`, 'aria-valuemin': 0, 'aria-valuemax': target || total, 'aria-valuenow': total, 'aria-valuetext': `${formatPrice(total)} réunis sur ${formatPrice(target)}` },
      h('div', { class: 'progress-fill', style: { width: `${pct}%` } }),
    );

    const people = item.reservations.length
      ? h(
          'ul',
          { class: 'participants' },
          item.reservations.map((r) =>
            h(
              'li',
              null,
              h('span', null, `${r.taker_name} — ${formatPrice(r.amount)}`),
              store.isMine(r.id) ? h('button', { id: `c-${r.id}`, class: 'link-btn', type: 'button', onclick: (e) => cancel(r, e.currentTarget) }, 'Annuler') : null,
            ),
          ),
        )
      : h('p', { class: 'muted' }, 'Personne n’a encore participé.');

    const input = h('input', { id: `a-${item.id}`, type: 'number', min: '0.01', max: '1000000', step: '0.01', inputmode: 'decimal', placeholder: '€', value: amounts.get(item.id) ?? '' });
    input.addEventListener('input', () => amounts.set(item.id, input.value));
    const btn = h('button', { id: `b-${item.id}`, class: 'btn btn-primary', type: 'submit' }, 'Participer');
    const form = h(
      'form',
      {
        class: 'row participate',
        novalidate: true,
        onsubmit: (e) => {
          e.preventDefault();
          const amount = Number(input.value);
          if (!(amount > 0)) {
            toast('Indique un montant supérieur à 0.', 'warn');
            return input.focus();
          }
          reserve(item, btn, amount);
        },
      },
      h('label', { class: 'sr-only', for: `a-${item.id}` }, `Ta participation en euros pour « ${item.title} »`),
      input,
      btn,
    );

    return h(
      'div',
      { class: 'group-foot' },
      bar,
      h('p', { class: 'progress-text' }, target > 0 ? `${formatPrice(total)} réunis sur ${formatPrice(target)}${complete ? ' 🎉' : ` (${pct} %)`}` : `${formatPrice(total)} réunis`),
      people,
      form,
    );
  }

  // ----------------------------------------------------------------- actions
  async function reserve(item, btn, amount = null) {
    const name = nameInput.value.trim();
    if (!name) {
      toast('Dis-nous d’abord ton prénom 😊', 'warn');
      nameInput.focus();
      nameInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    store.setName(name);
    btn.disabled = true;
    try {
      const r = await api.sharedReserve(secret, item.id, name, amount);
      store.addReservation(r.reservation_id, r.cancel_token);
      amounts.delete(item.id);
      burst(btn);
      toast(item.kind === 'group' ? 'Merci pour ta participation ! 🎉' : 'C’est noté, tu le prends ! 🎉', 'success');
      realtime.notify(secret);
      await refresh({ force: true, quiet: true });
    } catch (e) {
      toast(e.message, 'error');
      if (e.code === 'already_taken' || e.code === 'not_found') await refresh({ force: true, quiet: true });
      else btn.disabled = false;
    }
  }

  async function cancel(reservation, btn) {
    const token = store.getCancelToken(reservation.id);
    if (!token) return;
    btn.disabled = true;
    try {
      await api.sharedCancel(secret, reservation.id, token);
      store.removeReservation(reservation.id);
      toast('Réservation annulée');
      realtime.notify(secret);
    } catch (e) {
      if (e.code === 'not_found') store.removeReservation(reservation.id); // déjà annulée ailleurs
      else {
        toast(e.message, 'error');
        btn.disabled = false;
        return;
      }
    }
    await refresh({ force: true, quiet: true });
  }

  // ----------------------------------------------------------- rafraîchissement
  function reservationIndex(d) {
    const map = new Map();
    for (const item of d.items) for (const r of item.reservations) map.set(r.id, { who: r.taker_name, item: item.title, group: item.kind === 'group' });
    return map;
  }

  async function refresh({ force = false, quiet = false } = {}) {
    const my = ++seq;
    let next;
    try {
      next = await api.sharedGetList(secret);
    } catch (e) {
      if (e.code === 'not_found' && ctx.alive()) {
        main.replaceChildren(errorState({ title: 'Cette liste n’existe plus', message: 'Elle a été supprimée par son propriétaire.' }));
      }
      return; // erreur réseau passagère : on garde l'affichage actuel
    }
    if (!ctx.alive() || my !== seq) return;
    const sig = JSON.stringify(next);
    if (sig === signature && !force) return;

    const before = reservationIndex(data);
    const after = reservationIndex(next);
    signature = sig;
    data = next;
    render();

    if (!quiet) {
      const msgs = [];
      for (const [id, r] of after) if (!before.has(id) && !store.isMine(id)) msgs.push(`${r.who} ${r.group ? 'participe à' : 'a pris'} « ${r.item} »`);
      for (const [id, r] of before) if (!after.has(id) && !store.isMine(id)) msgs.push(`${r.who} a annulé « ${r.item} »`);
      if (msgs.length) {
        const text = msgs.length > 2 ? `${msgs.length} changements dans la liste` : msgs.join(' · ');
        toast(`En direct : ${text}`, 'live');
        announce(text);
      }
    }
  }

  // --------------------------------------------------------------- temps réel
  const softRefresh = debounce(() => refresh(), 250);
  const setLive = (on) => {
    liveDot.dataset.on = String(on);
    liveDot.querySelector('.live-text').textContent = on ? 'En direct' : 'Reconnexion…';
  };

  let sub = null;
  realtime
    .subscribe(secret, { onRefresh: softRefresh, onStatus: setLive })
    .then((s) => {
      if (ctx.alive()) sub = s;
      else s.close();
    })
    .catch(() => setLive(false));

  const timer = setInterval(() => refresh(), FALLBACK_REFRESH_MS);
  const onVisible = () => {
    if (document.visibilityState === 'visible') refresh();
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);

  render();

  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onVisible);
    sub?.close();
  };
}
