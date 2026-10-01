import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { t, translate, normalizeLanguage, setLanguage, getLanguage, identify } from '../src/i18n.mjs';
import { en, zhHant } from '../src/locales/catalog.mjs';
test('English default, valid aliases and unsupported locale fallback',()=>{
 assert.equal(getLanguage(),'en');
 assert.equal(normalizeLanguage('zh-TW'),'zh-Hant');
 assert.equal(normalizeLanguage('zh-CN'),'zh-Hans');
 assert.equal(normalizeLanguage('__proto__'),'en');
 assert.equal(normalizeLanguage('fr'),'en');
});
test('Every bundled entry has matching placeholders and a Traditional translation',()=>{
 const params=s=>[...s.matchAll(/\{\d+\}/g)].map(m=>m[0]).sort();
 assert(Object.keys(en).length>1800);
 for(const [source,value]of Object.entries(en)){
  assert(value.trim(),source);assert(zhHant[source]?.trim(),source);
  assert.deepEqual(params(value),params(source),source);
  assert.deepEqual(params(zhHant[source]),params(source),source);
  assert(!/[\u3400-\u9fff]/u.test(value),source);
 }
 assert.deepEqual(en,JSON.parse(fs.readFileSync(new URL('../src/locales/en.json',import.meta.url))));
 assert.deepEqual(zhHant,JSON.parse(fs.readFileSync(new URL('../src/locales/zh-Hant.json',import.meta.url))));
});
test('Dynamic message parameters preserve document content and template syntax',()=>{
 assert.equal(translate('第 7 页：保存'),'Page 7: 保存');
 assert.equal(translate('  第 7 页：保存  '),'  Page 7: 保存  ');
 assert.equal(t('第 {0} 页：{1}',{0:3,1:'<script>打开</script>'},'en'),'Page 3: <script>打开</script>');
 assert.equal(translate('a user title 打开 保存'),'a user title 打开 保存');
 assert.equal(t('可用变量：{n}、{title}、{page}、{level}',{},'en'),'Variables: {n}, {title}, {page}, {level}');
 assert(identify('第 15 页'));assert.equal(identify('Plain user data'),null);
});
test('Locale changes do not mutate source catalogs',()=>{
 for(const locale of ['zh-Hans','zh-Hant','en']){setLanguage(locale);assert.equal(getLanguage(),locale);}
 assert.equal(t('保存'),'Save');assert.equal(t('保存',{},'zh-Hant'),'儲存');
});
