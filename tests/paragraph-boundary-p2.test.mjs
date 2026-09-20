import test from 'node:test';
import assert from 'node:assert/strict';
import { paragraphCandidates } from '../src/flow-model.mjs';
const row=(i,text,left,right,base,fontName='宋体')=>({index:i,type:'text',flowEditable:true,text,size:12,fontName,matrix:[1,0,0,1,left,base],bounds:[left,base-2,right,base+10]});
test('short numbered heading remains separate from indented body',()=>{
 const r=paragraphCandidates([row(0,'7、政策风险',40,115,700),row(1,'2015 年国务院发布有关政策要求',64,500,680),row(2,'其余正文在下一视觉行继续',40,450,660)],800);
 assert.equal(r.length,2);assert.equal(r[0].text,'7、政策风险');assert.match(r[1].text,/下一视觉行/);
});
test('ordinary visual wrapping stays in one paragraph',()=>{
 const r=paragraphCandidates([row(0,'这是普通正文的第一行',40,480,700),row(1,'接续上一行的正文内容。',40,470,682)],800);
 assert.equal(r.length,1);
});
