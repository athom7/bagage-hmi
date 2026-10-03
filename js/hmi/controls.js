// Event wiring for the HMI: clicks on the plant drawing, the control bar and the info panel buttons.
// Operator actions change the field (the plant), never the I/O image or the PLC directly.

export function setupControls({ svg, plant, panel, onReset, root = document }) {
  const $ = (id) => root.getElementById(id);

  function selectFromEvent(target) {
    const bagNode = target.closest('[data-bag]');
    if (bagNode) {
      const bag = plant.findBag(bagNode.dataset.bag);
      if (bag) return panel.select({ type: 'bag', bag });
    }
    const compNode = target.closest('[data-comp]');
    if (compNode) return panel.select({ type: 'comp', id: compNode.dataset.comp });
    panel.select(null);
  }

  svg.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]');
    if (action && action.dataset.action === 'spawn') {
      plant.enqueueBag(action.dataset.counter);
      return;
    }
    selectFromEvent(e.target);
  });

  svg.addEventListener('keydown', (e) => {
    const action = e.target.closest && e.target.closest('[data-action="spawn"]');
    if (action && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      plant.enqueueBag(action.dataset.counter);
    }
  });

  $('info-actions').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'toggle-loader') {
      const g = Number(btn.dataset.gate);
      plant.setLoaderActive(g, !plant.gates[g].loaderActive);
      panel.refreshActions();
    } else if (btn.dataset.action === 'clear-selection') {
      panel.select(null);
    }
  });

  const auto = $('auto-on');
  const rate = $('auto-rate');
  const rateOut = $('auto-rate-out');
  const applyAuto = () => {
    rateOut.textContent = rate.value;
    plant.autoRate = auto.checked ? Number(rate.value) : 0;
  };
  auto.addEventListener('change', applyAuto);
  rate.addEventListener('input', applyAuto);
  applyAuto();

  $('btn-reset').addEventListener('click', () => {
    onReset(); // clears the line and restarts the PLC program (its tracking memory would otherwise be stale)
    panel.select(null);
    applyAuto();
  });
}
