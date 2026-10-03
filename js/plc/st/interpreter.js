// Structured Text interpreter. compile() turns source text into a Program that runs one scan at a time.
// The program only touches the I/O image (image.I read, image.Q written) and its own memory.

import { parse } from './parser.js';
import { check } from './check.js';
import { STError } from './errors.js';
import { FB_TYPES, wrap16 } from './stdlib.js';

const defaultOf = (type) => (type === 'BOOL' ? false : 0);

export function compile(source, { tags }) {
  const ast = parse(source);
  const { symbols, info } = check(ast, tags);
  return new Program(source, ast, symbols, info);
}

export class Program {
  constructor(source, ast, symbols, info) {
    this.source = source;
    this.lines = source.split('\n');
    this.ast = ast;
    this.name = ast.name;
    this.symbols = symbols;
    this.info = info;
    this.vars = new Map();
    this.instances = new Map();
    this.image = null;
    this.ctx = null;

    for (const d of ast.decls) {
      const sym = symbols.get(d.name);
      if (sym.kind === 'fb') this.instances.set(d.name, FB_TYPES[sym.type].create());
      else this.vars.set(d.name, d.init ? this._eval(d.init) : defaultOf(sym.type));
    }
  }

  // One scan of the program. Inputs in image.I are read-only during the run.
  execute(image, ctx) {
    this.image = image;
    this.ctx = ctx;
    this._run(this.ast.body);
  }

  // Current value of a tag, variable or function-block field ("T_MergeGap.Q"). Used by the HMI.
  getValue(name) {
    const dot = name.indexOf('.');
    if (dot >= 0) {
      const inst = this.instances.get(name.slice(0, dot));
      if (!inst) return undefined;
      const f = name.slice(dot + 1);
      return f in inst.out ? inst.out[f] : inst.in[f];
    }
    if (this.vars.has(name)) return this.vars.get(name);
    const sym = this.symbols.get(name);
    if (sym && sym.kind === 'tag' && this.image) return this.image[sym.dir][name];
    return undefined;
  }

  typeOf(name) {
    const dot = name.indexOf('.');
    if (dot >= 0) {
      const sym = this.symbols.get(name.slice(0, dot));
      if (!sym || sym.kind !== 'fb') return undefined;
      const def = FB_TYPES[sym.type];
      return def.outputs[name.slice(dot + 1)] || def.inputs[name.slice(dot + 1)];
    }
    const sym = this.symbols.get(name);
    return sym ? sym.type : undefined;
  }

  // Contents of a FIFO instance, oldest first (for the HMI tracking view).
  fifoContents(name) {
    const inst = this.instances.get(name);
    return inst && inst.mem.queue ? [...inst.mem.queue] : null;
  }

  // ---- execution ----
  _run(list) {
    for (const s of list) this._exec(s);
  }

  _exec(s) {
    switch (s.kind) {
      case 'assign': {
        let v = this._eval(s.expr);
        const sym = this.symbols.get(s.target);
        if (sym.type === 'INT') v = wrap16(v);
        if (sym.kind === 'tag') this.image.Q[s.target] = v;
        else this.vars.set(s.target, v);
        break;
      }
      case 'call': {
        const inst = this.instances.get(s.inst);
        for (const a of s.args) inst.in[a.name] = this._eval(a.expr);
        FB_TYPES[this.symbols.get(s.inst).type].exec(inst, this.ctx);
        break;
      }
      case 'if': {
        for (const br of s.branches) {
          if (this._eval(br.cond)) {
            this._run(br.body);
            return;
          }
        }
        if (s.otherwise) this._run(s.otherwise);
        break;
      }
      case 'case': {
        const v = this._eval(s.sel);
        const hit = s.cases.find((c) => c.values.includes(v));
        if (hit) this._run(hit.body);
        else if (s.otherwise) this._run(s.otherwise);
        break;
      }
      default:
        throw new Error(`unknown statement ${s.kind}`);
    }
  }

  _eval(e) {
    switch (e.kind) {
      case 'lit':
        return e.value;
      case 'ref': {
        if (this.vars.has(e.name)) return this.vars.get(e.name);
        const sym = this.symbols.get(e.name); // a tag
        return this.image[sym.dir][e.name];
      }
      case 'member': {
        const inst = this.instances.get(e.inst);
        return e.field in inst.out ? inst.out[e.field] : inst.in[e.field];
      }
      case 'unary': {
        const v = this._eval(e.arg);
        return e.op === 'NOT' ? !v : -v;
      }
      case 'binary': {
        if (e.op === 'AND') return this._eval(e.l) && this._eval(e.r);
        if (e.op === 'OR') return this._eval(e.l) || this._eval(e.r);
        const a = this._eval(e.l);
        const b = this._eval(e.r);
        switch (e.op) {
          case 'XOR': return a !== b;
          case '=': return a === b;
          case '<>': return a !== b;
          case '<': return a < b;
          case '>': return a > b;
          case '<=': return a <= b;
          case '>=': return a >= b;
          case '+': return a + b;
          case '-': return a - b;
          case '*': return a * b;
          case '/':
          case 'MOD':
            if (b === 0) throw new STError('Division med nul', e.line, e.col, 'runtime');
            return e.op === '/' ? Math.trunc(a / b) : a % b;
          default:
            throw new Error(`unknown operator ${e.op}`);
        }
      }
      default:
        throw new Error(`unknown expression ${e.kind}`);
    }
  }
}
