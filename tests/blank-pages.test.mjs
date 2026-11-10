import test from 'node:test';
import assert from 'node:assert/strict';
import {blankPagePlan} from '../src/blank-pages.mjs';
const base={mode:'position',page:2,position:'after',count:2,orientation:'keep'};
test('blank page dimensions follow visible reference orientation and target position',()=>{
  assert.deepEqual(blankPagePlan(base,5,[808,595]),{count:2,at:2,width:808,height:595});
  assert.deepEqual(blankPagePlan({...base,position:'before',orientation:'portrait'},5,[808,595]),{count:2,at:1,width:595,height:808});
  const custom=blankPagePlan({...base,mode:'custom',unit:'in',width:8.5,height:11},5);
  assert.equal(custom.width,612);assert.equal(custom.height,792);
});
test('blank page insertion rejects invalid dimensions and counts before editing order',()=>{
  for(const change of [{count:0},{count:1.5},{count:1001},{page:6},{page:NaN},{position:'invalid'},{orientation:'invalid'},{mode:'custom',width:Infinity,height:1,unit:'pt'},{mode:'standard',paper:'invalid'}])
    assert.throws(()=>blankPagePlan({...base,...change},5,[595,842]));
});
