import test from 'node:test';import assert from 'node:assert/strict';
import {canvasPlacement,expandedCanvas,contentBounds,studioTransform} from '../src/studio-canvas-geometry.mjs';
test('arbitrary canvas edits preserve artwork scale and page coordinates under rotation/shear',()=>{
 for(const matrix of [[300,0,0,180,10,20],[0,300,-180,20,400,200],[-300,40,50,180,800,70]]){
  const next=canvasPlacement(matrix,[0,0,300,180],[-30,-20,480,260]),[a,b,c,d,e,f]=matrix,[A,B,C,D,E,F]=next;
  for(const [x,y] of [[70,50],[140,120]]){const p=[e+a*x/300+c*(1-y/180),f+b*x/300+d*(1-y/180)],q=[E+A*(x+30)/480+C*(1-(y+20)/260),F+B*(x+30)/480+D*(1-(y+20)/260)];assert(p.every((n,i)=>Math.abs(n-q[i])<1e-8));}
 }
});
test('automatic canvas growth expands only crossed edges with slack; shrinking content does nothing',()=>{
 const original=[0,0,300,180],next=expandedCanvas(original,[-10,20,340,80],16);assert.deepEqual(next,[-26,0,372,180]);assert.equal(expandedCanvas(next,[10,30,30,30]),null);
 const doc={layers:[{visible:false,bounds:{x:-1000,y:-1000,width:2000,height:2000}},{children:[{bounds:{x:10,y:20,width:30,height:40},strokeWidth:4}]}]};assert.deepEqual(contentBounds(doc,'vector'),[8,18,34,44]);
});
test('studio handles use actual viewport, view rotation and HiDPI photo scale',()=>{
 const state={ui:{views:[{zoom:2,center:[100,50],rotation:30,flip:true}],session:{active:0},window:{pixelsPerPoint:2},canvasRect:[40,30,800,600]}};
 const map=studioTransform('photo',state);for(const p of [[0,0],[300,180]])assert(map.toDocument(map.toScreen(p)).every((n,i)=>Math.abs(n-p[i])<1e-8));
});
