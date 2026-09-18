import test from 'node:test';
import assert from 'node:assert/strict';
import {caretRect} from '../src/flow-page-model.mjs';

test('punctuation caret uses local font metrics before and after the dot',()=>{
 const glyphs=[{start:0,end:1,x:10,y:9,w:10,h:11,baseline:20,size:12,line:0},
 {start:1,end:2,x:20,y:18,w:3,h:2,baseline:20,size:12,line:0}];
 const m={size:12,frame:{x:0,y:0},lineHeight:1.4};
 for(const offset of [0,1,2]) {
  const c=caretRect(glyphs,offset,m);assert.equal(c.h,12);assert.equal(c.y,9.8);
 }
 assert.equal(caretRect(glyphs,1,m).x,20);
 assert.equal(caretRect(glyphs,2,m).x,23);
});
test('caret preserves real small text and restores legacy glyph metrics from style runs',()=>{
 const m={size:12,runs:[{start:0,end:1,size:6}],frame:{x:0,y:0},lineHeight:1.4};
 assert.equal(caretRect([{start:0,end:1,x:10,y:12,w:2,h:1,baseline:15}],0,m).h,6);
 assert.equal(caretRect([{start:0,end:1,x:10,y:12,w:2,h:1,baseline:15,size:8}],0,m).h,8);
 assert(Math.abs(caretRect([],0,m).h-16.8)<1e-9);
});
