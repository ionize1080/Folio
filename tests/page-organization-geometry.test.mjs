import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,PDFName,PDFNumber,degrees} from '../src/vendor/pdf-lib.js';
import {organizerGeometry,readPageBoxes} from '../src/page-organization-geometry.mjs';

test('inherited blank dimensions use scaled CropBox, UserUnit, page rotation and organizer rotation',async()=>{
  const pdf=await PDFDocument.create(),page=pdf.addPage([600,800]);
  page.setMediaBox(100,200,600,800);page.setCropBox(150,250,500,700);page.setRotation(degrees(90));page.node.set(PDFName.of('UserUnit'),PDFNumber.of(2));
  const [info]=await readPageBoxes(await pdf.save());
  assert.deepEqual(organizerGeometry({rotation:0},info).displayedSize,[1400,1000]);
  const result=organizerGeometry({size:[300,400],crop:[10,20,30,40],rotation:90},info);
  assert.deepEqual(result.displayedSize,[420,580]);assert.equal(result.rotation,180);
  assert.deepEqual(result.sourceRect,[10/250,20/350,210/250,290/350]);
});

test('visible inheritance intersects CropBox with MediaBox and handles blank-page edits',()=>{
  const info={media:{x:20,y:40,width:600,height:800},crop:{x:0,y:0,width:500,height:700},rotation:270,userUnit:1};
  assert.deepEqual(organizerGeometry({size:[300,400],crop:[0,0,0,0],rotation:90},info).displayedSize,[240,330]);
  assert.deepEqual(organizerGeometry({blank:true,width:300,height:400,size:[600,800],crop:[10,20,30,40],rotation:90}).displayedSize,[740,560]);
  assert.throws(()=>organizerGeometry({blank:true,width:300,height:400,crop:[150,0,150,0]}),/保留/);
});
