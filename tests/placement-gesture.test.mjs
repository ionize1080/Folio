import test from 'node:test';
import assert from 'node:assert/strict';
import {dragPlacement} from '../src/placement-gesture.mjs';
const at=(m,u,v)=>[m[0]*u+m[2]*v+m[4],m[1]*u+m[3]*v+m[5]];
test('dragging preserves the linear transform for rotated, mirrored and sheared artwork',()=>{
 for(const m of [[100,0,0,60,32,48],[0,100,-60,0,80,70],[-100,30,20,60,200,100]]){
  const r=dragPlacement(m,[5,8],[25,-2],null);
  assert.deepEqual(r.slice(0,4),m.slice(0,4));assert.deepEqual(r.slice(4),[m[4]+20,m[5]-10]);
 }
});
test('all four locked corners keep opposite corner fixed and preserve proportions',()=>{
 for(const m of [[100,0,0,60,32,48],[0,100,-60,0,80,70],[-100,30,20,60,200,100]])for(const [u,v] of [[0,0],[1,0],[1,1],[0,1]]){
  const start=at(m,u,v),end=at(m,(1-u)+(u-(1-u))*1.6,(1-v)+(v-(1-v))*1.6);
  const r=dragPlacement(m,start,end,[u,v],true),before=at(m,1-u,1-v),after=at(r,1-u,1-v);
  assert(after.every((n,i)=>Math.abs(n-before[i])<1e-8));
  assert(Math.abs(Math.hypot(r[0],r[1])/Math.hypot(r[2],r[3])-Math.hypot(m[0],m[1])/Math.hypot(m[2],m[3]))<1e-8);
 }
});
test('unlocked dimensions vary independently and crossing never collapses the object',()=>{
 const m=[100,0,0,50,0,0];assert.deepEqual(dragPlacement(m,[100,50],[200,75],[1,1],false),[200,0,0,75,0,0]);
 const r=dragPlacement(m,[100,50],[-200,-100],[1,1],false);assert(r[0]>0&&r[3]>0);
});
