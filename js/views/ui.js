// Éléments d'interface partagés entre les vues.
import { h } from '../utils.js';

/** Crée en-tête + <main> + pied de page dans root, renvoie <main>. */
export function shell(root, { headerRight = null } = {}) {
  const header = h(
    'header',
    { class: 'site-header' },
    h(
      'a',
      { class: 'brand', href: '#/', 'aria-label': 'Papillote, accueil' },
      h('img', { src: 'assets/logo.svg', alt: '', width: 44, height: 29 }),
      h('span', null, 'Papillote'),
    ),
    headerRight,
  );
  const main = h('main', { id: 'main', class: 'container', tabindex: '-1' });
  const footer = h(
    'footer',
    { class: 'site-footer' },
    'Papillote — gratuit, sans compte, sans pub. Fait avec ♥ pour garder les surprises.',
  );
  root.append(header, main, footer);
  return main;
}

export function skeletonCards(n = 3) {
  return h(
    'div',
    { class: 'grid', 'aria-hidden': 'true' },
    Array.from({ length: n }, () =>
      h('div', { class: 'card skeleton-card' }, h('div', { class: 'skeleton sk-img' }), h('div', { class: 'skeleton sk-line' }), h('div', { class: 'skeleton sk-line short' })),
    ),
  );
}

export function errorState({ title, message, retry }) {
  return h(
    'section',
    { class: 'empty', role: 'alert' },
    h('div', { class: 'empty-emoji', 'aria-hidden': 'true' }, '🍬'),
    h('h2', null, title),
    h('p', null, message),
    h(
      'div',
      { class: 'row center' },
      retry ? h('button', { class: 'btn btn-primary', type: 'button', onclick: retry }, 'Réessayer') : null,
      h('a', { class: 'btn btn-ghost', href: '#/' }, 'Retour à l’accueil'),
    ),
  );
}
