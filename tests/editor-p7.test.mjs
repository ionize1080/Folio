import test from 'node:test';
import assert from 'node:assert/strict';
import {pageCandidates} from '../src/flow-page-model.mjs';
const object=(i,text,x,y,width=200,size=10)=>({index:i,type:'text',text,size,flowEditable:true,editable:true,signature:String(i),bounds:[x,y-2,x+width,y+8],matrix:[1,0,0,1,x,y],fontKey:'test',fontName:'Test'});
test('three spanning headlines do not merge a narrow two-column article',()=>{
 const os=[];
 for(let j=0;j<3;j++)os.push(object(os.length,'Spanning title '+j,70,740-j*25,450,20));
 for(let row=0;row<12;row++)for(let col=0;col<2;col++)os.push(object(os.length,`column${col} row${row}`,80+col*218,640-row*18));
 const ms=pageCandidates(os,600,800).map(c=>c.model);
 for(const m of ms){assert(!(m.text.includes('column0')&&m.text.includes('column1')));if(m.text.includes('column'))assert(m.frame.width<215);}
 assert(ms.some(m=>m.sources.length===12));
});
test('mixed style fragments inside a full-width article are not false columns',()=>{
 const os=[];
 for(let row=0;row<12;row++)for(let part=0;part<4;part++)os.push(object(os.length,`part${part}`,40+part*125,700-row*15,123));
 const ms=pageCandidates(os,600,800);assert.equal(ms.length,1);assert.equal(ms[0].model.sources.length,48);
});
