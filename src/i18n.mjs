/** Offline UI localization. Never translates document data or editable values.
 * Existing UI messages use their immutable source text as compatibility keys.
 * New components can use t() and onLanguageChange() directly.
 */
import { en, zhHant } from './locales/catalog.mjs';
export const languages = Object.freeze([
  { id: 'en', name: 'English', lang: 'en' },
  { id: 'zh-Hans', name: '简体中文', lang: 'zh-Hans' },
  { id: 'zh-Hant', name: '繁體中文', lang: 'zh-Hant' },
]);
export const normalizeLanguage = value => languages.some(l=>l.id===value) ? value : Object.hasOwn({'en-US':1,'en-GB':1,'zh-CN':1,'zh-SG':1,'zh-TW':1,'zh-HK':1,'zh-MO':1},value) ? ({en:'en','en-US':'en','en-GB':'en','zh-CN':'zh-Hans','zh-SG':'zh-Hans','zh-Hans':'zh-Hans','zh-TW':'zh-Hant','zh-HK':'zh-Hant','zh-MO':'zh-Hant','zh-Hant':'zh-Hant'}[String(value)] || 'en') : 'en';
let language = 'en';
try { language = normalizeLanguage(globalThis.localStorage?.getItem('folio-language')); } catch {}
export const getLanguage = () => language;
const listeners = new Set();
export function onLanguageChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function setLanguage(value) {
  const next = normalizeLanguage(value);
  try { globalThis.localStorage?.setItem('folio-language', next); } catch {}
  if (next === language) return;
  language = next;
  for (const fn of listeners) fn(next);
}
const normalize = text => String(text).trim().replace(/\s+/g, ' ');
const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patterns = Object.keys(en).filter(k => /\{\d+\}/.test(k)).map(key => {
  const ids = [...key.matchAll(/\{(\d+)\}/g)].map(m => m[1]);
  const parts = key.split(/\{\d+\}/);
  return {key, ids, parts, weight:parts.join('').length,
    regex:new RegExp('^'+parts.map(escapeRegex).join('([\\s\\S]*?)')+'$')};
}).sort((a,b)=>b.weight-a.weight);
const exact = new Map(Object.keys(en).map(key => [normalize(key),key]));
const cache = new Map();
const prefixes = Object.keys(en).filter(k=>/[：:]$/.test(k) && k.length>3 && !/\{\d+\}/.test(k)).sort((a,b)=>b.length-a.length);
export function identify(text) {
  const source = normalize(text);
  if (exact.has(source)) return { key:exact.get(source), args:{} };
  if (!/[\u3400-\u9fff]/u.test(source) || source.length > 8000) return null;
  if (cache.has(source)) return cache.get(source);
  let found = null;
  for (const p of patterns) {
    if (p.weight < 2 || !p.parts.every(s=>!s || source.includes(s))) continue;
    const m = p.regex.exec(source);
    if (m) { found={key:p.key,args:Object.fromEntries(p.ids.map((id,i)=>[id,m[i+1]]))}; break; }
  }
  if (cache.size >= 1500) cache.clear();
  cache.set(source,found);
  return found;
}
export function t(source, args = {}, locale = language) {
  const dictionary = locale === 'zh-Hant' ? zhHant : locale === 'zh-Hans' ? null : en;
  return (dictionary?.[source] ?? source).replace(/\{(\d+)\}/g,(m,id)=>Object.hasOwn(args,id)?String(args[id]):m);
}
export function translate(text, locale = language) {
  const message = identify(text);
  if (message) return String(text).match(/^\s*/)[0] + t(message.key,message.args,locale) + String(text).match(/\s*$/)[0];
  for(const prefix of prefixes)if(String(text).startsWith(prefix))return t(prefix,{},locale)+String(text).slice(prefix.length);
  // Concatenated legacy notices keep variable data intact; only independently
  // recognized sentence fragments on either side of a separator are translated.
  return String(text).split(/(\n| · |；|; )/).map(part=>{
    const m=identify(part);return m?t(m.key,m.args,locale):part;
  }).join('');
}
// These surfaces contain user data, even when it happens to match a UI label.
const contentSelector = [
 '[translate="no"]','[data-user-content]','[contenteditable]','textarea',
 '.textLayer','.page-edit-input','.page-edit-composition','.annotation-mark',
 '#tree-rows .title','#tree-rows [role="treeitem"]','#doc-name[data-file]',
 '#ocr-results','#ocr-boxes','#ocr-candidates','#ocr-evidence',
 '#pe-font-list','#pe-font','#pe-overlap-select','#pe-fallback-panel',
 '#table-grid','[data-list]','[data-name]','[data-preview]',
 '#open-password-file','#decrypt-file','#rule-nav button','#gen-toc','#raw-current','#raw-original','#update-notes',
 '#rule-list input','#rule-list textarea',
].join(',');
const excluded = el => !el || !!el.closest(contentSelector) || ['SCRIPT','STYLE','SVG','CANVAS'].includes(el.tagName);
const textSources = new WeakMap(), attrSources = new WeakMap();
const attributes=['title','aria-label','aria-description','placeholder','alt'];
function renderText(node) {
  const el=node.parentElement;
  if(excluded(el))return;
  const current=node.data, old=textSources.get(node);
  const source=old && old.output===current ? old.source : current;
  const output=translate(source);
  textSources.set(node,{source,output});
  if(current!==output) {
    // Options without explicit values use their label as a value. Keep the
    // original value stable so localization cannot alter application state.
    if(el.tagName==='OPTION' && !el.hasAttribute('value'))el.value=el.textContent;
    node.data=output;
  }
}
function renderAttributes(el) {
  // Input *values* are never touched. Its UI placeholder and label may translate.
  if(el.matches('textarea,input')) {
    if(el.closest('[translate="no"],[data-user-content]'))return;
  } else if(excluded(el))return;
  let records=attrSources.get(el);if(!records)attrSources.set(el,records=new Map());
  for(const attr of attributes){
    if(!el.hasAttribute(attr))continue;
    const current=el.getAttribute(attr),old=records.get(attr),source=old?.output===current?old.source:current;
    const output=translate(source);records.set(attr,{source,output});
    if(current!==output)el.setAttribute(attr,output);
  }
}
export function localizeTree(root) {
  if(root.nodeType===3){renderText(root);return;}
  if(root.nodeType!==1 || excluded(root))return;
  renderAttributes(root);
  for(const child of root.childNodes) {
    if(child.nodeType===3)renderText(child);
    else if(child.nodeType===1)localizeTree(child);
  }
}
export function languagePicker(id='language-select') {
  return `<label class="language-picker" title="Language / 语言"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 6h14M5 18h14"/></svg><span class="sr-only" translate="no">Language / 语言</span><select id="${id}" data-language-select aria-label="Language / 语言" translate="no">${languages.map(l=>`<option value="${l.id}" lang="${l.lang}"${l.id===language?' selected':''}>${l.name}</option>`).join('')}</select></label>`;
}
export function installLocalization() {
  const root=document.documentElement;
  function refresh(){
    root.lang=language;
    root.dir='ltr';
    localizeTree(document.body);
    document.querySelectorAll('[data-language-select]').forEach(el=>el.value=language);
    const live=document.getElementById('language-announcement');
    if(live)live.textContent={en:'Language: English','zh-Hans':'语言：简体中文','zh-Hant':'語言：繁體中文'}[language];
    window.desktop?.setLanguage?.(language).catch(()=>{});
  }
  document.getElementById('language-slot').innerHTML=languagePicker();
  document.addEventListener('change',event=>{
    if(event.target.matches('[data-language-select]'))setLanguage(event.target.value);
  });
  onLanguageChange(refresh);
  refresh();
  const observer=new MutationObserver(records=>{
    // Process only changed subtrees. Never traverse PDF text layers per keystroke.
    for(const r of records){
      if(r.type==='characterData')renderText(r.target);
      else if(r.type==='attributes')renderAttributes(r.target);
      else for(const node of r.addedNodes)localizeTree(node);
    }
  });
  observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:attributes});
  root.classList.add('i18n-ready');
  return ()=>observer.disconnect();
}

// Logic that consumes UI status must read the source, never a translated label.
export function sourceText(element) {
  return [...element.childNodes].map(node=>node.nodeType===3?(textSources.get(node)?.source ?? node.data):sourceText(node)).join('');
}

export function untranslatedUI(root=document.body) {
  const found=[];
  const visit=el=>{
    if(excluded(el))return;
    if(el.getClientRects().length && getComputedStyle(el).visibility!=='hidden') {
      for(const node of el.childNodes)if(node.nodeType===3 && /[\u3400-\u9fff]/u.test(node.data))found.push({text:node.data.trim(),tag:el.tagName,id:el.id,class:el.className});
      for(const attr of attributes)if(/[\u3400-\u9fff]/u.test(el.getAttribute(attr)||'') && !el.matches('[data-language-select],.language-picker'))found.push({text:el.getAttribute(attr),attr,tag:el.tagName,id:el.id});
    }
    for(const child of el.children)visit(child);
  };
  visit(root);return found.filter(x=>x.text);
}
