// src/app/tex.test.mjs: the TeX subset (tex.js) and the source tags'
// equations (tag-info.js). Run: node src/app/tex.test.mjs

import assert from 'node:assert/strict';
import { tex } from './tex.js';
import { TAG_INFO } from './tag-info.js';

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`ok ${n} ${name}`); };

ok('plain text of common forms', () => {
  assert.equal(tex('T = 2\\pi\\sqrt{\\frac{a^3}{\\mu}}').text, 'T = 2π√(a³/μ)');
  assert.equal(tex('a = \\left(\\frac{2}{r} - \\frac{v^2}{\\mu}\\right)^{-1}').text, 'a = (2/r − v²/μ)⁻¹');
  assert.equal(tex('\\Delta v = v_e\\ln\\frac{m}{m - m_\\text{fuel}}').text, 'Δv = vₑ ln(m/(m − m_fuel))');
  assert.equal(tex('t = \\frac{d}{c}').text, 't = d/c');
  assert.equal(tex('r_\\text{SOI} = d\\left(\\frac{\\mu}{\\mu_\\text{primary}}\\right)^{2/5}').text, 'r_SOI = d(μ/μ_primary)^(2/5)');
  assert.equal(tex('-\\mu').text, '−μ');
  // A power on a closing bar sits on it (it was read "|v_∞ |²").
  assert.equal(tex('C_3 = |\\mathbf v_\\infty|^2').text, 'C₃ = |𝐯_∞|²');
  // A sum still keeps its space, a sine its power.
  assert.equal(tex('\\sum_i x').text, '∑ᵢ x');
  assert.equal(tex('B\\sin^2\\varphi').text, 'B sin² φ');
});

ok('MathML structure', () => {
  const m = tex('\\Delta v = \\sqrt{v_\\infty^2 + \\frac{2\\mu}{r}}').mathml;
  assert.match(m, /^<mrow>/);
  assert.match(m, /<msqrt>.*<mfrac>.*<\/mfrac>.*<\/msqrt>/);
  assert.match(m, /<msubsup><mrow><mi>v<\/mi><\/mrow><mrow><mi>∞<\/mi><\/mrow><mrow><mn>2<\/mn><\/mrow><\/msubsup>/);
  // Vectors are the bold letters themselves (MathML Core has no bold variant).
  assert.match(tex('\\mathbf r').mathml, /<mi>𝐫<\/mi>/);
  // Text stays as written, spaces and all; markup is escaped.
  assert.match(tex('\\text{km/s} < 1').mathml, /<mtext>km\/s<\/mtext><mo>&lt;<\/mo>/);
  // Plain brackets don't stretch; \left \right ones do.
  assert.match(tex('(a)').mathml, /<mo stretchy="false" lspace="0" rspace="0">\(<\/mo>/);
  assert.match(tex('\\left(a\\right)').mathml, /<mo fence="true">\(<\/mo>/);
  // A leading or post-operator sign is a prefix; a function name gets its
  // thin spaces and the function application.
  assert.match(tex('a = -b').mathml, /<mo>=<\/mo><mo form="prefix">−<\/mo>/);
  assert.match(tex('a - b').mathml, /<mi>a<\/mi><mo>−<\/mo>/);
  assert.match(tex('R\\cos\\varphi').mathml, /<mi>R<\/mi><mspace width="0.167em"><\/mspace><mi mathvariant="normal">cos<\/mi><mo lspace="0" rspace="0.167em">\u2061<\/mo><mi>φ<\/mi>/);
  // A sum takes its limits underneath.
  assert.match(tex('\\sum_j x').mathml, /<munder>/);
});

ok('unknown commands and bad groups throw', () => {
  assert.throws(() => tex('\\nosuch x'), /unknown command/);
  assert.throws(() => tex('\\frac{a}{b'), /missing \}/);
  assert.throws(() => tex('a}'), /unbalanced/);
  assert.throws(() => tex('x_1_2'), /double subscript/);
});

ok('every tag equation parses, and every entry says what and where from', () => {
  const keys = Object.keys(TAG_INFO);
  assert.ok(keys.length >= 40, `${keys.length} entries`);
  for (const [k, e] of Object.entries(TAG_INFO)) {
    assert.ok(e.what && e.what.endsWith('.'), `${k}: what`);
    assert.ok(e.source, `${k}: source`);
    for (const line of e.tex) {
      const r = tex(line);
      assert.ok(r.mathml.length > 0 && r.text.length > 0, `${k}: ${line}`);
      assert.doesNotMatch(r.text, /\\/, `${k}: a command left in the text: ${r.text}`);
    }
  }
});

console.log(`tex: ${n} passed`);
