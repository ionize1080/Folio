import test from 'node:test';import assert from 'node:assert/strict';
import {pageCandidates,checkFlowConflicts,growthLimit} from '../src/flow-page-model.mjs';
import {editStyles} from '../src/flow-style.mjs';
const text=(i,x,y,t='正文内容正文内容正文内容')=>({index:i,type:'text',text:t,flowEditable:true,size:10,matrix:[1,0,0,1,x,842-y],bounds:[x,842-y-2,x+140,842-y+8],textGroup:1,independentFlow:true,signature:''+i});
test('one shared BT never merges three native columns even with a whole-page AI region',()=>{
 const objects=[0,1,2].flatMap(col=>[0,1,2,3].map(row=>text(col*10+row,40+col*170,100+row*14)));
 const cs=pageCandidates(objects,595,842,[{kind:'text',bounds:[0,0,595,842]}]);
 assert.equal(cs.length,3);assert(cs.every(c=>c.model.frame.width<170));assert(cs.every(c=>c.model.sources.length===4));
});
test('overlapping frames with disjoint committed glyphs are allowed',()=>{
 const model={sources:[],pageHeight:842,frame:{x:50,y:50,width:200,height:200}};
 const edits=[{id:'other',page:1,type:'flow',sources:[],model,ink:[{x:190,y:150,w:10,h:14}]}];
 assert.doesNotThrow(()=>checkFlowConflicts(model,[],edits,1,'self',[{x:60,y:80,w:10,h:14}]));
 assert.throws(()=>checkFlowConflicts(model,[],edits,1,'self',[{x:190,y:150,w:10,h:14}]));
});
test('smart growth stops at a nearby text obstacle and respects cell border',()=>{
 const m={sources:[],pageHeight:842,size:10,frame:{x:50,y:50,width:150,height:50}};
 assert(growthLimit(m,[text(1,50,200)],[],1,'self')<160);
 assert.equal(growthLimit({...m,cell:{bounds:[48,48,202,102]}},[],[],1,'self'),50);
});
test('table rows become independent cell models, including empty cells',()=>{
 const tables=[{id:'t0',rows:2,columns:2,bounds:[40,40,340,140],cells:[{id:'a',row:0,column:0,bounds:[40,40,190,90]},{id:'b',row:0,column:1,bounds:[190,40,340,90]},{id:'c',row:1,column:0,bounds:[40,90,190,140]},{id:'d',row:1,column:1,bounds:[190,90,340,140]}]}];
 const cs=pageCandidates([text(0,45,65,'单元格')],595,842,[],tables);
 assert.equal(cs.filter(c=>c.model.cell).length,4);assert.equal(cs.find(c=>c.id==='a').model.text,'单元格');assert.equal(cs.find(c=>c.id==='d').model.text,'');
});
test('insertion, replacement and deletion inherit run typography with UTF-16 offsets',()=>{
 const runs=[{start:0,end:2,fontKey:'serif'},{start:2,end:4,fontKey:'bold'}];
 const a=editStyles(runs,'甲乙丙丁','甲乙新增丙丁');assert.deepEqual(a,[{start:0,end:4,fontKey:'serif'},{start:4,end:6,fontKey:'bold'}]);
 assert.deepEqual(editStyles(a,'甲乙新增丙丁','甲丁'),[{start:0,end:1,fontKey:'serif'},{start:1,end:2,fontKey:'bold'}]);
});
