import * as pexprs from './pexprs-main.js';

// --------------------------------------------------------------------
// Fallible: `B ! C`
// --------------------------------------------------------------------

/*
  Without recovery, a fallible is the sequence `B C`.
*/

pexprs.Fallible.prototype.eval = function (state) {
  return state.eval(this.fallible) && state.eval(this.join);
};
