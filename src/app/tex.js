// src/app/tex.js
//
// A small TeX subset to MathML, for the equations in the source tags'
// detail (tag-info.js). The equations are written as the physics docs write
// them (docs/physics/*.md), so each one can be checked against its doc by
// eye, and the browser typesets them itself: MathML Core, in Chromium,
// Firefox and Safari, with no library and no web font.
//
// tex(s) returns { mathml, text }:
//   mathml  the <math> element's inner markup (one <mrow>)
//   text    the same equation as one line of plain Unicode, for screen
//           readers (the tag's description) and anywhere MathML is not
//           wanted: "T = 2π√(a³/μ)"
//
// The subset: letters, digits and operators; ^ and _; groups in braces;
// \frac \tfrac \sqrt \mathbf \hat \dot \ddot \bar \text \mathrm
// \left ... \right; Greek letters by name or as Unicode; the function names
// (\ln \sin \cos \arccos ...); \sum and \int; a few relations and spaces.
// Anything else throws, so a typo fails the tests rather than the page.

const GREEK = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', eta: 'η', theta: 'θ',
  kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ',
  phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};
// Identifiers that are symbols: the Sun's and the Earth's, infinity.
const SYMBOLS = { odot: '⊙', oplus: '⊕', infty: '∞', partial: '∂', ell: 'ℓ' };
const OPERATORS = {
  cdot: '·', times: '×', le: '≤', leq: '≤', ge: '≥', geq: '≥', approx: '≈', pm: '±', mp: '∓',
  neq: '≠', to: '→', propto: '∝', equiv: '≡', lvert: '|', rvert: '|', sum: '∑', int: '∫',
};
const FUNCTIONS = new Set(['ln', 'log', 'exp', 'sin', 'cos', 'tan', 'arccos', 'arcsin', 'arctan', 'sinh', 'cosh', 'min', 'max', 'atan2']);
const SPACES = { ',': 0.167, ';': 0.278, ':': 0.222, ' ': 0.25, quad: 1, qquad: 2 };
const ACCENTS = { hat: ['^', '̂'], dot: ['˙', '̇'], ddot: ['¨', '̈'], bar: ['¯', '̄'], tilde: ['~', '̃'] };
const LARGE = new Set(['∑', '∫']);
// Operators set with space around them in the plain text.
const SPACED = new Set(['=', '+', '−', '≤', '≥', '≈', '±', '∓', '≠', '→', '<', '>', '∝', '≡', '×']);
const FENCES = new Set(['(', ')', '[', ']', '|', '‖', '⟨', '⟩']);

const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '−': '⁻', '+': '⁺', n: 'ⁿ', i: 'ⁱ', '(': '⁽', ')': '⁾' };
const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ' };

// Mathematical bold: vectors (\mathbf r). MathML Core drops mathvariant
// other than "normal", so the letters themselves are the bold ones.
function bold(s) {
  return [...s].map((ch) => {
    const c = ch.codePointAt(0);
    if (c >= 0x41 && c <= 0x5a) return String.fromCodePoint(0x1d400 + c - 0x41);
    if (c >= 0x61 && c <= 0x7a) return String.fromCodePoint(0x1d41a + c - 0x61);
    if (c >= 0x3b1 && c <= 0x3c9) return String.fromCodePoint(0x1d6c2 + c - 0x3b1);
    if (c >= 0x30 && c <= 0x39) return String.fromCodePoint(0x1d7ce + c - 0x30);
    return ch;
  }).join('');
}

function tokenize(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {
      let j = i + 1;
      if (/[A-Za-z]/.test(s[j] ?? '')) while (j < s.length && /[A-Za-z]/.test(s[j])) j++;
      else j++;
      out.push({ t: 'cmd', v: s.slice(i + 1, j) });
      i = j;
    } else if (/\s/.test(c)) {
      i++;
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] ?? ''))) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      out.push({ t: 'num', v: s.slice(i, j) });
      i = j;
    } else if ('{}^_'.includes(c)) {
      out.push({ t: c, v: c });
      i++;
    } else {
      const ch = String.fromCodePoint(s.codePointAt(i));
      out.push({ t: 'char', v: ch });
      i += ch.length;
    }
  }
  return out;
}

