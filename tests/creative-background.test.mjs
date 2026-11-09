import test from 'node:test';
import assert from 'node:assert/strict';
import {referenceQuad} from '../src/creative-background.mjs';
import {viewPlan} from '../src/creative-view.mjs';
import {placement} from '../src/graphic-geometry.mjs';
const close=(a,b)=>a.forEach((v,i)=>assert(Math.abs(v-b[i])<1e-7,`${a} != ${b}`));
test('PDF reference corners stay registered through zoom, rotation, shear, reflection and nonzero crop origin',()=>{
  const page=[20,40,620,840],art=[15,25,1200,800];
  for(const matrix of [[240,0,0,160,70,90],[0,240,-160,0,300,90],[-240,0,45,160,400,90],[240,35,45,-160,70,500]]){
    const original=structuredClone(matrix),quad=referenceQuad(page,matrix,art);
    const corners=[[20,840],[620,840],[620,40],[20,40]];
    for(const percent of [25,100,1200,12800,64000]){
      const view=viewPlan({bounds:art,canvas:[0,0,1100,750],center:[615,425],zoom:1,rotation:33},{mode:'zoom',percent});
      assert(view.zoom>0);
      // Recover PDF coordinates from reference artwork points, independent of camera scale.
      quad.forEach(([x,y],i)=>{const u=(x-art[0])/art[2],v=1-(y-art[1])/art[3];close([matrix[0]*u+matrix[2]*v+matrix[4],matrix[1]*u+matrix[3]*v+matrix[5]],corners[i]);});
      assert.deepEqual(matrix,original);
    }
  }
});
test('Changing only placement size preserves existing flipped and sheared axes',()=>{
  const base=[-240,30,45,160,70,90],p=placement({width:500},base).matrix;
  close(p.slice(2),base.slice(2));assert(p[0]<0);assert.equal(Math.round(Math.hypot(...p.slice(0,2))),500);
  close(placement({x:80},base).matrix,[-240,30,45,160,80,90]);
  assert.throws(()=>referenceQuad([0,0,10,10],[1,0,0,0,0,0],[0,0,10,10]));
});
