// Page d'accueil : créer une liste, retrouver ses listes sur cet appareil.
import * as api from '../api.js';
import * as store from '../store.js';
import { navigate } from '../router.js';
import { setTheme, OCCASION_LABELS } from '../theme.js';
import { h, copyText, confirmDialog, toast, ownerLink } from '../utils.js';
import { shell, errorState } from './ui.js';

export async function homeView(root) {
  setTheme('autre');
  document.title = 'Papillote — tes listes de souhaits, sans spoiler';
  const main = shell(root);

  main.append(
    h(
      'section',
      { class: 'hero' },
      h('img', { class: 'hero-logo', src: 'assets/logo.svg', alt: '', width: 120, height: 80 }),
      h('h1', null, 'Papillote'),
      h(
        'p',
        { class: 'lead' },
        'Ta liste d’idées cadeaux, sans gâcher la surprise. Crée-la, envoie le lien à tes proches : ils réservent en direct, et toi tu ne vois jamais qui a pris quoi.',
      ),
    ),
    createForm(),
    myLists(),
    openByLink(),
    h(
      'section',
      { class: 'how' },
      h('h2', null, 'Comment ça marche ?'),
      h(
        'ol',
        null,
        h('li', null, 'Tu crées une liste et ajoutes tes idées (un lien produit suffit).'),
        h('li', null, 'Tu envoies le lien de partage à tes proches.'),
        h('li', null, 'Ils cliquent « Je le prends » ou participent à une cagnotte — tout le monde le voit en direct, sauf toi.'),
      ),
    ),
  );
}

function createForm() {
  const title = h('input', {
    id: 'new-title',
    type: 'text',
    required: true,
    maxlength: 120,
    placeholder: 'Ex. Noël 2026',
    autocomplete: 'off',
  });
  const error = h('p', { class: 'form-error', role: 'alert' });
  const submit = h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, 'Créer ma liste');

  const radios = Object.entries(OCCASION_LABELS).map(([value, { emoji, label }], i) =>
    h(
      'label',
      { class: 'choice' },
      h('input', { type: 'radio', name: 'occasion', value, checked: i === 0 }),
      h('span', { class: 'choice-body' }, h('span', { 'aria-hidden': 'true' }, emoji), label),
    ),
  );

  const form = h(
    'form',
    {
      class: 'card panel create',
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        error.textContent = '';
        const value = title.value.trim();
        if (!value) {
          error.textContent = 'Donne un nom à ta liste, par exemple « Noël 2026 ».';
          title.focus();
          return;
        }
        const occasion = form.elements.occasion.value;
        submit.disabled = true;
        try {
          const list = await api.createList(value, occasion);
          store.saveList(list);
          store.markNew(list.owner_secret);
          navigate(`#/o/${list.owner_secret}`);
        } catch (err) {
          error.textContent = err.message;
          submit.disabled = false;
        }
      },
    },
    h('h2', null, 'Créer une liste'),
    h('div', { class: 'field' }, h('label', { for: 'new-title' }, 'Nom de la liste'), title),
    h('fieldset', { class: 'field' }, h('legend', null, 'Occasion'), h('div', { class: 'choices' }, radios)),
    error,
    submit,
  );
  return form;
}

function myLists() {
  const lists = store.getLists();
  const section = h('section', { class: 'my-lists', 'aria-labelledby': 'my-lists-title' });
  section.append(h('h2', { id: 'my-lists-title' }, 'Mes listes sur cet appareil'));

  if (lists.length === 0) {
    section.append(
      h(
        'div',
        { class: 'empty small' },
        h('div', { class: 'empty-emoji', 'aria-hidden': 'true' }, '🎁'),
        h('p', null, 'Aucune liste ici pour l’instant. Crée la première ci-dessus, ou ouvre un lien propriétaire que tu as déjà.'),
      ),
    );
    return section;
  }

  section.append(
    h(
      'p',
      { class: 'notice notice-warn' },
      '⚠️ Ces listes ne sont mémorisées que dans ce navigateur. Garde ton lien propriétaire de côté (bouton « Copier mon lien ») : sans lui, tu perds la possibilité de modifier ta liste.',
    ),
  );

  const grid = h('div', { class: 'grid' });
  for (const l of lists) {
    const occ = OCCASION_LABELS[l.occasion] ?? OCCASION_LABELS.autre;
    const card = h(
      'article',
      { class: 'card list-card' },
      h('div', { class: 'list-card-title' }, h('span', { 'aria-hidden': 'true' }, occ.emoji), h('h3', null, l.title)),
      h(
        'div',
        { class: 'row wrap' },
        h('a', { class: 'btn btn-primary btn-small', href: `#/o/${l.owner_secret}` }, 'Modifier'),
        h(
          'button',
          {
            class: 'btn btn-ghost btn-small',
            type: 'button',
            onclick: async () => {
              toast((await copyText(ownerLink(l.owner_secret))) ? 'Lien propriétaire copié 🔑' : 'Copie impossible, ouvre la liste et copie-le à la main.');
            },
          },
          'Copier mon lien',
        ),
        h(
          'button',
          {
            class: 'btn btn-ghost btn-small',
            type: 'button',
            onclick: async () => {
              const ok = await confirmDialog({
                title: 'Oublier cette liste sur cet appareil ?',
                message:
                  'Elle ne sera pas supprimée en ligne, mais tu ne pourras plus la modifier d’ici sans ton lien propriétaire.',
                confirmLabel: 'Oublier',
                danger: true,
              });
              if (!ok) return;
              store.removeList(l.owner_secret);
              card.remove();
              if (!grid.children.length) navigate('#/');
            },
          },
          'Oublier',
        ),
      ),
    );
    grid.append(card);
  }
  section.append(grid);
  return section;
}

function openByLink() {
  const input = h('input', {
    id: 'open-link',
    type: 'text',
    placeholder: 'Colle ici ton lien propriétaire',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const msg = h('p', { class: 'form-error', role: 'alert' });
  return h(
    'form',
    {
      class: 'card panel',
      onsubmit: (e) => {
        e.preventDefault();
        msg.textContent = '';
        const v = input.value.trim();
        const owner = v.match(/#\/o\/([\w-]{32,128})/) ?? v.match(/^([\w-]{32,128})$/);
        if (owner) return navigate(`#/o/${owner[1]}`);
        msg.textContent = /#\/s\//.test(v)
          ? 'Ceci est un lien de partage. Ici, il faut ton lien propriétaire (celui qui permet de modifier).'
          : 'Lien non reconnu. Il doit ressembler à …#/o/xxxxxxxx.';
      },
    },
    h('h2', null, 'J’ai déjà un lien propriétaire'),
    h('div', { class: 'field' }, h('label', { for: 'open-link' }, 'Lien propriétaire'), input),
    msg,
    h('button', { class: 'btn btn-ghost', type: 'submit' }, 'Ouvrir ma liste'),
  );
}

export async function notFoundView(root) {
  setTheme('autre');
  document.title = 'Page introuvable — Papillote';
  shell(root).append(
    errorState({ title: 'Page introuvable', message: 'Ce lien ne ressemble à aucune page de Papillote. Vérifie qu’il est complet.' }),
  );
}
