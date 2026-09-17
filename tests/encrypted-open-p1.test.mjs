import test from 'node:test';
import assert from 'node:assert/strict';
import { preparePDFOpen } from '../src/encrypted-open.mjs';
const encrypted = () => Object.assign(Error('encrypted'), {code:'PDF_ENCRYPTED'});
test('Ordinary PDFs retain original bytes and never invoke decryption',async()=>{
 const bytes=new Uint8Array([1]);let unlocked=false;
 const r=await preparePDFOpen(bytes,{parse:async()=>({info:{pageCount:1}}),unlock:async()=>{unlocked=true}});
 assert.equal(r.bytes,bytes);assert.equal(r.openedEncrypted,false);assert.equal(unlocked,false);
});
test('Encrypted open reparses only decrypted bytes before exposing state',async()=>{
 const original=new Uint8Array([1]),plain=new Uint8Array([2]);const seen=[];
 const r=await preparePDFOpen(original,{parse:async data=>{seen.push([...data]);if(data[0]===1)throw encrypted();return {info:{pageCount:3}}},unlock:async()=>({bytes:plain,signed:true})});
 assert.deepEqual(seen,[[1],[2]]);assert.equal(r.openedEncrypted,true);assert.equal(r.signed,true);assert.equal(r.info.pageCount,3);assert.deepEqual([...original],[1]);
});
test('Cancel returns no new state; malformed PDFs never trigger a password prompt',async()=>{
 let parses=0;
 assert.equal(await preparePDFOpen(new Uint8Array([1]),{parse:async()=>{parses++;throw encrypted()},unlock:async()=>null}),null);assert.equal(parses,1);
 await assert.rejects(preparePDFOpen(new Uint8Array([1]),{parse:async()=>{throw Error('damaged')},unlock:async()=>{throw Error('incorrectly prompted')}}),/damaged/);
});
test('Decryption/second-parse failure cannot return a partially opened document',async()=>{
 await assert.rejects(preparePDFOpen(new Uint8Array([1]),{parse:async()=>{throw encrypted()},unlock:async()=>({needsPassword:true})}),/解密未完成/);
 let count=0;await assert.rejects(preparePDFOpen(new Uint8Array([1]),{parse:async()=>{if(!count++)throw encrypted();throw Error('bad plaintext')},unlock:async()=>({bytes:[2]})}),/bad plaintext/);
});
