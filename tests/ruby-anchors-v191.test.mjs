import test from 'node:test';
import assert from 'node:assert/strict';
import {rubyAnchors,rubyConflicts} from '../src/ruby-anchors.mjs';
const base={text:'割',originX:222,baseline:93.2,x:222.5,y:81.6,w:12.5,h:13};
const objects=[{type:'text',index:3,glyphs:[base]},
  {type:'text',index:4,text:'gE',bounds:[224,655.7,234,664.2]}];
const model={pageHeight:737,sources:[{index:3}],text:'割'};

test('nearby small pinyin attaches to its Han character, not its paragraph frame',()=>{
  assert.equal(rubyAnchors(objects,new Set([3]),737).length,1);
  assert.deepEqual(rubyConflicts(model,objects,[base]),[]);
  assert.equal(rubyConflicts(model,objects,[{...base,originX:250}])[0].kind,'annotation');
  assert.equal(rubyConflicts({...model,text:'刮'},objects,[{...base,text:'刮'}]).length,1);
  assert.equal(rubyConflicts({...model,text:''},objects,[]).length,1);
});

test('unrelated small labels and distant annotation do not protect the page',()=>{
  for(const modified of [{...objects[1],bounds:[224,600,234,608]},
    {...objects[1],bounds:[300,655.7,310,664.2]},
    {...objects[1],text:'正文'}])
    assert.deepEqual(rubyAnchors([objects[0],modified],new Set([3]),737),[]);
  assert.deepEqual(rubyConflicts({...model,sources:[]},objects,[]),[]);
});

test('pinyin with descenders uses text em size rather than the shorter Han ink height',()=>{
  const o=[{type:'text',index:24,size:1,matrix:[14,0,0,14],glyphs:[
    {text:'丞',originX:270.138,baseline:362.724,x:270.418,y:351.678,w:13.342,h:11.956}]},
    {type:'text',index:25,text:'chRng',bounds:[264.903,386.195,289.063,397.065]}];
  assert.equal(rubyAnchors(o,new Set([24]),737.008)[0].glyph.text,'丞');
});
