import test from 'node:test';
import assert from 'node:assert/strict';
import {FastFonts,fastLayout} from '../src/fast-layout.mjs';

function environment(){
  const old=globalThis.document;
  globalThis.document={createElement:()=>({getContext:()=>({measureText:()=>({width:12,actualBoundingBoxLeft:0,actualBoundingBoxRight:11,actualBoundingBoxAscent:10,actualBoundingBoxDescent:2})})})};
  return ()=>{globalThis.document=old;};
}
const face=(key,text)=>({key,name:key,family:key,coverage:new Set([...text].map(c=>c.codePointAt(0))),advances:{}});
async function drain(fonts){for(let i=0;i<20&&fonts.pendingMatches.size;i++)await new Promise(r=>setImmediate(r));assert.equal(fonts.pendingMatches.size,0);}

test('typing uses available glyphs immediately, then adopts the native outline choice without touching covered originals',async()=>{
  const restore=environment();let release,notifications=0,calls=0;
  try{
    const source=face('async-original','原'),builtin=face('builtin-cjk','新增字'),matched=face('chosen-outline','新增字');
    const f=new FastFonts(async(command,args)=>{
      if(command==='font-recommend'){calls++;assert.equal(args.missing,'新');await new Promise(r=>release=r);return {fonts:[{id:'match',match:'字形相近',confidence:'中'}]};}
      assert.equal(command,'font-select');return {fontKey:matched.key};
    },()=>notifications++);
    for(const q of [source,builtin])f.fonts.set(q.key,q);
    f.load=async key=>{assert.equal(key,matched.key);f.fonts.set(key,matched);return matched;};
    const m={text:'原新',fontKey:source.key,size:12};
    f.matchMissing(m);f.matchMissing(m);
    let commitReady=false;const commit=f.settle(m).then(()=>{commitReady=true;});
    assert.equal(f.measure('新',m).fontKey,'builtin-cjk');assert.equal(f.measure('原',m).fontKey,source.key);
    assert.equal(calls,1,'pending recommendation must be shared');
    await Promise.resolve();assert.equal(commitReady,false,'commit must not persist the temporary face');
    release();await commit;await drain(f);
    assert.equal(f.measure('新',m).fontKey,matched.key);assert.equal(f.measure('新',m).confidence,'中');assert.equal(notifications,1);
    f.matchMissing({...m,text:'原新增字'});await drain(f);assert.equal(calls,1,'full selected face covers subsequent new characters');
    assert.equal(f.measure('原',m).fontKey,source.key);f.dispose();
  }finally{restore();}
});

test('completed background recommendations cannot reactivate a closed editor',async()=>{
  const restore=environment();let release,notifications=0;
  try{
    const source=face('disposed-original','原'),matched=face('disposed-choice','新');
    const f=new FastFonts(async command=>{
      if(command==='font-recommend'){await new Promise(r=>release=r);return {fonts:[{id:'chosen'}]};}
      return {fontKey:matched.key};
    },()=>notifications++);
    f.fonts.set(source.key,source);f.load=async()=>matched;
    f.matchMissing({text:'新',fontKey:source.key});f.dispose();release();await drain(f);assert.equal(notifications,0);
  }finally{restore();}
});

test('a reopened editor joins an existing recommendation and waits before committing',async()=>{
  const restore=environment();let release,calls=0,notifications=0;
  try{
    const source=face('reopened-original','原'),matched=face('reopened-choice','新');
    const call=async command=>{
      if(command==='font-recommend'){calls++;await new Promise(r=>release=r);return {fonts:[{id:'chosen'}]};}
      return {fontKey:matched.key};
    };
    const first=new FastFonts(call);first.fonts.set(source.key,source);first.load=async()=>matched;
    const model={text:'原新',fontKey:source.key};first.matchMissing(model);first.dispose();
    const second=new FastFonts(call,()=>notifications++);second.fonts.set(source.key,source);second.load=async()=>matched;
    let committed=false;const commit=second.settle(model).then(()=>committed=true);
    await Promise.resolve();assert.equal(committed,false);assert.equal(calls,1);
    release();await commit;await drain(second);
    assert.equal(second.measure('新',model).fontKey,matched.key);assert.equal(notifications,1);second.dispose();
  }finally{restore();}
});

test('source whitespace does not trigger outline matching or report visible font loss',async()=>{
  const restore=environment();
  try{
    const f=new FastFonts(()=>{throw Error('whitespace must not trigger a recommendation');});
    f.fonts.set('whitespace-source',face('whitespace-source','A'));f.matchMissing({text:' \t\n',fontKey:'whitespace-source'});assert.equal(f.pendingMatches.size,0);
    const m={text:'A A',fontKey:'whitespace-source',pageWidth:300,pageHeight:200,frame:{x:20,y:20,width:200,height:100},size:12,lineHeight:1.4,align:'left',color:'#000000'};
    const r=fastLayout(m,ch=>({width:10,fontKey:'replacement',fallback:ch===' ',name:'spacing'}));
    assert.equal(r.fallbackCount,0);f.dispose();
  }finally{restore();}
});

test('production preloads emergency faces once at paragraph entry, retaining embedded glyph selection',async()=>{
  const restore=environment();
  try{
    const f=new FastFonts(()=>{},()=>{},{preloadFallback:true}),loaded=[];
    f.load=async key=>{loaded.push(key);const data=face(key,'原新A ');f.fonts.set(key,data);return data;};
    const m={text:'原',fontKey:'preload-original',size:12};await f.prepare(m);
    assert.deepEqual(loaded,['preload-original','builtin-latin','builtin-cjk']);assert.equal(f.measure('原',m).fontKey,'preload-original');f.dispose();
  }finally{restore();}
});

test('a cold same-name system face does not block the first missing keystroke in production',async()=>{
  const restore=environment();
  try{
    const f=new FastFonts(()=>{},()=>{},{preloadFallback:true});
    f.fonts.set('same-name-source',{...face('same-name-source','原'),systemKey:'unloaded-system'});
    f.fonts.set('builtin-latin',face('builtin-latin','A '));f.fonts.set('builtin-cjk',face('builtin-cjk','新'));
    const m={text:'原新',fontKey:'same-name-source',size:12};
    assert.equal(f.ready(m),true);assert(!f.required(m).has('unloaded-system'));
    assert.equal(f.measure('原',m).fontKey,'same-name-source');assert.equal(f.measure('新',m).fontKey,'builtin-cjk');f.dispose();
  }finally{restore();}
});
