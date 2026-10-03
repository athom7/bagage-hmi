// Recursive-descent parser for the supported ST subset. Produces an AST with line numbers on every node.
//
// program   := PROGRAM name { varblock } { statement } END_PROGRAM
// varblock  := VAR { name {, name} : type [:= literal] ; } END_VAR
// statement := name := expr ; | name ( [arg := expr {, arg := expr}] ) ; | IF ... | CASE ...
// Operator precedence (low to high): OR, XOR, AND, = <>, < > <= >=, + -, * / MOD, NOT and unary minus.

import { tokenize } from './lexer.js';
import { STError } from './errors.js';

export function parse(src) {
  const toks = tokenize(src);
  let p = 0;

  const peek = (o = 0) => toks[Math.min(p + o, toks.length - 1)];
  const next = () => toks[p++];
  const isKw = (v, o = 0) => peek(o).type === 'kw' && peek(o).value === v;
  const isOp = (v, o = 0) => peek(o).type === 'op' && peek(o).value === v;
  const describe = (t) => (t.type === 'eof' ? 'filens slutning' : `"${t.type === 'time' ? 'T#…' : t.value}"`);
  const fail = (msg, t = peek()) => { throw new STError(msg, t.line, t.col); };

  const expectKw = (v) => (isKw(v) ? next() : fail(`Forventede ${v}, men fandt ${describe(peek())}`));
  const expectOp = (v) => {
    if (isOp(v)) return next();
    // A missing ";" is noticed at the NEXT token, but the mistake is at the end of the previous line.
    if (v === ';' && p > 0) fail(`Mangler ";" i slutningen af sætningen (efter ${describe(toks[p - 1])})`, toks[p - 1]);
    return fail(`Forventede "${v}", men fandt ${describe(peek())}`);
  };
  const expectIdent = (what) => (peek().type === 'ident' ? next() : fail(`Forventede ${what}, men fandt ${describe(peek())}`));

  // ---- expressions ----
  function parseExpr() { return parseOr(); }

  function binaryLevel(sub, ops) {
    return () => {
      let left = sub();
      for (;;) {
        const t = peek();
        const op = (t.type === 'kw' || t.type === 'op') && ops.includes(t.value) ? t.value : null;
        if (!op) return left;
        next();
        left = { kind: 'binary', op, l: left, r: sub(), line: t.line, col: t.col };
      }
    };
  }

  const parseUnary = () => {
    const t = peek();
    if (t.type === 'kw' && t.value === 'NOT') { next(); return { kind: 'unary', op: 'NOT', arg: parseUnary(), line: t.line, col: t.col }; }
    if (t.type === 'op' && t.value === '-') { next(); return { kind: 'unary', op: '-', arg: parseUnary(), line: t.line, col: t.col }; }
    return parsePrimary();
  };
  const parseMul = binaryLevel(parseUnary, ['*', '/', 'MOD']);
  const parseAdd = binaryLevel(parseMul, ['+', '-']);
  const parseRel = binaryLevel(parseAdd, ['<', '>', '<=', '>=']);
  const parseEq = binaryLevel(parseRel, ['=', '<>']);
  const parseAnd = binaryLevel(parseEq, ['AND']);
  const parseXor = binaryLevel(parseAnd, ['XOR']);
  const parseOr = binaryLevel(parseXor, ['OR']);

  function parsePrimary() {
    const t = peek();
    if (t.type === 'int') { next(); return { kind: 'lit', type: 'INT', value: t.value, line: t.line, col: t.col }; }
    if (t.type === 'time') { next(); return { kind: 'lit', type: 'TIME', value: t.value, line: t.line, col: t.col }; }
    if (t.type === 'kw' && (t.value === 'TRUE' || t.value === 'FALSE')) { next(); return { kind: 'lit', type: 'BOOL', value: t.value === 'TRUE', line: t.line, col: t.col }; }
    if (isOp('(')) {
      next();
      const e = parseExpr();
      expectOp(')');
      return e;
    }
    if (t.type === 'ident') {
      next();
      if (isOp('.')) {
        next();
        const f = expectIdent('et feltnavn efter punktummet');
        return { kind: 'member', inst: t.value, field: f.value, line: t.line, col: t.col };
      }
      return { kind: 'ref', name: t.value, line: t.line, col: t.col };
    }
    return fail(`Forventede et udtryk, men fandt ${describe(t)}`);
  }

  // ---- statements ----
  const BLOCK_WORDS = ['END_PROGRAM', 'END_IF', 'END_CASE', 'END_VAR', 'ELSIF', 'ELSE', 'THEN', 'OF'];

  function parseBody(stops) {
    const list = [];
    while (!(peek().type === 'kw' && stops.includes(peek().value))) {
      if (peek().type === 'eof') fail(`Filen slutter uventet. Forventede ${stops.join(' eller ')}`);
      if (peek().type === 'kw' && BLOCK_WORDS.includes(peek().value)) fail(`Forventede ${stops.join(' eller ')}, men fandt ${peek().value}. Mangler der en afslutning på en IF eller CASE?`);
      if (isOp(';')) { next(); continue; }
      list.push(parseStatement());
    }
    return list;
  }

  function parseStatement() {
    const t = peek();
    if (isKw('IF')) return parseIf();
    if (isKw('CASE')) return parseCase();
    if (t.type === 'ident') {
      if (isOp(':=', 1)) {
        next(); next();
        const expr = parseExpr();
        const end = expectOp(';');
        return { kind: 'assign', target: t.value, expr, line: t.line, col: t.col, endLine: end.line };
      }
      if (isOp('(', 1)) {
        next(); next();
        const args = [];
        if (!isOp(')')) {
          for (;;) {
            const a = expectIdent('et parameternavn');
            expectOp(':=');
            args.push({ name: a.value, expr: parseExpr(), line: a.line, col: a.col });
            if (isOp(',')) { next(); continue; }
            break;
          }
        }
        expectOp(')');
        const end = expectOp(';');
        return { kind: 'call', inst: t.value, args, line: t.line, col: t.col, endLine: end.line };
      }
      if (isOp('.', 1)) fail('Man kan ikke tilskrive et felt i en funktionsblok. Tilskriv blokkens indgange i kaldet: Blok(IN := ...);', t);
      fail(`Forventede ":=" eller "(" efter "${t.value}", men fandt ${describe(peek(1))}`, peek(1));
    }
    return fail(`Uventet ${describe(t)}. En sætning skal starte med et navn, IF eller CASE`);
  }

  function parseIf() {
    const start = next();
    const branches = [];
    let cond = parseExpr();
    expectKw('THEN');
    branches.push({ cond, line: start.line, body: parseBody(['ELSIF', 'ELSE', 'END_IF']) });
    while (isKw('ELSIF')) {
      const t = next();
      cond = parseExpr();
      expectKw('THEN');
      branches.push({ cond, line: t.line, body: parseBody(['ELSIF', 'ELSE', 'END_IF']) });
    }
    let otherwise = null;
    let elseLine = null;
    if (isKw('ELSE')) {
      elseLine = next().line;
      otherwise = parseBody(['END_IF']);
    }
    expectKw('END_IF');
    const end = expectOp(';');
    return { kind: 'if', branches, otherwise, elseLine, line: start.line, col: start.col, endLine: end.line };
  }

  function parseCase() {
    const start = next();
    const sel = parseExpr();
    expectKw('OF');
    const cases = [];
    let otherwise = null;
    let elseLine = null;
    while (!isKw('END_CASE')) {
      if (isKw('ELSE')) {
        elseLine = next().line;
        otherwise = parseBody(['END_CASE']);
        break;
      }
      const labelTok = peek();
      const values = [];
      for (;;) {
        let neg = false;
        if (isOp('-')) { next(); neg = true; }
        const v = peek();
        if (v.type !== 'int') fail(`Forventede et heltal som CASE-værdi, men fandt ${describe(v)}`, v);
        next();
        values.push(neg ? -v.value : v.value);
        if (isOp(',')) { next(); continue; }
        break;
      }
      expectOp(':');
      const body = [];
      while (!(peek().type === 'int' || isOp('-') || isKw('ELSE') || isKw('END_CASE'))) {
        if (peek().type === 'eof') fail('Filen slutter uventet midt i CASE');
        if (isOp(';')) { next(); continue; }
        body.push(parseStatement());
      }
      cases.push({ values, body, line: labelTok.line });
    }
    expectKw('END_CASE');
    const end = expectOp(';');
    return { kind: 'case', sel, cases, otherwise, elseLine, line: start.line, col: start.col, endLine: end.line };
  }

  // ---- declarations ----
  function parseVarBlock(decls) {
    expectKw('VAR');
    while (!isKw('END_VAR')) {
      const names = [expectIdent('et variabelnavn')];
      while (isOp(',')) { next(); names.push(expectIdent('et variabelnavn')); }
      expectOp(':');
      const type = expectIdent('en datatype');
      let init = null;
      if (isOp(':=')) { next(); init = parseExpr(); }
      expectOp(';');
      for (const n of names) decls.push({ name: n.value, type: type.value, init, line: n.line, col: n.col });
    }
    expectKw('END_VAR');
  }

  expectKw('PROGRAM');
  const name = expectIdent('et programnavn').value;
  const decls = [];
  while (isKw('VAR')) parseVarBlock(decls);
  const body = parseBody(['END_PROGRAM']);
  expectKw('END_PROGRAM');
  if (peek().type !== 'eof') fail(`Der må ikke stå mere efter END_PROGRAM, men fandt ${describe(peek())}`);

  return { name, decls, body, lineCount: src.split('\n').length };
}
