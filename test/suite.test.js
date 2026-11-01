'use strict';
const test = require('node:test');
const assert = require('node:assert');

const { parseDuckHtml, parseDuckLite, parseBingHtml, parseGoogleGbvHtml, resolveUrl } = require('../lib/parse');
const { isPrivateHost, encodeProxyUrl, decodeTargetUrl, rewriteHtml } = require('../lib/proxy');
const { dnsCache } = require('../lib/doh');
const { getSuggestions } = require('../lib/suggest');
const { generateResilientResults } = require('../lib/search-engines');

test('parseDuckHtml extrae, decodifica y filtra', () => {
  const HTML = `
  <div class="result"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa%3Fx%3D1&amp;rut=abc">Título <b>uno</b> &amp; más</a>
  <a class="result__snippet" href="x">Descripción <b>uno</b></a></div>
  <div class="result"><a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Anuncio</a></div>
  <div class="result"><a class="result__a" href="javascript:alert(1)">Malo</a></div>
  <div class="result"><a class="result__a" href="https://example.org/b">Dos</a></div>`;

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

test('parseBingHtml extrae resultados estructurados de Bing', () => {
  const bingHtml = `<ol id="b_results"><li class="b_algo"><h2><a href="https://es.wikipedia.org/wiki/Lupin">Lupin - Wikipedia</a></h2><div class="b_caption"><p>Lupin es una serie francesa...</p></div></li></ol>`;
  const res = parseBingHtml(bingHtml);
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].url, 'https://es.wikipedia.org/wiki/Lupin');
  assert.strictEqual(res[0].title, 'Lupin - Wikipedia');
  assert.strictEqual(res[0].snippet, 'Lupin es una serie francesa...');
});

test('parseGoogleGbvHtml extrae resultados de Google GBV=1', () => {
  const gHtml = `<div class="kCrYT"><a href="/url?q=https://es.wikipedia.org/wiki/Lupin&amp;sa=U"><div class="BNeawe vvjwJb AP7Wnd">Lupin (serie de televisión)</div></a></div><div class="kCrYT"><div><div><div class="BNeawe s3v9rd AP7Wnd">Lupin es una serie creada por George Kay...</div></div></div></div>`;
  const res = parseGoogleGbvHtml(gHtml);
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].url, 'https://es.wikipedia.org/wiki/Lupin');
  assert.strictEqual(res[0].title, 'Lupin (serie de televisión)');
  assert.strictEqual(res[0].snippet, 'Lupin es una serie creada por George Kay...');
});

test('resolveUrl rechaza esquemas peligrosos', () => {
  assert.strictEqual(resolveUrl('javascript:alert(1)'), null);
  assert.strictEqual(resolveUrl('data:text/html,hi'), null);
  assert.strictEqual(resolveUrl(''), null);
});

test('proxy: isPrivateHost bloquea localhost y rangos privados (SSRF)', () => {
  assert.strictEqual(isPrivateHost('localhost'), true);
  assert.strictEqual(isPrivateHost('127.0.0.1'), true);
  assert.strictEqual(isPrivateHost('10.0.0.1'), true);
  assert.strictEqual(isPrivateHost('192.168.1.1'), true);
  assert.strictEqual(isPrivateHost('172.16.0.1'), true);
  assert.strictEqual(isPrivateHost('169.254.169.254'), true);
  assert.strictEqual(isPrivateHost('google.com'), false);
  assert.strictEqual(isPrivateHost('es.wikipedia.org'), false);
});

test('proxy: encodeProxyUrl y decodeTargetUrl procesan URLs correctamente', () => {
  const target = 'https://example.org/noticias?id=123';
  const encoded = encodeProxyUrl(target);
  assert.strictEqual(encoded, '/proxy?url=https%3A%2F%2Fexample.org%2Fnoticias%3Fid%3D123');

  const parsedUrl = new URL('http://localhost' + encoded);
  const decoded = decodeTargetUrl(parsedUrl);
  assert.strictEqual(decoded, target);
});

test('proxy: rewriteHtml reescribe enlaces y agrega barra VPN', () => {
  const html = `<html><head><title>Test</title></head><body><a href="https://example.org/page">Enlace</a></body></html>`;
  const rewritten = rewriteHtml(html, 'https://example.org');
  assert.ok(rewritten.includes('href="/proxy?url=https%3A%2F%2Fexample.org%2Fpage"'));
  assert.ok(rewritten.includes('id="__vpn_bar__"'));
  assert.ok(rewritten.includes('TÚNEL VPN ACTIVO'));
});

test('doh: dnsCache inicializada correctamente', () => {
  assert.ok(dnsCache instanceof Map);
});

test('suggest: getSuggestions devuelve array', async () => {
  const res = await getSuggestions('te');
  assert.ok(Array.isArray(res));
});

test('search-engines: generateResilientResults devuelve resultados garantizados', () => {
  const res = generateResilientResults('lupin');
  assert.ok(res.length >= 4);
  assert.ok(res[0].url.includes('wikipedia.org'));
  assert.ok(res[0].title.includes('lupin'));
});
