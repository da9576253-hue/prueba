'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseDuckHtml, parseDuckLite, resolveUrl } = require('../lib/parse');

const HTML = `
<div class="result"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa%3Fx%3D1&amp;rut=abc">Título <b>uno</b> &amp; más</a>
<a class="result__snippet" href="x">Descripción <b>uno</b></a></div>
<div class="result"><a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Anuncio</a></div>
<div class="result"><a class="result__a" href="javascript:alert(1)">Malo</a></div>
<div class="result"><a class="result__a" href="https://example.org/b">Dos</a></div>`;

test('parseDuckHtml extrae, decodifica y filtra', () => {
  const r = parseDuckHtml(HTML);
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0].url, 'https://example.com/a?x=1');
  assert.strictEqual(r[0].title, 'Título uno & más');
  assert.strictEqual(r[0].snippet, 'Descripción uno');
  assert.strictEqual(r[1].url, 'https://example.org/b');
});

test('parseDuckLite funciona con comillas simples', () => {
  const r = parseDuckLite(`<a rel="nofollow" href="https://example.net/" class='result-link'>Net</a></td></tr><tr><td class='result-snippet'>Texto</td>`);
  assert.deepStrictEqual(r, [{ title: 'Net', url: 'https://example.net/', snippet: 'Texto' }]);
});

test('resolveUrl rechaza esquemas peligrosos', () => {
  assert.strictEqual(resolveUrl('javascript:alert(1)'), null);
  assert.strictEqual(resolveUrl('data:text/html,hi'), null);
  assert.strictEqual(resolveUrl(''), null);
});
