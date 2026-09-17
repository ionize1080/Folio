// Minimal layout/event host for the real continuous-review controller.
// This checks event/navigation state, not browser rendering or CSS.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createOCRStream} from '../src/ocr-stream.mjs';
class Element {
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.style={};this.events={};this.clientWidth=700;this.clientHeight=400;this.scrollTop=0;this.className='';this.classList={toggle(){},add(){}};}
 append(...es){for(const e of es){e.remove();e.parent=this;this.children.push(e)}}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(e=>e!==this);this.parent=null}
 replaceChildren(...es){for(const e of [...this.children])e.remove();this.append(...es)}
 querySelectorAll(selector){const tags=selector.split(',');const all=[];for(const c of this.children){if(tags.some(t=>t.startsWith('.')?c.className.split(' ').includes(t.slice(1)):c.tagName===t.toUpperCase()))all.push(c);all.push(...c.querySelectorAll(selector))}return all}
 getBoundingClientRect(){return this.rect||{top:0,left:0,right:680,bottom:400,height:400,width:680}}
 addEventListener(t,f){(this.events[t]??=[]).push(f)}
 removeEventListener(t,f){this.events[t]=(this.events[t]||[]).filter(x=>x!==f)}
 dispatch(t,e={}){for(const f of this.events[t]||[])f(e)}
 getContext(){return {}}
 scrollIntoView(){this.reveals=(this.reveals||0)+1}
 closest(selector){return selector.split(',').includes(this.tagName.toLowerCase())?this:this.parent?.closest(selector)}
}
const tick=()=>new Promise(r=>setTimeout(r,0));
function setup(){
 globalThis.document={createElement:t=>new Element(t)};globalThis.devicePixelRatio=1;
 const host=new Element('div'),canvas=new Element('canvas'),boxes=new Element('div'),calls=[];
 const pdf={getPage:async()=>({getViewport:()=>({width:595,height:842,convertToViewportPoint:(x,y)=>[x,y]}),render:()=>({promise:Promise.resolve(),cancel(){}})})};
 const stream=createOCRStream({host,canvas,boxes,pdf,rotation:()=>0,getBlocks:async()=>[{text:'target',quad:[[20,20],[120,20],[120,40],[20,40]],confidence:1}],onPage:async(...a)=>{calls.push(a);stream.move(a[0],a[2])},isLocked:()=>false,toast:m=>{throw Error(m)}});
 stream.setPages([1,2]);stream.move(1);return {host,stream,calls};
}
test('Clicking an active OCR page or an interactive descendant does not reload/reset the page',async()=>{
 const {host,stream,calls}=setup();await tick();const [active,passive]=host.children;
 active.onclick({target:active});const button=new Element('button');active.append(button);active.onclick({target:button});passive.onclick({target:button});await tick();
 assert.equal(calls.length,0);assert.equal(active.reveals||0,0);stream.destroy();
});
test('Clicking a passive OCR hit navigates once and keeps the selected block index',async()=>{
 const {host,stream,calls}=setup();await tick();await tick();
 const passive=host.children[1],hit=passive.querySelectorAll('button')[0];assert(hit);
 let stopped=false;hit.onclick({stopPropagation(){stopped=true}});await tick();
 assert(stopped);assert.deepEqual(calls,[[2,0,true]]);stream.destroy();
});
test('An explicit selection resists programmatic scroll, then wheel navigation unlocks it',async()=>{
 const {host,stream,calls}=setup();await tick();
 host.children[0].rect={top:-900,bottom:-100,height:800};host.children[1].rect={top:0,bottom:900,height:900};
 stream.pin();stream.refresh();await new Promise(r=>setTimeout(r,140));assert.equal(calls.length,0);
 host.dispatch('wheel');host.dispatch('scroll');await new Promise(r=>setTimeout(r,140));assert.deepEqual(calls,[[2,null,false]]);stream.destroy();
 assert.equal(host.events.scroll.length,0);assert.equal(host.events.wheel.length,0);
});
