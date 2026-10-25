// Point d'entrée : vérifie la configuration puis démarre le routeur.
import { getClient, ConfigError } from './api.js';
import { startRouter } from './router.js';
import { homeView, notFoundView } from './views/home.js';
import { ownerView } from './views/owner.js';
import { sharedView } from './views/shared.js';
import { h } from './utils.js';
import { shell } from './views/ui.js';

const root = document.getElementById('app');

// Lien d'évitement : un <a href="#main"> casserait le routage par hash.
document.getElementById('skip')?.addEventListener('click', () => document.getElementById('main')?.focus());

const routes = [
  { re: /^#\/o\/([A-Za-z0-9_-]{32,128})$/, view: ownerView },
  { re: /^#\/s\/([A-Za-z0-9_-]{32,128})$/, view: sharedView },
  { re: /^#?\/?$/, view: homeView },
];

function setupScreen(message) {
  shell(root).append(
    h(
      'section',
      { class: 'empty', role: 'alert' },
      h('div', { class: 'empty-emoji', 'aria-hidden': 'true' }, '🛠️'),
      h('h1', null, 'Papillote n’est pas encore configuré'),
      h('p', null, message),
      h('p', null, 'Copie config.example.js en config.js, colle l’URL du projet Supabase et la clé « anon », puis recharge la page. Le README explique tout pas à pas.'),
    ),
  );
}

async function main() {
  try {
    await getClient();
  } catch (e) {
    if (e instanceof ConfigError) setupScreen(`Problème de configuration : ${e.message}.`);
    else setupScreen('Impossible de charger les bibliothèques nécessaires (supabase-js). Vérifie ta connexion internet.');
    return;
  }
  startRouter(root, routes, notFoundView);
}

main();
