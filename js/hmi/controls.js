// Event wiring for the HMI: clicks on the plant drawing, the operator panel and the info panel buttons.
// Operator actions change the field (push buttons, emergency stop, bags, loaders), never the I/O image
// or the PLC directly: the PLC only sees them as inputs in its next scan.

export function setupControls({ svg, plant, panel, onReset, sim, root = document }) {
  const $ = (id) => root.getElementById(id);

  // ---- clicks in the drawing ----
  function selectFromEvent(target) {
    const bagNode = target.closest('[data-bag]');
    if (bagNode) {
      const bag = plant.findBag(bagNode.dataset.bag);
      if (bag) return panel.select({ type: 'bag', bag });
    }
    const compNode = target.closest('[data-comp]');
    if (compNode) return panel.select({ type: 'comp', id: compNode.dataset.comp });
    return panel.select(null);
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

  // ---- info panel buttons ----
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

  // ---- operator panel: push buttons and the emergency stop mushroom ----
  $('op-start').addEventListener('click', () => plant.pressButton('start'));
  $('op-stop').addEventListener('click', () => plant.pressButton('stop'));
  $('op-reset').addEventListener('click', () => plant.pressButton('reset'));
  const estop = $('op-estop');
  const paintEstop = () => {
    const pressed = !plant.operator.estopOk;
    estop.setAttribute('aria-pressed', String(pressed));
    estop.classList.toggle('pressed', pressed);
    estop.textContent = pressed ? 'Frigiv nødstop' : 'NØDSTOP';
  };
  estop.addEventListener('click', () => {
    plant.setEmergencyStop(plant.operator.estopOk);
    paintEstop();
  });

  // ---- simulation controls ----
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

  const pause = $('sim-pause');
  const step = $('sim-step');
  const paintPause = () => {
    pause.textContent = sim.paused ? 'Fortsæt' : 'Pause';
    pause.setAttribute('aria-pressed', String(sim.paused));
    step.disabled = !sim.paused;
  };
  pause.addEventListener('click', () => { sim.paused = !sim.paused; paintPause(); });
  step.addEventListener('click', () => sim.stepOnce());
  paintPause();

  $('btn-reset').addEventListener('click', () => {
    onReset(); // clears the line and cold-starts the PLC program (its tracking queues would otherwise be stale)
    panel.select(null);
    applyAuto();
    paintEstop();
  });
}
