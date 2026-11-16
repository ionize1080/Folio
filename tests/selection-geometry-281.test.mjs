import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeSelectionRects} from '../src/selection-geometry.mjs';
test('edited glyphs become one band per line, including spaces and mixed font metrics',()=>{
  const glyphs=Array.from({length:20},(_,i)=>({x:30+i*8,y:40+(i%3)*.3,width:6,height:12}));
  const merged=mergeSelectionRects(glyphs);assert.equal(merged.length,1);assert.equal(merged[0].width,158);
  const lines=mergeSelectionRects([...glyphs,...glyphs.map(r=>({...r,y:r.y+20})),{x:300,y:40,width:80,height:12}]);
  assert.equal(lines.length,3,'Separate rows and columns cannot be bridged');
});
test('vertical glyphs merge along their baseline and angled text stays separate',()=>{
  const glyphs=Array.from({length:10},(_,i)=>({x:50,y:30+i*12,width:12,height:10,axis:'vertical'}));
  const merged=mergeSelectionRects(glyphs);assert.equal(merged.length,1);assert.equal(merged[0].height,118);
  assert.equal(mergeSelectionRects(glyphs.map(r=>({...r,axis:'other'}))).length,10);
});
