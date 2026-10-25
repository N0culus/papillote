// Utilitaires : construction DOM sûre, formats, presse-papier, toasts, dialogues.
// RÈGLE : aucun innerHTML. Tout contenu utilisateur passe par des nœuds texte.

const SAFE_PROTOCOLS = ['http:', 'https:'];

/** Renvoie l'URL normalisée si elle est http(s) (ou une route interne "#/..."), sinon null. */
export function safeUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  if (value.startsWith('#/')) return value;
  try {
    const u = new URL(value);
    return SAFE_PROTOCOLS.includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

function append(el, child) {
  if (child == null || child === false || child === true) return;
  if (Array.isArray(child)) child.forEach((c) => append(el, c));
  else if (child instanceof Node) el.appendChild(child);
  else el.appendChild(document.createTextNode(String(child)));
}

const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden']);

/**
 * h('div', { class: 'x', onclick: fn }, 'texte', autreNoeud)
 * - les enfants string sont toujours des nœuds texte (jamais interprétés comme HTML)
 * - href/src sont filtrés (http/https uniquement)
 * - les attributs on* ne sont acceptés que sous forme de fonction
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) {
      if (typeof value === 'function') el.addEventListener(key.slice(2), value);
    } else if (key === 'style') {
      for (const [prop, v] of Object.entries(value)) el.style.setProperty(prop, String(v));
    } else if (key === 'href' || key === 'src') {
      const safe = safeUrl(value);
      if (safe) el.setAttribute(key, safe);
    } else if (PROPS.has(key)) el[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

const priceFmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const priceFmtInt = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

export function formatPrice(n) {
  if (n == null || Number.isNaN(Number(n))) return '';
  const v = Number(n);
  return Number.isInteger(v) ? priceFmtInt.format(v) : priceFmt.format(v);
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function ownerLink(secret) {
  return `${location.origin}${location.pathname}#/o/${secret}`;
}
export function shareLink(secret) {
  return `${location.origin}${location.pathname}#/s/${secret}`;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { 'aria-hidden': 'true', readonly: true, class: 'offscreen' });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = h('a', { download: filename, class: 'offscreen' });
  a.href = url; // blob: URL générée par nous, pas par l'utilisateur
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Message visuel (dans une région aria-live="polite"). */
export function toast(message, kind = 'info') {
  const box = document.getElementById('toasts');
  if (!box) return;
  const el = h('div', { class: `toast toast-${kind}` }, message);
  box.appendChild(el);
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3800);
}

/** Annonce pour lecteurs d'écran uniquement. */
export function announce(message) {
  const live = document.getElementById('live');
  if (live) live.textContent = message;
}

export function confirmDialog({ title, message, confirmLabel = 'Confirmer', danger = false }) {
  return new Promise((resolve) => {
    if (typeof HTMLDialogElement === 'undefined') {
      resolve(window.confirm(`${title}\n\n${message}`));
      return;
    }
    const dlg = h(
      'dialog',
      { class: 'dialog', 'aria-labelledby': 'dlg-title' },
      h('h2', { id: 'dlg-title' }, title),
      h('p', null, message),
      h(
        'div',
        { class: 'row end' },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => dlg.close('cancel') }, 'Annuler'),
        h(
          'button',
          { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', onclick: () => dlg.close('ok') },
          confirmLabel,
        ),
      ),
    );
    dlg.addEventListener('close', () => {
      resolve(dlg.returnValue === 'ok');
      dlg.remove();
    });
    document.body.appendChild(dlg);
    dlg.showModal();
  });
}
