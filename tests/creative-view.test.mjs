import test from 'node:test';
import assert from 'node:assert/strict';
import {viewPlan} from '../src/creative-view.mjs';
const base={bounds:[10,20,100,200],canvas:[30,40,800,600],center:[70,130],zoom:1};
test('Fit accounts for dock-reduced canvas dimensions and margins',()=>{
  const fit=viewPlan(base,{mode:'fit'});assert.equal(fit.zoom,2.76);assert.deepEqual(fit.center,[60,120]);
  assert.equal(viewPlan(base,{mode:'width',margin:0}).zoom,8);
  assert.equal(viewPlan(base,{mode:'height',margin:0}).zoom,3);
  assert.equal(viewPlan({...base,rotation:90},{mode:'width',margin:0}).zoom,4);
});
test('Centering only moves the selected screen axis, even after rotation',()=>{
  assert.deepEqual(viewPlan(base,{mode:'center-x'}).center,[60,130]);
  assert.deepEqual(viewPlan(base,{mode:'center-y'}).center,[70,120]);
  const rotated=viewPlan({...base,rotation:90},{mode:'center-x'});assert(Math.abs(rotated.center[0]-70)<1e-9);assert(Math.abs(rotated.center[1]-120)<1e-9);
  assert.equal(rotated.zoom,1);
});
test('Detailed zoom reaches 12800% photo and 64000% vector without resizing artwork',()=>{
  assert.equal(viewPlan({...base,maxZoom:128},{mode:'zoom',percent:12800}).zoom,128);
  assert.equal(viewPlan(base,{mode:'zoom',percent:64000}).zoom,640);
  assert.equal(viewPlan(base,{mode:'zoom',percent:90000}).zoom,640);
  assert.deepEqual(base.bounds,[10,20,100,200]);assert.throws(()=>viewPlan(base,{mode:'zoom',percent:0}));assert.throws(()=>viewPlan(base,{mode:'zoom',percent:NaN}));
});
