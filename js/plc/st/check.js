// Semantic check of the AST: declarations, types, and which tags are read and written where.
// Returns the symbol table plus cross-reference info used by the HMI to show "the logic that controls a component".

import { STError } from './errors.js';
import { FB_TYPES } from './stdlib.js';

const DATA_TYPES = new Set(['BOOL', 'INT', 'TIME']);

export function check(ast, tags) {
  const symbols = new Map(); // name -> { kind: 'var'|'fb'|'tag', type, dir?, line? }
  const info = {
    assigns: [], // { target, line, endLine, ctx: [header lines], reads: [names] }
    reads: new Map(), // name -> Set(lines)
    identsByLine: new Map(), // line -> [display names]
    calls: new Map(), // instance -> line of the call
    declLine: new Map(),
  };

  for (const t of Object.values(tags)) symbols.set(t.name, { kind: 'tag', type: t.type, dir: t.dir });

  // ---- declarations ----
  for (const d of ast.decls) {
    if (symbols.has(d.name)) {
      const prev = symbols.get(d.name);
      throw new STError(prev.kind === 'tag' ? `"${d.name}" er allerede et I/O-tag og kan ikke erklæres som variabel` : `"${d.name}" er erklæret to gange`, d.line, d.col, 'type');
    }
    const upper = d.type.toUpperCase();
    if (FB_TYPES[upper]) {
      if (d.init) throw new STError(`Funktionsblokken "${d.name}" kan ikke have en startværdi`, d.line, d.col, 'type');
      symbols.set(d.name, { kind: 'fb', type: upper, line: d.line });
    } else if (DATA_TYPES.has(upper)) {
      symbols.set(d.name, { kind: 'var', type: upper, line: d.line });
      if (d.init) {
        const t = exprType(d.init, null);
        if (t !== upper) throw new STError(`Startværdien for "${d.name}" er ${t}, men variablen er ${upper}`, d.line, d.col, 'type');
        if (d.init.kind !== 'lit' && !(d.init.kind === 'unary' && d.init.arg.kind === 'lit')) {
          throw new STError(`Startværdien for "${d.name}" skal være en konstant`, d.line, d.col, 'type');
        }
      }
    } else {
      throw new STError(`Ukendt datatype "${d.type}". Understøttet: BOOL, INT, TIME, ${Object.keys(FB_TYPES).join(', ')}`, d.line, d.col, 'type');
    }
    info.declLine.set(d.name, d.line);
  }

  // ---- bookkeeping ----
  let collector = null; // names read inside the current statement

  function noteIdent(line, display, readName) {
    const list = info.identsByLine.get(line) || [];
    if (!list.includes(display)) list.push(display);
    info.identsByLine.set(line, list);
    if (readName !== null) {
      if (!info.reads.has(readName)) info.reads.set(readName, new Set());
      info.reads.get(readName).add(line);
      if (collector) collector.add(display);
    }
  }

  function exprType(e, ctxLine) {
    const here = ctxLine === null ? null : e.line;
    switch (e.kind) {
      case 'lit':
        return e.type;
      case 'ref': {
        const s = symbols.get(e.name);
        if (!s) throw new STError(`Ukendt navn "${e.name}": er det ikke et I/O-tag eller en erklæret variabel?`, e.line, e.col, 'type');
        if (s.kind === 'fb') throw new STError(`"${e.name}" er en funktionsblok. Brug en udgang, fx ${e.name}.Q`, e.line, e.col, 'type');
        if (here !== null) noteIdent(e.line, e.name, e.name);
        return s.type;
      }
      case 'member': {
        const s = symbols.get(e.inst);
        if (!s || s.kind !== 'fb') throw new STError(`"${e.inst}" er ikke en funktionsblok`, e.line, e.col, 'type');
        const def = FB_TYPES[s.type];
        const ty = def.outputs[e.field] || def.inputs[e.field];
        if (!ty) throw new STError(`${s.type} har ikke feltet "${e.field}". Udgange: ${Object.keys(def.outputs).join(', ')}`, e.line, e.col, 'type');
        if (here !== null) noteIdent(e.line, `${e.inst}.${e.field}`, `${e.inst}.${e.field}`);
        return ty;
      }
      case 'unary': {
        const t = exprType(e.arg, ctxLine);
        if (e.op === 'NOT' && t !== 'BOOL') throw new STError(`NOT kræver BOOL, men udtrykket er ${t}`, e.line, e.col, 'type');
        if (e.op === '-' && t === 'BOOL') throw new STError('Minus kan ikke bruges på BOOL', e.line, e.col, 'type');
        return t;
      }
      case 'binary': {
        const a = exprType(e.l, ctxLine);
        const b = exprType(e.r, ctxLine);
        const op = e.op;
        if (op === 'AND' || op === 'OR' || op === 'XOR') {
          if (a !== 'BOOL' || b !== 'BOOL') throw new STError(`${op} kræver BOOL på begge sider, men fandt ${a} og ${b}`, e.line, e.col, 'type');
          return 'BOOL';
        }
        if (a !== b) throw new STError(`Typerne passer ikke: ${a} ${op} ${b}`, e.line, e.col, 'type');
        if (op === '=' || op === '<>') return 'BOOL';
        if (op === '<' || op === '>' || op === '<=' || op === '>=') {
          if (a === 'BOOL') throw new STError(`${op} kan ikke bruges på BOOL`, e.line, e.col, 'type');
          return 'BOOL';
        }
        if (op === '+' || op === '-') {
          if (a === 'BOOL') throw new STError(`${op} kan ikke bruges på BOOL`, e.line, e.col, 'type');
          return a;
        }
        if (a !== 'INT') throw new STError(`${op} kræver INT, men fandt ${a}`, e.line, e.col, 'type'); // * / MOD
        return 'INT';
      }
      default:
        throw new Error(`unknown expression kind ${e.kind}`);
    }
  }

  const typed = (e) => exprType(e, e.line);

  function checkStatements(list, ctx) {
    for (const s of list) checkStatement(s, ctx);
  }

  function checkStatement(s, ctx) {
    switch (s.kind) {
      case 'assign': {
        const sym = symbols.get(s.target);
        if (!sym) throw new STError(`Ukendt navn "${s.target}"`, s.line, s.col, 'type');
        if (sym.kind === 'fb') throw new STError(`"${s.target}" er en funktionsblok og kan ikke tilskrives. Brug et kald: ${s.target}(...);`, s.line, s.col, 'type');
        if (sym.kind === 'tag' && sym.dir === 'I') throw new STError(`"${s.target}" er et input og kan ikke tilskrives i programmet`, s.line, s.col, 'type');
        collector = new Set();
        const t = typed(s.expr);
        if (t !== sym.type) throw new STError(`Kan ikke tilskrive ${t} til "${s.target}", som er ${sym.type}`, s.line, s.col, 'type');
        noteIdent(s.line, s.target, null);
        info.assigns.push({ target: s.target, line: s.line, endLine: s.endLine, ctx: [...ctx.lines], reads: [...collector, ...ctx.reads] });
        collector = null;
        break;
      }
      case 'call': {
        const sym = symbols.get(s.inst);
        if (!sym || sym.kind !== 'fb') throw new STError(`"${s.inst}" er ikke en erklæret funktionsblok`, s.line, s.col, 'type');
        const def = FB_TYPES[sym.type];
        info.calls.set(s.inst, s.line);
        const seen = new Set();
        for (const a of s.args) {
          if (!def.inputs[a.name]) throw new STError(`${sym.type} har ingen indgang "${a.name}". Indgange: ${Object.keys(def.inputs).join(', ')}`, a.line, a.col, 'type');
          if (seen.has(a.name)) throw new STError(`Indgangen "${a.name}" er angivet to gange`, a.line, a.col, 'type');
          seen.add(a.name);
          collector = new Set();
          const t = typed(a.expr);
          if (t !== def.inputs[a.name]) throw new STError(`Indgangen ${a.name} på ${sym.type} er ${def.inputs[a.name]}, men udtrykket er ${t}`, a.line, a.col, 'type');
          const reads = [...collector];
          collector = null;
          info.assigns.push({ target: `${s.inst}.${a.name}`, line: a.line, endLine: s.endLine, ctx: [...ctx.lines], reads: [...reads, ...ctx.reads] });
        }
        break;
      }
      case 'if': {
        const outer = ctx;
        const lines = [...outer.lines];
        const reads = [...outer.reads];
        for (const br of s.branches) {
          collector = new Set();
          if (typed(br.cond) !== 'BOOL') throw new STError('Betingelsen i IF skal være BOOL', br.line, br.cond.col, 'type');
          const condReads = [...collector];
          collector = null;
          checkStatements(br.body, { lines: [...lines, br.line], reads: [...reads, ...condReads] });
        }
        if (s.otherwise) checkStatements(s.otherwise, { lines: [...lines, s.line], reads });
        break;
      }
      case 'case': {
        collector = new Set();
        if (typed(s.sel) !== 'INT') throw new STError('CASE-udtrykket skal være INT', s.line, s.sel.col, 'type');
        const selReads = [...collector];
        collector = null;
        const used = new Set();
        for (const c of s.cases) {
          for (const v of c.values) {
            if (used.has(v)) throw new STError(`CASE-værdien ${v} er brugt to gange`, c.line, 0, 'type');
            used.add(v);
          }
          checkStatements(c.body, { lines: [...ctx.lines, s.line, c.line], reads: [...ctx.reads, ...selReads] });
        }
        if (s.otherwise) checkStatements(s.otherwise, { lines: [...ctx.lines, s.line], reads: [...ctx.reads, ...selReads] });
        break;
      }
      default:
        throw new Error(`unknown statement kind ${s.kind}`);
    }
  }

  checkStatements(ast.body, { lines: [], reads: [] });
  return { symbols, info };
}