function parse(src) {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const fail = (msg) => { throw new Error(`tex: ${msg} in "${src}"`); };
  const expect = (t) => { if (peek()?.t !== t) fail(`expected ${t}`); p++; };

  // The raw text of a braced argument (for \text), spaces kept.
  const rawArg = () => {
    expect('{');
    let depth = 1, out = '';
    for (;;) {
      const tk = toks[p++];
      if (!tk) fail('unclosed {');
      if (tk.t === '{') depth++;
      if (tk.t === '}' && --depth === 0) break;
      out += tk.t === 'cmd' ? (tk.v === ' ' || tk.v === ',' ? ' ' : `\\${tk.v}`) : tk.v;
    }
    return out;
  };
  const arg = () => {
    if (peek()?.t === '{') { p++; return seq('}'); }
    const a = atom();
    if (!a) fail('missing argument');
    return a;
  };

  function atom() {
    const tk = toks[p];
    if (!tk) return null;
    if (tk.t === '{') { p++; return seq('}'); }
    if (tk.t === 'num') { p++; return { k: 'mn', v: tk.v }; }
    if (tk.t === 'char') {
      p++;
      const v = tk.v === '-' ? '−' : tk.v === '*' ? '·' : tk.v === "'" ? '′' : tk.v;
      if (/\p{L}/u.test(v) || v in SYMBOLS_BY_CHAR) return { k: 'mi', v };
      return { k: 'mo', v, fence: FENCES.has(v) };
    }
    if (tk.t === 'cmd') {
      p++;
      const n = tk.v;
      if (n === 'frac' || n === 'tfrac' || n === 'dfrac') { const a = arg(); const b = arg(); return { k: 'frac', a, b }; }
      if (n === 'sqrt') return { k: 'sqrt', a: arg() };
      if (n === 'mathbf' || n === 'boldsymbol') {
        const a = arg();
        const letters = flat(a);
        if (letters === null) fail('\\mathbf takes letters');
        return { k: 'mi', v: bold(letters), bold: true };
      }
      if (n in ACCENTS) return { k: 'accent', a: arg(), acc: ACCENTS[n] };
      if (n === 'text' || n === 'mathrm') return { k: n === 'text' ? 'mtext' : 'mi', v: textOf(), upright: true };
      if (n === 'left') {
        const open = delim();
        const inner = seq('right');
        const close = delim();
        return { k: 'fence', open, close, a: inner };
      }
      if (n in GREEK) return { k: 'mi', v: GREEK[n] };
      if (n in SYMBOLS) return { k: 'mi', v: SYMBOLS[n] };
      if (n in OPERATORS) return { k: 'mo', v: OPERATORS[n], large: LARGE.has(OPERATORS[n]) };
      if (FUNCTIONS.has(n)) return { k: 'mi', v: n, fn: true };
      if (n in SPACES) return { k: 'space', w: SPACES[n] };
      if (n === '|') return { k: 'mo', v: '‖', fence: true };
      if (n === '{' || n === '}') return { k: 'mo', v: n, fence: true };
      fail(`unknown command \\${n}`);
    }
    fail(`unexpected ${tk.t}`);
    return null;
  }

  function delim() {
    const tk = toks[p++];
    if (!tk) fail('missing delimiter');
    if (tk.t === 'char' && (tk.v === '.' )) return '';
    if (tk.t === 'char') return tk.v;
    if (tk.t === 'cmd' && tk.v === '|') return '‖';
    if (tk.t === 'cmd' && (tk.v === '{' || tk.v === '}')) return tk.v;
    if (tk.t === 'cmd' && (tk.v === 'lvert' || tk.v === 'rvert')) return '|';
    fail('bad delimiter');
    return '';
  }

  // \text{...}: the source between the braces, verbatim.
  function textOf() {
    if (peek()?.t !== '{') fail('\\text needs braces');
    // Find the matching brace in the source by counting from the token's
    // position: walk the source for the n-th '{' that is this token.
    let braces = 0;
    for (let q = 0; q < p; q++) if (toks[q].t === '{') braces++;
    let at = -1;
    for (let i = 0, seen = 0; i < src.length; i++) {
      if (src[i] === '{' && src[i - 1] !== '\\') { if (seen === braces) { at = i; break; } seen++; }
    }
    rawArg();
    if (at < 0) fail('\\text brace');
    let depth = 0, i = at;
    for (; i < src.length; i++) {
      if (src[i] === '{' && src[i - 1] !== '\\') depth++;
      if (src[i] === '}' && src[i - 1] !== '\\' && --depth === 0) break;
    }
    return src.slice(at + 1, i);
  }

  // A sequence up to a closing token ('}' or \right), or the end.
  function seq(close) {
    const items = [];
    for (;;) {
      const tk = peek();
      if (!tk) { if (close) fail(`missing ${close}`); break; }
      if (close === '}' && tk.t === '}') { p++; break; }
      if (close === 'right' && tk.t === 'cmd' && tk.v === 'right') { p++; break; }
      if (tk.t === '}') fail('unbalanced }');
      if (tk.t === '^' || tk.t === '_') {
        // Scripts attach to the item before them (or to nothing).
        const base = items.pop() ?? { k: 'row', c: [] };
        items.push(scripts(base));
        continue;
      }
      items.push(atom());
    }
    return items.length === 1 ? items[0] : { k: 'row', c: items };
  }

  function scripts(base) {
    let sub = null, sup = null;
    while (peek() && (peek().t === '^' || peek().t === '_')) {
      const t = toks[p++].t;
      const a = arg();
      if (t === '_') { if (sub) fail('double subscript'); sub = a; } else { if (sup) fail('double superscript'); sup = a; }
    }
    return { k: 'script', base, sub, sup };
  }

  const tree = seq(null);
  return tree;
}

