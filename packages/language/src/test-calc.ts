import * as ohm from 'ohm-js';

import {offset} from './types.ts';
import type {Span} from './types.ts';

export const CALC = String.raw`
Calc {
  Program = Stmt*
  Stmt = StmtBody ! ";"
  StmtBody = Assign | Exp
  Assign = ident "=" Exp
  Exp = Exp "+" Pri  -- add
      | Pri
  Pri = "(" Exp ")"  -- paren
      | "{" Stmt* "}"  -- block
      | number
      | Var
  Var = ident
  number = digit+
  ident = letter alnum*
}`;

export function calc() {
  const g = ohm.grammar(CALC);
  return {g, sem: g.createSemantics()};
}

export const span = (start: number, end: number): Span => ({
  start: offset(start),
  end: offset(end),
});
