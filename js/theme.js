// Thème selon l'occasion, décors discrets (flocons / confettis) et confetti de réservation.

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const OCCASIONS = ['noel', 'anniversaire', 'autre'];
const CONFETTI_COLORS = ['#d4a62f', '#b02a43', '#1f7a5a', '#e8590c', '#3b82c4', '#c2255c'];

export const OCCASION_LABELS = {
  noel: { emoji: '🎄', label: 'Noël' },
  anniversaire: { emoji: '🎂', label: 'Anniversaire' },
  autre: { emoji: '🎁', label: 'Autre occasion' },
};

export function setTheme(occasion = 'autre') {
  const o = OCCASIONS.includes(occasion) ? occasion : 'autre';
  const unchanged = document.documentElement.dataset.occasion === o;
  document.documentElement.dataset.occasion = o;

  const deco = document.getElementById('deco');
  if (!deco) return;
  if (unchanged && deco.childElementCount > 0) return; // évite de relancer l'animation à chaque rafraîchissement
  deco.replaceChildren();
  if (reduceMotion.matches || o === 'autre') return;

  for (let i = 0; i < 16; i++) {
    const piece = document.createElement('span');
    piece.className = o === 'noel' ? 'flake' : 'confetto';
    if (o === 'noel') piece.textContent = '❄';
    piece.style.setProperty('--x', `${Math.round(Math.random() * 100)}vw`);
    piece.style.setProperty('--size', `${(0.6 + Math.random() * 0.9).toFixed(2)}rem`);
    piece.style.setProperty('--dur', `${(14 + Math.random() * 16).toFixed(1)}s`);
    piece.style.setProperty('--delay', `${(-Math.random() * 20).toFixed(1)}s`);
    piece.style.setProperty('--c', CONFETTI_COLORS[i % CONFETTI_COLORS.length]);
    deco.appendChild(piece);
  }
}

/** Petite explosion de confettis à partir d'un élément (ignorée si "réduire les animations"). */
export function burst(originEl) {
  if (reduceMotion.matches) return;
  const r = originEl?.getBoundingClientRect?.();
  const x0 = r ? r.left + r.width / 2 : window.innerWidth / 2;
  const y0 = r ? r.top + r.height / 2 : window.innerHeight / 2;

  const layer = document.createElement('div');
  layer.className = 'burst';
  layer.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 38; i++) {
    const p = document.createElement('i');
    p.style.setProperty('left', `${x0}px`);
    p.style.setProperty('top', `${y0}px`);
    p.style.setProperty('background', CONFETTI_COLORS[i % CONFETTI_COLORS.length]);
    layer.appendChild(p);
    const angle = Math.random() * Math.PI * 2;
    const dist = 60 + Math.random() * 140;
    p.animate(
      [
        { transform: 'translate(0, 0) rotate(0deg)', opacity: 1 },
        {
          transform: `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist + 80}px) rotate(${Math.random() * 720}deg)`,
          opacity: 0,
        },
      ],
      { duration: 900 + Math.random() * 700, easing: 'cubic-bezier(.15,.8,.3,1)', fill: 'forwards' },
    );
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 1800);
}
