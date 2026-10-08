// "Online view" of the ST program: syntax-coloured source with live values, like the monitoring
// view in TIA Portal or Codesys. Also builds the "controlling logic" snippets shown in the info panel.
// Read-only towards the PLC: it only calls program.getValue() / typeOf().

import { KEYWORDS } from '../plc/st/lexer.js';
import { FB_TYPES } from '../plc/st/stdlib.js';

const TYPE_WORDS = new Set(['BOOL', 'INT', 'TIME', ...Object.keys(FB_TYPES)]);
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?/;

export function formatValue(v, type) {
  if (type === 'BOOL') return v ? 'TRUE' : 'FALSE';
  if (type === 'TIME') return v >= 1000 && v % 100 === 0 ? `T#${v / 1000}s` : `T#${v}ms`;
  return String(v);
}

// Highlights one source line. `state.inBlock` carries an open (* comment across lines.
export function highlightLine(text, state, symbols) {
  let html = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (state.inBlock) {
      const end = text.indexOf('*)', i);
      const stop = end < 0 ? n : end + 2;
      html += `<span class="c">${esc(text.slice(i, stop))}</span>`;
      i = stop;
      if (end >= 0) state.inBlock = false;
      continue;
    }
    const rest = text.slice(i);
    if (rest.startsWith('(*')) { state.inBlock = true; continue; }
    if (rest.startsWith('//')) { html += `<span class="c">${esc(rest)}</span>`; break; }
    let m = /^[Tt](?:[Ii][Mm][Ee])?#[0-9A-Za-z_.]+/.exec(rest);
    if (m) { html += `<span class="n">${esc(m[0])}</span>`; i += m[0].length; continue; }
    m = /^\d+/.exec(rest);
    if (m) { html += `<span class="n">${m[0]}</span>`; i += m[0].length; continue; }
    m = IDENT.exec(rest);
    if (m) {
      const word = m[0];
      const first = word.split('.')[0];
      const sym = symbols.get(first);
      if (KEYWORDS.has(word.toUpperCase())) html += `<span class="k">${word}</span>`;
      else if (TYPE_WORDS.has(word.toUpperCase()) && !sym) html += `<span class="t">${word}</span>`;
      else if (sym && sym.kind === 'fb' && !word.includes('.')) html += `<span class="fb">${word}</span>`;
      else if (sym) html += `<span class="v ${sym.kind === 'tag' ? (sym.dir === 'I' ? 'tin' : 'tout') : 'mem'}" data-var="${word}">${word}</span>`;
      else html += esc(word);
      i += word.length;
      continue;
    }
    html += esc(text[i]);
    i++;
  }
  return html;
}

// ---- which lines of the program belong to a component ----

// Returns [{ line, primary }] sorted by line. For an output tag: the lines that write it, plus the lines
// that write the variables used there (one level deep). For an input tag: the lines that read it.
export function explainLines(program, tagNames, limit = 24) {
  const info = program.info;
  const primary = new Set();
  const secondary = new Set();

  const addStatement = (a, set) => {
    for (let l = a.line; l <= a.endLine; l++) set.add(l);
    for (const c of a.ctx) secondary.add(c);
  };

  for (const name of tagNames) {
    if (name.startsWith('Q_') || name.startsWith('M_')) {
      for (const a of info.assigns.filter((x) => x.target === name)) {
        addStatement(a, primary);
        for (const r of a.reads) {
          const base = r.split('.')[0];
          const sym = program.symbols.get(base);
          if (!sym || sym.kind === 'tag') continue;
          for (const dep of info.assigns.filter((x) => x.target === r || (sym.kind === 'fb' && x.target.startsWith(base + '.')))) addStatement(dep, secondary);
        }
      }
    } else {
      for (const l of info.reads.get(name) || []) primary.add(l);
    }
  }
  const all = [...new Set([...primary, ...secondary])].sort((a, b) => a - b);
  const kept = all.length > limit ? [...all.filter((l) => primary.has(l)), ...all.filter((l) => !primary.has(l))].slice(0, limit).sort((a, b) => a - b) : all;
  return kept.map((line) => ({ line, primary: primary.has(line) }));
}

// HTML for the "controlling logic" section in the info panel (live values included).
export function logicHtml(program, tagNames) {
  if (!program || !program.info) return '<p class="logic-placeholder">Programmet er ikke indlæst.</p>';
  const items = explainLines(program, tagNames);
  if (!items.length) return '<p class="logic-placeholder">Ingen linjer i programmet bruger dette signal.</p>';
  const rows = items.map(({ line, primary }) => {
    const text = program.lines[line - 1] || '';
    const chips = (program.info.identsByLine.get(line) || []).map((name) => {
      const type = program.typeOf(name);
      const v = program.getValue(name);
      if (type === undefined || v === undefined) return '';
      const cls = type === 'BOOL' ? (v ? 'on' : 'off') : 'num';
      return `<span class="chip ${cls}">${esc(name)} = ${esc(formatValue(v, type))}</span>`;
    }).join('');
    const code = highlightLine(text, { inBlock: false }, program.symbols).replace(/ data-var="[^"]*"/g, '');
    return `<div class="lg${primary ? ' primary' : ''}"><div class="row"><span class="no">${line}</span><code>${code}</code></div><div class="chips">${chips}</div></div>`;
  });
  return `<div class="logic">${rows.join('')}</div>`;
}

// ---- Danish network explanations (plc/networks.da.json) ----

// Index of the line holding each network's section header ("// 1. OPERATING MODE"), or -1 if missing.
export function findNetworkLines(lines, networks) {
  return networks.map((n) => lines.findIndex((l) => l.trim() === `// ${n.anchor}`));
}

