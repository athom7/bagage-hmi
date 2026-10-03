// Lexer for the supported Structured Text subset (IEC 61131-3 style).
// Keywords are case-insensitive. Identifiers (tags, variables) are case-sensitive.

import { STError } from './errors.js';

export const KEYWORDS = new Set([
  'PROGRAM', 'END_PROGRAM', 'VAR', 'END_VAR',
  'IF', 'THEN', 'ELSIF', 'ELSE', 'END_IF',
  'CASE', 'OF', 'END_CASE',
  'AND', 'OR', 'XOR', 'NOT', 'MOD', 'TRUE', 'FALSE',
]);

const TIME_UNITS = { d: 86400000, h: 3600000, m: 60000, s: 1000, ms: 1 };

export function parseTimeLiteral(text, line, col) {
  const parts = [...text.matchAll(/(\d+(?:\.\d+)?)(ms|d|h|m|s)/gi)];
  if (!parts.length || parts.map((p) => p[0]).join('') !== text) {
    throw new STError(`Ugyldig tidskonstant "T#${text}". Eksempel: T#500ms, T#5s, T#1m30s`, line, col);
  }
  return Math.round(parts.reduce((sum, p) => sum + parseFloat(p[1]) * TIME_UNITS[p[2].toLowerCase()], 0));
}

const TWO_CHAR = new Set([':=', '<>', '<=', '>=']);
const ONE_CHAR = new Set(['=', '<', '>', '+', '-', '*', '/', '(', ')', ',', ';', ':', '.']);

// Token: { type: 'kw'|'ident'|'int'|'time'|'op'|'eof', value, line, col }
export function tokenize(src) {
  const tokens = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  let col = 1;

  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; col = 1; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; col++; continue; }

    if (c === '(' && src[i + 1] === '*') {
      const startLine = line;
      const startCol = col;
      i += 2; col += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === ')')) {
        if (src[i] === '\n') { line++; col = 1; } else col++;
        i++;
      }
      if (i >= n) throw new STError('Kommentaren er ikke afsluttet: mangler *)', startLine, startCol);
      i += 2; col += 2;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }

    if (/[A-Za-z_]/.test(c)) {
      const start = i;
      while (i < n && /[A-Za-z0-9_]/.test(src[i])) i++;
      const word = src.slice(start, i);
      const upper = word.toUpperCase();
      if ((upper === 'T' || upper === 'TIME') && src[i] === '#') {
        const lit = i + 1;
        i++;
        while (i < n && /[0-9A-Za-z_.]/.test(src[i])) i++;
        const value = parseTimeLiteral(src.slice(lit, i), line, col);
        tokens.push({ type: 'time', value, line, col });
        col += i - start;
        continue;
      }
      tokens.push({ type: KEYWORDS.has(upper) ? 'kw' : 'ident', value: KEYWORDS.has(upper) ? upper : word, line, col });
      col += i - start;
      continue;
    }

    if (/[0-9]/.test(c)) {
      const start = i;
      while (i < n && /[0-9]/.test(src[i])) i++;
      if (/[A-Za-z_]/.test(src[i] || '')) throw new STError(`Ugyldigt tal "${src.slice(start, i + 1)}"`, line, col);
      tokens.push({ type: 'int', value: parseInt(src.slice(start, i), 10), line, col });
      col += i - start;
      continue;
    }

    const two = src.slice(i, i + 2);
    if (TWO_CHAR.has(two)) {
      tokens.push({ type: 'op', value: two, line, col });
      i += 2; col += 2;
      continue;
    }
    if (ONE_CHAR.has(c)) {
      tokens.push({ type: 'op', value: c, line, col });
      i++; col++;
      continue;
    }
    throw new STError(`Ukendt tegn "${c}"`, line, col);
  }

  tokens.push({ type: 'eof', value: '', line, col });
  return tokens;
}
