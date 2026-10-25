// Routage par hash (#/...) : GitHub Pages n'a pas de routage côté serveur.
// Chaque vue : async (root, params, ctx) => fonction de nettoyage (optionnelle).
// ctx.alive() devient faux dès que l'utilisateur a changé de page (évite les rendus périmés).

export function navigate(hash) {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
}

export function startRouter(root, routes, notFoundView) {
  let cleanup = null;
  let token = 0;

  async function render() {
    const mine = ++token;
    if (cleanup) {
      try {
        cleanup();
      } catch {
        /* ignore */
      }
      cleanup = null;
    }
    root.replaceChildren();
    window.scrollTo(0, 0);

    const ctx = { alive: () => mine === token };
    const hash = location.hash || '#/';
    let view = notFoundView;
    let params = {};
    for (const route of routes) {
      const m = hash.match(route.re);
      if (m) {
        view = route.view;
        params = { secret: m[1] };
        break;
      }
    }

    const result = await view(root, params, ctx);
    if (typeof result === 'function') {
      if (ctx.alive()) cleanup = result;
      else result();
    }
  }

  window.addEventListener('hashchange', render);
  return render();
}