// ---- the program panel ----

export function createStView({ root, onApply, onRevert }) {
  const $ = (sel) => root.querySelector(sel);
  const body = $('#st-body');
  const editor = $('#st-editor');
  const errorBox = $('#st-error');
  const btnEdit = $('#st-edit');
  const btnLoad = $('#st-load');
  const btnCancel = $('#st-cancel');
  const btnRevert = $('#st-revert');
  const fifoBox = $('#st-fifo');
  const title = $('#st-title');

  let program = null;
  let spans = [];
  let lineEls = [];
  let marked = [];
  let lastFifo = '';
  let editing = false;
  let errorLine = 0;
  let networks = [];

  function render() {
    body.textContent = '';
    spans = [];
    lineEls = [];
    if (!program) return;
    const state = { inBlock: false };
    const frag = document.createDocumentFragment();
    const netAt = new Map();
    findNetworkLines(program.lines, networks).forEach((idx, k) => { if (idx >= 0) netAt.set(idx, networks[k]); });
    program.lines.forEach((text, i) => {
      const row = document.createElement('div');
      row.className = 'ln';
      row.innerHTML = `<span class="no">${i + 1}</span><code>${highlightLine(text, state, program.symbols) || ' '}</code>`;
      frag.appendChild(row);
      lineEls.push(row);
      const net = netAt.get(i);
      if (net) {
        // "Forklar" button on the network header; the Danish text is data, not part of the ST code.
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'secondary explain-btn';
        btn.textContent = 'Forklar';
        btn.setAttribute('aria-expanded', 'false');
        row.appendChild(btn);
        const box = document.createElement('div');
        box.className = 'net-explain';
        box.hidden = true;
        box.innerHTML = `<strong>${esc(net.title)}</strong><p>${esc(net.explain)}</p>`;
        frag.appendChild(box);
      }
    });
    body.appendChild(frag);
    spans = [...body.querySelectorAll('[data-var]')];
    marked = [];
  }

  function setError(message, line = 0) {
    errorBox.hidden = !message;
    errorBox.textContent = message || '';
    errorLine = line;
    lineEls.forEach((el, i) => el.classList.toggle('err', line === i + 1));
    if (line && lineEls[line - 1]) scrollToLine(line);
  }

  function scrollToLine(line) {
    const el = lineEls[line - 1];
    if (!el) return;
    body.scrollTop = Math.max(0, el.offsetTop - body.clientHeight / 3);
  }

  function setEditing(on) {
    editing = on;
    editor.hidden = !on;
    body.hidden = on;
    btnEdit.hidden = on;
    btnLoad.hidden = !on;
    btnCancel.hidden = !on;
    if (on) {
      editor.value = program ? program.source : '';
      editor.focus();
    }
  }

  body.addEventListener('click', (e) => {
    const btn = e.target.closest('.explain-btn');
    if (!btn) return;
    const box = btn.parentElement.nextElementSibling;
    const open = box.hidden;
    box.hidden = !open;
    btn.textContent = open ? 'Skjul' : 'Forklar';
    btn.setAttribute('aria-expanded', String(open));
  });

  btnEdit.addEventListener('click', () => { setError(''); setEditing(true); });
  btnCancel.addEventListener('click', () => { setError(''); setEditing(false); });
  btnRevert.addEventListener('click', () => { setError(''); setEditing(false); onRevert(); });
  btnLoad.addEventListener('click', () => {
    const result = onApply(editor.value);
    if (result.ok) {
      setError('');
      setEditing(false);
    } else {
      setError(result.message, result.line);
      if (result.line) {
        // select the faulty line in the editor
        const lines = editor.value.split('\n');
        const start = lines.slice(0, result.line - 1).join('\n').length + (result.line > 1 ? 1 : 0);
        editor.focus();
        editor.setSelectionRange(start, start + (lines[result.line - 1] || '').length);
      }
    }
  });

  return {
    setProgram(p) {
      program = p;
      title.textContent = p && p.name ? `PROGRAM ${p.name}` : 'Intet program';
      render();
      setError('');
    },
    showError: setError,
    setNetworks(list) {
      networks = Array.isArray(list) ? list : [];
      render();
      if (errorLine) setError(errorBox.textContent, errorLine);
    },
    get editing() { return editing; },

    // Mark lines [{ line, primary }] and scroll to the first one.
    highlight(items) {
      for (const el of marked) el.classList.remove('hl', 'hl-main');
      marked = [];
      for (const { line, primary } of items) {
        const el = lineEls[line - 1];
        if (!el) continue;
        el.classList.add(primary ? 'hl-main' : 'hl');
        marked.push(el);
      }
      if (items.length) scrollToLine(items[0].line);
    },

    // Called a few times per second: refresh live values.
    update() {
      if (!program || editing) return;
      for (const s of spans) {
        const name = s.dataset.var;
        const type = program.typeOf(name);
        const v = program.getValue(name);
        if (v === undefined) continue;
        if (type === 'BOOL') {
          s.classList.toggle('on', !!v);
          s.classList.toggle('off', !v);
        } else {
          s.dataset.val = formatValue(v, type);
          s.classList.add('num');
        }
      }
      const fifo = [1, 2, 3].map((k) => {
        const q = program.fifoContents(`FIFO_${k}`);
        return q ? `FIFO_${k} [${q.join(', ')}]` : null;
      }).filter(Boolean).join('   ');
      if (fifo !== lastFifo) {
        fifoBox.textContent = fifo;
        lastFifo = fifo;
      }
    },
  };
}