const SYMBOLS_BY_CHAR = Object.fromEntries(Object.values(SYMBOLS).map((v) => [v, true]));

// The letters of a node made only of identifiers (for \mathbf), else null.
function flat(n) {
  if (n.k === 'mi' || n.k === 'mn') return n.v;
  if (n.k === 'row') {
    let s = '';
    for (const c of n.c) { const f = flat(c); if (f === null) return null; s += f; }
    return s;
  }
  return null;
}

// A sign with nothing before it, or after another operator, is unary.
const unary = (c, prev) => c.k === 'mo' && ['−', '+', '±', '∓'].includes(c.v)
  && (!prev || (prev.k === 'mo' && !')]|‖°′'.includes(prev.v)));
// A degree sign or prime closes the number before it.
const POSTFIX = new Set(['°', '′']);
// A function name, alone or with a power (sin²).
const fnLike = (c) => (c.k === 'mi' && c.fn) || (c.k === 'script' && c.base.k === 'mi' && c.base.fn);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const one = (n) => { const m = ml(n); return n.k === 'row' ? m : `<mrow>${m}</mrow>`; };

function ml(n) {
  switch (n.k) {
    case 'mi': return n.upright || n.fn || [...n.v].length > 1 ? `<mi mathvariant="normal">${esc(n.v)}</mi>` : `<mi>${esc(n.v)}</mi>`;
    case 'mn': return `<mn>${esc(n.v)}</mn>`;
    case 'mtext': return `<mtext>${esc(n.v)}</mtext>`;
    case 'mo': return POSTFIX.has(n.v) ? `<mo form="postfix">${esc(n.v)}</mo>` : n.fence ? `<mo stretchy="false" lspace="0" rspace="0">${esc(n.v)}</mo>` : n.large ? `<mo largeop="true" movablelimits="false">${esc(n.v)}</mo>` : `<mo>${esc(n.v)}</mo>`;
    case 'space': return `<mspace width="${n.w}em"></mspace>`;
    case 'row': return `<mrow>${n.c.map((c, i) => {
      const prev = n.c[i - 1], next = n.c[i + 1];
      if (unary(c, prev)) return `<mo form="prefix">${esc(c.v)}</mo>`;
      // A function name: a thin space either side, as TeX sets \cos,
      // with the (invisible) function application after it.
      if (fnLike(c)) {
        const before = prev && prev.k !== 'mo' && prev.k !== 'space' ? '<mspace width="0.167em"></mspace>' : '';
        const snug = next && (next.k === 'fence' || (next.k === 'mo' && next.v === '('));
        return `${before}${ml(c)}<mo lspace="0" rspace="${snug ? 0 : 0.167}em">\u2061</mo>`;
      }
      return ml(c);
    }).join('')}</mrow>`;
    case 'frac': return `<mfrac>${one(n.a)}${one(n.b)}</mfrac>`;
    case 'sqrt': return `<msqrt>${ml(n.a)}</msqrt>`;
    case 'accent': return `<mover accent="true">${one(n.a)}<mo stretchy="false">${esc(n.acc[0])}</mo></mover>`;
    case 'fence': return `<mrow>${n.open ? `<mo fence="true">${esc(n.open)}</mo>` : ''}${ml(n.a)}${n.close ? `<mo fence="true">${esc(n.close)}</mo>` : ''}</mrow>`;
    case 'script': {
      const b = one(n.base);
      // A sum or integral takes its limits below and above.
      const under = n.base.k === 'mo' && n.base.v === '∑';
      if (n.sub && n.sup) return under ? `<munderover>${b}${one(n.sub)}${one(n.sup)}</munderover>` : `<msubsup>${b}${one(n.sub)}${one(n.sup)}</msubsup>`;
      if (n.sub) return under ? `<munder>${b}${one(n.sub)}</munder>` : `<msub>${b}${one(n.sub)}</msub>`;
      return `<msup>${b}${one(n.sup)}</msup>`;
    }
    default: throw new Error(`tex: node ${n.k}`);
  }
}

