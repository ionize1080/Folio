import test from 'node:test';
import assert from 'node:assert/strict';
import {correctOCRBlocks,pendingOCRReview} from '../src/ocr-data.mjs';
test('AI confirmation of unchanged OCR text resolves native review without falsifying confidence',()=>{
  const input=[{text:'ii',needsReview:true,reviewAccepted:false,confidence:0.99,reviewReasons:['direction-conflict']}];
  const result=correctOCRBlocks(input,[{index:0,text:'ii'}]);
  assert.equal(pendingOCRReview(result[0]),false);
  assert.equal(result[0].reviewAccepted,true);
  assert.equal(result[0].confidence,0.99);
  assert.deepEqual(result[0].reviewReasons,input[0].reviewReasons);
  assert.equal(pendingOCRReview(input[0]),true);
  assert.equal(result[0].originalText,'ii');
});
test('OCR exclusion is explicit and unresolved blocks retain the review gate',()=>{
  const input=[{text:'a',needsReview:true},{text:'b',needsReview:true}];
  const result=correctOCRBlocks(input,[{index:0,excluded:true}]);
  assert.equal(pendingOCRReview(result[0]),false);
  assert.equal(pendingOCRReview(result[1]),true);
  for(const corrections of [[{index:2,text:'bad'}],[{index:0}],[{index:0,excluded:'true'}],[{index:0,text:'a'},{index:0,text:'b'}],{}])
    assert.throws(()=>correctOCRBlocks(input,corrections));
  assert.deepEqual(input,[{text:'a',needsReview:true},{text:'b',needsReview:true}]);
});
