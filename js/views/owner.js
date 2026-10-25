// Vue propriétaire : édition de la liste. Ne montre ni n'écoute JAMAIS les réservations.
import * as api from '../api.js';
import * as store from '../store.js';
import * as realtime from '../realtime.js';
import { navigate } from '../router.js';
import { setTheme, OCCASION_LABELS } from '../theme.js';
import {
  h, formatPrice, hostOf, copyText, downloadText, confirmDialog, toast, announce, debounce,
  ownerLink, shareLink,
} from '../utils.js';
import { shell, skeletonCards, errorState } from './ui.js';

export async function ownerView(root, { secret }, ctx) {
  setTheme('autre');
  document.title = 'Ma liste — Papillote';
  const main = shell(root);
  main.append(skeletonCards(2));

  let list;
  try {
    list = await api.ownerGetList(secret);
  } catch (e) {
    if (!ctx.alive()) return;
    main.replaceChildren(
      errorState({
        title: e.code === 'not_found' ? 'Lien propriétaire introuvable' : 'Impossible de charger la liste',
        message:
          e.code === 'not_found'
            ? 'Ce lien ne correspond à aucune liste (supprimée ou lien incomplet). Si tu l’as copié, vérifie qu’il est entier.'
            : e.message,
        retry: e.code === 'not_found' ? null : () => navigate(location.hash),
      }),
    );
    return;
  }
  if (!ctx.alive()) return;

  const state = { list, editingId: null, formOpen: false };
  const isNew = store.consumeNew(secret);
  store.saveList({ owner_secret: secret, share_secret: list.share_secret, title: list.title, occasion: list.occasion });

  const sections = {
    top: h('div'),
    items: h('section', { 'aria-labelledby': 'items-title' }),
    form: h('div'),
  };
  main.replaceChildren(sections.top, sections.items, sections.form, dangerZone());

  function applyTheme() {
    setTheme(state.list.occasion);
    document.title = `${state.list.title} — Papillote`;
  }

  function notifyGuests() {
    realtime.notify(state.list.share_secret);
  }

  async function reload() {
    try {
      state.list = await api.ownerGetList(secret);
      store.saveList({ owner_secret: secret, share_secret: state.list.share_secret, title: state.list.title, occasion: state.list.occasion });
    } catch (e) {
      toast(e.message, 'error');
    }
    applyTheme();
    renderTop();
    renderItems();
  }

  // ------------------------------------------------------------------ en-tête
  function renderTop() {
    const l = state.list;
    const occ = OCCASION_LABELS[l.occasion] ?? OCCASION_LABELS.autre;
    const shareUrl = shareLink(l.share_secret);
    const ownUrl = ownerLink(secret);

    const shareInput = h('input', { id: 'share-url', type: 'text', readonly: true, value: shareUrl, 'aria-label': 'Lien de partage' });
    const ownerInput = h('input', { id: 'owner-url', type: 'text', readonly: true, value: ownUrl, 'aria-label': 'Lien propriétaire' });

    const titleBox = h('div', { class: 'title-row' });
    const renderTitle = () =>
      titleBox.replaceChildren(
        h('h1', null, h('span', { 'aria-hidden': 'true' }, `${occ.emoji} `), l.title),
        h('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: renderTitleForm }, 'Renommer'),
      );
    const renderTitleForm = () => {
      const t = h('input', { id: 'edit-title', type: 'text', required: true, maxlength: 120, value: l.title });
      const sel = h(
        'select',
        { id: 'edit-occasion' },
        Object.entries(OCCASION_LABELS).map(([v, o]) => h('option', { value: v, selected: v === l.occasion }, `${o.emoji} ${o.label}`)),
      );
      titleBox.replaceChildren(
        h(
          'form',
          {
            class: 'row wrap form-inline',
            onsubmit: async (e) => {
              e.preventDefault();
              if (!t.value.trim()) return t.focus();
              try {
                await api.ownerUpdateList(secret, t.value.trim(), sel.value);
                notifyGuests();
                await reload();
                toast('Liste mise à jour');
              } catch (err) {
                toast(err.message, 'error');
              }
            },
          },
          h('label', { class: 'sr-only', for: 'edit-title' }, 'Nom de la liste'),
          t,
          h('label', { class: 'sr-only', for: 'edit-occasion' }, 'Occasion'),
          sel,
          h('button', { class: 'btn btn-primary btn-small', type: 'submit' }, 'Enregistrer'),
          h('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: renderTitle }, 'Annuler'),
        ),
      );
      t.focus();
    };
    renderTitle();

    // replaceChildren() transformerait un null en texte "null" : on n'ajoute le bandeau que s'il existe
    const welcome = isNew
      ? h(
          'div',
          { class: 'notice notice-info', role: 'status' },
          h('strong', null, '🎉 Ta liste est créée ! '),
          'Première étape : enregistre ton lien propriétaire (carte « 🔑 » ci-dessous). C’est la seule façon de modifier ta liste plus tard.',
        )
      : [];
    sections.top.replaceChildren(
      ...[welcome].flat(),
      titleBox,
      h(
        'p',
        { class: 'notice notice-surprise' },
        '🤫 Tu ne verras jamais ce qui est réservé ni par qui : c’est la surprise. Tes proches, eux, le voient en direct.',
      ),
      h(
        'div',
        { class: 'link-grid' },
        h(
          'section',
          { class: 'card link-card link-share', 'aria-labelledby': 'share-h' },
          h('h2', { id: 'share-h' }, '🎁 Lien de partage'),
          h('p', null, 'À envoyer à tes proches : ils verront ta liste et pourront réserver. Ne l’ouvre pas toi-même !'),
          h('label', { class: 'sr-only', for: 'share-url' }, 'Lien de partage'),
          shareInput,
          h(
            'div',
            { class: 'row wrap' },
            h('button', { class: 'btn btn-primary btn-small', type: 'button', onclick: async () => toast((await copyText(shareUrl)) ? 'Lien de partage copié 🎁' : 'Copie impossible, sélectionne le lien à la main.') }, 'Copier le lien'),
            navigator.share
              ? h(
                  'button',
                  {
                    class: 'btn btn-ghost btn-small',
                    type: 'button',
                    onclick: async () => {
                      try {
                        await navigator.share({ title: `Ma liste « ${l.title} »`, text: `Voici ma liste de souhaits « ${l.title} » :`, url: shareUrl });
                      } catch {
                        /* partage annulé */
                      }
                    },
                  },
                  'Partager…',
                )
              : null,
          ),
        ),
        h(
          'section',
          { class: 'card link-card link-owner', 'aria-labelledby': 'owner-h' },
          h('h2', { id: 'owner-h' }, '🔑 Ton lien propriétaire — privé'),
          h('p', { class: 'warn-text' }, 'Ne le partage jamais. Sans ce lien, tu perds la possibilité de modifier ta liste (il est aussi mémorisé dans ce navigateur).'),
          h('label', { class: 'sr-only', for: 'owner-url' }, 'Lien propriétaire'),
          ownerInput,
          h(
            'div',
            { class: 'row wrap' },
            h('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: async () => toast((await copyText(ownUrl)) ? 'Lien propriétaire copié 🔑' : 'Copie impossible, sélectionne le lien à la main.') }, 'Copier'),
            h(
              'button',
              {
                class: 'btn btn-ghost btn-small',
                type: 'button',
                onclick: () => {
                  downloadText(
                    'papillote-lien-proprietaire.txt',
                    `Papillote — lien PROPRIÉTAIRE de « ${l.title} »\nGarde-le privé : il permet de modifier ta liste.\n\n${ownUrl}\n`,
                  );
                  toast('Fichier enregistré');
                },
              },
              'Enregistrer en fichier',
            ),
          ),
        ),
      ),
    );
  }

  // ----------------------------------------------------------- liste d'articles
  function renderItems() {
    const items = state.list.items;
    const head = h(
      'div',
      { class: 'section-head' },
      h('h2', { id: 'items-title' }, `Mes idées (${items.length})`),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openForm(null) }, '＋ Ajouter une idée'),
    );

    if (items.length === 0) {
      sections.items.replaceChildren(
        head,
        h(
          'div',
          { class: 'empty' },
          h('div', { class: 'empty-emoji', 'aria-hidden': 'true' }, '🍬'),
          h('h3', null, 'Ta liste est encore vide'),
          h('p', null, 'Ajoute ta première idée : colle un lien produit, Papillote essaiera de remplir le reste.'),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openForm(null) }, 'Ajouter une idée'),
        ),
      );
      return;
    }

    const ul = h('ul', { class: 'edit-list' });
    items.forEach((item, index) => ul.append(editRow(item, index, items.length, ul)));
    sections.items.replaceChildren(
      head,
      h('p', { class: 'hint' }, 'Glisse les cartes (☰) pour les réordonner, ou utilise les flèches.'),
      ul,
    );
  }

  function editRow(item, index, total, ul) {
    const li = h(
      'li',
      { class: 'card edit-item', draggable: 'true', 'data-id': item.id },
      h('span', { class: 'handle', 'aria-hidden': 'true', title: 'Glisser pour réordonner' }, '☰'),
      item.image_url
        ? h('img', { class: 'thumb', src: item.image_url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => e.target.remove() })
        : h('div', { class: 'thumb thumb-empty', 'aria-hidden': 'true' }, '🎁'),
      h(
        'div',
        { class: 'edit-info' },
        h('strong', null, item.title),
        h(
          'div',
          { class: 'meta' },
          item.price != null ? h('span', null, formatPrice(item.price)) : null,
          item.kind === 'group' ? h('span', { class: 'badge badge-group' }, 'Cagnotte') : null,
          item.url ? h('span', { class: 'muted' }, hostOf(item.url)) : null,
        ),
      ),
      h(
        'div',
        { class: 'row wrap actions' },
        h('button', { class: 'btn btn-ghost btn-small', type: 'button', disabled: index === 0, 'aria-label': `Monter « ${item.title} »`, onclick: () => move(item.id, -1) }, '↑'),
        h('button', { class: 'btn btn-ghost btn-small', type: 'button', disabled: index === total - 1, 'aria-label': `Descendre « ${item.title} »`, onclick: () => move(item.id, 1) }, '↓'),
        h('button', { class: 'btn btn-ghost btn-small', type: 'button', 'aria-label': `Modifier « ${item.title} »`, onclick: () => openForm(item) }, 'Modifier'),
        h('button', { class: 'btn btn-ghost btn-small btn-danger-text', type: 'button', 'aria-label': `Supprimer « ${item.title} »`, onclick: () => remove(item) }, 'Supprimer'),
      ),
    );

    // Glisser-déposer (souris) ; les flèches couvrent clavier et tactile.
    li.addEventListener('dragstart', (e) => {
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', item.id);
    });
    li.addEventListener('dragend', () => {
      li.classList.remove('dragging');
      persistOrder(ul);
    });
    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      const dragging = ul.querySelector('.dragging');
      if (!dragging || dragging === li) return;
      const rect = li.getBoundingClientRect();
      ul.insertBefore(dragging, e.clientY < rect.top + rect.height / 2 ? li : li.nextSibling);
    });
    return li;
  }

  async function persistOrder(ul) {
    const ids = [...ul.children].map((li) => li.dataset.id);
    if (ids.join() === state.list.items.map((i) => i.id).join()) return;
    state.list.items.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    try {
      await api.ownerReorderItems(secret, ids);
      notifyGuests();
      announce('Ordre enregistré');
    } catch (e) {
      toast(e.message, 'error');
      reload();
    }
  }

  async function move(id, delta) {
    const items = state.list.items;
    const i = items.findIndex((x) => x.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    renderItems();
    document.querySelector(`[data-id="${id}"] .actions button:nth-child(${delta < 0 ? 1 : 2})`)?.focus();
    try {
      await api.ownerReorderItems(secret, items.map((x) => x.id));
      notifyGuests();
      announce(`« ${items[j].title} » déplacé`);
    } catch (e) {
      toast(e.message, 'error');
      reload();
    }
  }

  async function remove(item) {
    const ok = await confirmDialog({
      title: 'Supprimer cette idée ?',
      message: `« ${item.title} » sera retirée de ta liste.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.ownerDeleteItem(secret, item.id);
      notifyGuests();
      toast('Idée supprimée');
      await reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ------------------------------------------------------------- formulaire
  function openForm(item) {
    state.editingId = item?.id ?? null;
    const v = { title: item?.title ?? '', url: item?.url ?? '', price: item?.price ?? '', note: item?.note ?? '', image_url: item?.image_url ?? '', kind: item?.kind ?? 'single' };

    const f = {
      url: h('input', { id: 'f-url', type: 'url', maxlength: 2000, placeholder: 'https://…', value: v.url, autocomplete: 'off' }),
      title: h('input', { id: 'f-title', type: 'text', required: true, maxlength: 200, value: v.title }),
      price: h('input', { id: 'f-price', type: 'number', min: '0', max: '1000000', step: '0.01', inputmode: 'decimal', value: v.price }),
      note: h('textarea', { id: 'f-note', maxlength: 1000, rows: 3, placeholder: 'Taille, couleur, version précise…' }),
      image: h('input', { id: 'f-image', type: 'url', maxlength: 2000, placeholder: 'https://…', value: v.image_url, autocomplete: 'off' }),
    };
    f.note.value = v.note;

    const status = h('p', { class: 'hint', role: 'status' });
    const error = h('p', { class: 'form-error', role: 'alert' });
    const preview = h('div', { class: 'img-preview' });
    const drawPreview = () => {
      preview.replaceChildren();
      const src = f.image.value.trim();
      if (src) preview.append(h('img', { src, alt: 'Aperçu de l’image', referrerpolicy: 'no-referrer', onerror: (e) => e.target.remove() }));
    };
    drawPreview();
    f.image.addEventListener('input', debounce(drawPreview, 400));

    let lastFetched = '';
    const prefill = async () => {
      const url = f.url.value.trim();
      if (!/^https?:\/\//i.test(url) || url === lastFetched) return;
      lastFetched = url;
      status.textContent = 'Recherche des infos du produit…';
      const info = await api.fetchProductInfo(url);
      if (!ctx.alive() || f.url.value.trim() !== url) return;
      if (!info) {
        status.textContent = 'Impossible de lire cette page : remplis les champs à la main, ce n’est pas grave 🙂';
        return;
      }
      // on ne remplace jamais ce que la personne a déjà saisi
      if (info.title && !f.title.value.trim()) f.title.value = info.title;
      if (info.image && !f.image.value.trim()) {
        f.image.value = info.image;
        drawPreview();
      }
      if (info.price != null && f.price.value === '') f.price.value = String(info.price);
      status.textContent = 'Infos récupérées ✨ Vérifie-les avant d’enregistrer.';
    };
    f.url.addEventListener('paste', () => setTimeout(prefill, 0));
    f.url.addEventListener('change', prefill);

    const kindRadio = (value, label, hint) =>
      h(
        'label',
        { class: 'choice' },
        h('input', { type: 'radio', name: 'kind', value, checked: v.kind === value }),
        h('span', { class: 'choice-body col' }, h('strong', null, label), h('small', null, hint)),
      );

    const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, item ? 'Enregistrer' : 'Ajouter à ma liste');
    const form = h(
      'form',
      {
        class: 'card panel item-form',
        'aria-labelledby': 'form-title',
        novalidate: true,
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = '';
          const kind = form.elements.kind.value;
          const price = f.price.value === '' ? null : Number(f.price.value);
          if (!f.title.value.trim()) { error.textContent = 'Le titre est obligatoire.'; return f.title.focus(); }
          if (price != null && (Number.isNaN(price) || price < 0)) { error.textContent = 'Le prix doit être un nombre positif.'; return f.price.focus(); }
          if (kind === 'group' && !(price > 0)) { error.textContent = 'Une cagnotte a besoin d’un prix cible.'; return f.price.focus(); }
          for (const [el, name] of [[f.url, 'Le lien produit'], [f.image, 'L’image']]) {
            const val = el.value.trim();
            if (val && !/^https?:\/\/\S+$/i.test(val)) { error.textContent = `${name} doit commencer par http:// ou https://.`; return el.focus(); }
          }
          submit.disabled = true;
          try {
            await api.ownerUpsertItem(secret, {
              id: state.editingId,
              title: f.title.value.trim(),
              url: f.url.value.trim(),
              price,
              note: f.note.value.trim(),
              image_url: f.image.value.trim(),
              kind,
            });
            closeForm();
            notifyGuests();
            toast(item ? 'Idée mise à jour' : 'Idée ajoutée 🎁');
            await reload();
          } catch (err) {
            error.textContent = err.message;
            submit.disabled = false;
          }
        },
      },
      h('h2', { id: 'form-title' }, item ? 'Modifier l’idée' : 'Nouvelle idée'),
      h('div', { class: 'field' }, h('label', { for: 'f-url' }, 'Lien du produit (optionnel)'), f.url, h('small', { class: 'hint' }, 'Colle un lien : le titre, l’image et le prix seront récupérés si possible.'), status),
      h('div', { class: 'field' }, h('label', { for: 'f-title' }, 'Titre'), f.title),
      h('div', { class: 'field' }, h('label', { for: 'f-price' }, 'Prix en € (optionnel)'), f.price),
      h('div', { class: 'field' }, h('label', { for: 'f-note' }, 'Note (optionnel)'), f.note),
      h('div', { class: 'field' }, h('label', { for: 'f-image' }, 'Image (lien, optionnel)'), f.image, preview),
      h(
        'fieldset',
        { class: 'field' },
        h('legend', null, 'Type de cadeau'),
        h('div', { class: 'choices' }, kindRadio('single', 'Cadeau simple', 'Une seule personne le prend'), kindRadio('group', 'Cagnotte', 'Plusieurs participent, avec un montant (prix = objectif)')),
      ),
      error,
      h('div', { class: 'row end' }, h('button', { class: 'btn btn-ghost', type: 'button', onclick: closeForm }, 'Annuler'), submit),
    );
    sections.form.replaceChildren(form);
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    (item ? f.title : f.url).focus({ preventScroll: true });
  }

  function closeForm() {
    sections.form.replaceChildren();
    state.editingId = null;
  }

  // ------------------------------------------------------------- zone danger
  function dangerZone() {
    return h(
      'section',
      { class: 'danger-zone' },
      h('h2', null, 'Zone sensible'),
      h('p', null, 'Supprimer la liste l’efface définitivement, ainsi que toutes les réservations de tes proches.'),
      h(
        'button',
        {
          class: 'btn btn-danger btn-small',
          type: 'button',
          onclick: async () => {
            const ok = await confirmDialog({
              title: 'Supprimer toute la liste ?',
              message: `« ${state.list.title} » et toutes ses réservations seront effacées. C’est irréversible.`,
              confirmLabel: 'Supprimer la liste',
              danger: true,
            });
            if (!ok) return;
            try {
              await api.ownerDeleteList(secret);
              notifyGuests();
              store.removeList(secret);
              toast('Liste supprimée');
              navigate('#/');
            } catch (e) {
              toast(e.message, 'error');
            }
          },
        },
        'Supprimer cette liste',
      ),
    );
  }

  applyTheme();
  renderTop();
  renderItems();
}
