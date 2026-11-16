import test from 'node:test';import assert from 'node:assert/strict';
import {bookmarkRowLayout} from '../src/bookmark-row-layout.mjs';
test('variable bookmark rows preserve exact scroll positions and binary viewport lookup',()=>{
 const sizes=[34,48,34,34,48],layout=bookmarkRowLayout(sizes.length,i=>sizes[i]);
 assert.equal(layout.total,198);assert.deepEqual(sizes.map((_,i)=>layout.top(i)),[0,34,82,116,150]);
 for(let y=0;y<198;y++){const i=layout.indexAt(y);assert(y>=layout.top(i)&&y<layout.top(i)+layout.height(i));}
 assert.equal(layout.indexAt(1000),4);assert.equal(bookmarkRowLayout(0,()=>34).total,0);
 const large=bookmarkRowLayout(200000,i=>i%3?34:48);assert.equal(large.indexAt(large.top(199999)),199999);
});
