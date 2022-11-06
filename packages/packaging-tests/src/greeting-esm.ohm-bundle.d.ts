// AUTOGENERATED FILE
// This file was generated from greeting-esm.ohm by `ohm generateBundles`.

import {
  BaseActionDict,
  Grammar,
  IterationNode,
  Node,
  NonterminalNode,
  Semantics,
  TerminalNode
} from 'ohm-js';

export interface GreetingActionDict<T> extends BaseActionDict<T> {
  hello?: (this: NonterminalNode, arg0: TerminalNode) => T;
}

export interface GreetingSemantics extends Semantics {
  addOperation<T>(name: string, actionDict: GreetingActionDict<T>): this;
  extendOperation<T>(name: string, actionDict: GreetingActionDict<T>): this;
  addAttribute<T>(name: string, actionDict: GreetingActionDict<T>): this;
  extendAttribute<T>(name: string, actionDict: GreetingActionDict<T>): this;
}

export interface GreetingGrammar extends Grammar {
  createSemantics(): GreetingSemantics;
  extendSemantics(superSemantics: GreetingSemantics): GreetingSemantics;
}

declare const grammar: GreetingGrammar;
export default grammar;

