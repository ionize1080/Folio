import test from 'node:test';
import assert from 'node:assert/strict';
import {RuleMemory} from '../src/rule-memory.mjs';
import {filterBookmarks} from '../src/bookmark-filter.mjs';
const storage=()=>{const m=new Map();return {getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v)}};
test('Rule drafts survive close/reopen, isolate operations and documents, cap history',()=>{
 const s=storage(),a=new RuleMemory(s,'a');a.remember('replace',{pattern:'^(第.*)',replacement:'$1',case:false});a.record('replace',a.get('replace'),'章节');a.remember('offset',{amount:'2'});
 assert.equal(new RuleMemory(s,'a').get('replace').replacement,'$1');assert.equal(new RuleMemory(s,'b').get('replace').pattern,'^(第.*)');
 const b=new RuleMemory(s,'b');b.remember('replace',{pattern:'other'});assert.equal(new RuleMemory(s,'a').get('replace').pattern,'^(第.*)');
 for(let i=0;i<30;i++)b.record('replace',{pattern:String(i)});assert.equal(b.data.history.length,20);b.clearHistory();assert.deepEqual(b.data.history,[]);assert.equal(b.get('replace').pattern,'29');
});
test('Corrupt rule storage recovers without blocking dialog',()=>{const s=storage();s.setItem('folio-rule-memory-v1-batch','{');assert.equal(new RuleMemory(s,'a').get('replace'),null)});
test('Regex bookmark matches exclude ancestor paths, support page intersection and Unicode',()=>{
 const nodes=[{id:'a',parent:null,title:'目录',target:{page:1}},{id:'b',parent:'a',title:'第十二章',target:{page:2}},{id:'c',parent:'a',title:'ABC',target:{page:3}}];
 assert.deepEqual(filterBookmarks(nodes,'^第.*章$',{regex:true}),{matches:['b'],visible:['b','a']});
 assert.deepEqual(filterBookmarks(nodes,'abc',{regex:true}).matches,['c']);assert.deepEqual(filterBookmarks(nodes,'abc',{regex:true,caseSensitive:true}).matches,[]);
 assert.deepEqual(filterBookmarks(nodes,'',{page:'2'}).matches,['b']);assert.throws(()=>filterBookmarks(nodes,'[',{regex:true}),/正则/);assert.throws(()=>filterBookmarks(nodes,'',{page:'0'}),/正整数/);
 assert.deepEqual(filterBookmarks(nodes,'第.*').matches,[]);
});