// A script's text: no space around its operators (x⁻¹, a_(p,a)), but its
// words kept apart (μ_(Sgr A*)).
const tight = (t) => t.trim().replace(/\s+/g, ' ').replace(/ ?([−+=,/]) ?/g, '$1');

// One line of plain text. Atomic nodes need no brackets around them.
const atomic = (n) => n.k === 'mi' || n.k === 'mn' || n.k === 'fence' || n.k === 'accent' || n.k === 'sqrt'
  || (n.k === 'script' && atomic(n.base)) || (n.k === 'row' && n.c.length === 1 && atomic(n.c[0]));
const wrap = (n) => (atomic(n) ? txt(n) : `(${txt(n)})`);
const mapAll = (s, m) => ([...s].every((c) => c in m) ? [...s].map((c) => m[c]).join('') : null);

function txt(n) {
  switch (n.k) {
    case 'mi': return n.fn ? ` ${n.v} ` : n.v;
    case 'mn': return n.v;
    case 'mtext': return n.v;
    case 'mo': return SPACED.has(n.v) ? ` ${n.v} ` : n.v === ',' ? ', ' : n.large ? `${n.v} ` : n.v;
    case 'space': return ' ';
    case 'row': return n.c.map((c, i) => {
      const prev = n.c[i - 1];
      if (unary(c, prev)) return ` ${c.v}`;
      // A fraction after a function name is its argument: ln(m₀/m_f).
      if (c.k === 'frac' && prev?.k === 'mi' && prev.fn) return `(${txt(c)})`;
      // Keep products apart where they would run together: ½ρ v², C_D A.
      const operand = (x) => x && x.k !== 'mo' && x.k !== 'space';
      if (operand(prev) && operand(c) && (['script', 'frac', 'sqrt'].includes(prev.k) || c.k === 'frac')) return ` ${txt(c)}`;
      return txt(c);
    }).join('');
    case 'frac': return `${wrap(n.a)}/${wrap(n.b)}`;
    case 'sqrt': { const a = n.a; return atomic(a) && a.k !== 'sqrt' ? `√${txt(a)}` : `√(${txt(a)})`; }
    case 'accent': return `${txt(n.a)}${n.acc[1]}`;
    case 'fence': return `${n.open}${txt(n.a)}${n.close}`;
    case 'script': {
      let s = n.base.k === 'row' && n.base.c.length === 0 ? '' : wrap(n.base);
      if (n.base.k === 'mo' || (n.base.k === 'mi' && n.base.fn)) s = n.base.v;
      if (n.sub) { const t = tight(txt(n.sub)); s += ([...t].length === 1 ? mapAll(t, SUB) : null) ?? (atomic(n.sub) || /^\w+$/u.test(t) ? `_${t}` : `_(${t})`); }
      if (n.sup) { const t = tight(txt(n.sup)); s += mapAll(t, SUP) ?? (atomic(n.sup) ? `^${t}` : `^(${t})`); }
      return n.base.k === 'mo' || n.base.fn ? ` ${s} ` : s;
    }
    default: throw new Error(`tex: node ${n.k}`);
  }
}

const cache = new Map();

/** @param {string} s @returns {{ mathml: string, text: string }} */
export function tex(s) {
  let r = cache.get(s);
  if (!r) {
    const tree = parse(s);
    r = { mathml: ml(tree.k === 'row' ? tree : { k: 'row', c: [tree] }), text: txt(tree).replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').replace(/(\p{L}) \(/gu, (m, a, i, all) => (/(ln|log|exp|sin|cos|tan|min|max)$/.test(all.slice(0, i + 1)) ? `${a}(` : m)).trim() };
    cache.set(s, r);
  }
  return r;
}
