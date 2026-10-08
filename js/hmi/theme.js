// Display theme switch: "operator" (ISA-101, default) or "showcase". Only sets data-theme on <html>;
// the colours themselves live in css/hmi.css.

const KEY = 'bagage-hmi-theme';
const LABEL = { operator: 'Visning: Operatør', showcase: 'Visning: Showcase' };

export function setupTheme(button, root = document.documentElement) {
  const paint = () => {
    const t = root.dataset.theme === 'showcase' ? 'showcase' : 'operator';
    button.textContent = LABEL[t];
    button.setAttribute('aria-pressed', String(t === 'showcase'));
  };
  button.addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'showcase' ? 'operator' : 'showcase';
    try { localStorage.setItem(KEY, root.dataset.theme); } catch { /* storage not available: still switches */ }
    paint();
  });
  paint();
}
