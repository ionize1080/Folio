import test from 'node:test';import assert from 'node:assert/strict';
import {pageCandidates,checkFlowConflicts,hitOffset,caretRect} from '../src/flow-page-model.mjs';
const object=(index,text,x,y)=>({index,type:'text',text,size:280,matrix:[.05,0,0,.05,x,y],bounds:[x,y-3,x+text.length*14,y+11],flowEditable:true,signature:'s'+index,textGroup:4,fill:[0,0,0,255]});
test('page-space font sizes and reading order survive 0.05 Office transforms',()=>{
 const c=pageCandidates([object(0,'第一行正文',90,700),object(1,'第二行正文',90,670)],595,842);
 assert.equal(c.length,1);assert.equal(c[0].model.size,14);assert.equal(c[0].model.text,'第一行正文第二行正文');assert(c[0].model.frame.height<110);
});
test('independent whitespace operators need not be deleted with a paragraph',()=>{
 const a=object(0,'测试',90,700),space=object(1,' ',118,700);
 const c=pageCandidates([a,space],595,842);assert.deepEqual(c[0].model.sources.map(s=>s.index).sort(),[0]);
});
test('caret and selection hit testing use shaped glyph coordinates',()=>{
 const gs=[{start:0,end:1,x:60,y:80,w:12,h:16,line:0},{start:1,end:2,x:72,y:80,w:8,h:16,line:0}];
 assert.equal(hitOffset(gs,74,85),1);assert.equal(hitOffset(gs,79,85),2);assert.equal(caretRect(gs,2,{}).x,80);
});
test('real ink cannot overwrite another paragraph or a table rule',()=>{
 const m={pageHeight:842,frame:{x:60,y:80,width:400,height:180},sources:[]};
 const ink=[{x:60,y:80,w:12,h:16}];
 assert.throws(()=>checkFlowConflicts(m,[{type:'text',text:'protected',index:0,bounds:[60,746,80,762]}],[],1,null,ink));
 assert.doesNotThrow(()=>checkFlowConflicts(m,[{type:'text',text:'protected',index:0,bounds:[300,600,320,630]}],[],1,null,ink));
 assert.throws(()=>checkFlowConflicts(m,[{type:'path',index:0,bounds:[50,754,200,755]}],[],1,null,ink));
});
