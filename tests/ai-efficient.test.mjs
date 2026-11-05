import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {selectBookmarkIds,calibrationPages,calibrationPlan,pageResult} from '../src/ai-efficient.mjs';
import {treeOperation} from '../src/ai-tools.mjs';
import {makeNode} from '../src/model.mjs';
const require=createRequire(import.meta.url);
const {migrateSettings,prepareProfile}=require('../integrations/chatbox/profile.cjs');
const {ResultCache}=require('../integrations/chatbox/result-cache.cjs');
test('empty legacy seed removed without touching configured accounts or defaults',()=>{
 const s={providers:{'folio-qwen':{apiKey:'',models:[{modelId:'fake'}]},real:{apiKey:'credential'}},customProviders:[{id:'folio-qwen',name:'Folio Qwen'},{id:'real',name:'User'}],defaultChatModel:{provider:'real',model:'chosen'}};
 const next=migrateSettings(s);assert.equal(next.providers['folio-qwen'],undefined);assert.equal(next.providers.real.apiKey,'credential');assert.deepEqual(next.defaultChatModel,s.defaultChatModel);assert.equal(s.customProviders.length,2);
 s.providers['folio-qwen'].apiKey='configured';const retained=migrateSettings(s);assert.equal(retained.providers['folio-qwen'].apiKey,'configured');assert.equal(retained.customProviders[0].name,'Qwen (custom)');
 assert.deepEqual(migrateSettings({}),{});
});
test('profile migration persists all data once and leaves source for rollback',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'folio-profile-test-'));
 try {const legacy=path.join(root,'Folio/Chatbox-1.20.3');await fs.mkdir(legacy,{recursive:true});await fs.writeFile(path.join(legacy,'config.json'),'{"settings":{"chosen":true}}');const dest=prepareProfile(root);assert.equal(path.basename(dest),'Chatbox');await fs.writeFile(path.join(dest,'config.json'),'new');assert.equal(prepareProfile(root),dest);assert.equal(await fs.readFile(path.join(dest,'config.json'),'utf8'),'new');assert.match(await fs.readFile(path.join(legacy,'config.json'),'utf8'),/chosen/);}finally{await fs.rm(root,{recursive:true,force:true})}
});
test('selectors and atomic patches preserve child styles and unrelated properties',()=>{
 const a={...makeNode('Root',1),italic:true,color:'#ff0000'},b={...makeNode('Child',2,a.id),bold:false};
 const nodes=[a,b],ids=selectBookmarkIds(nodes,{scope:'roots'});assert.deepEqual(ids,[a.id]);
 const out=treeOperation('bookmark.patch',{ids,patch:{bold:true}},nodes,3).nodes;
 assert.equal(out[0].bold,true);assert.equal(out[0].italic,true);assert.equal(out[0].color,'#ff0000');assert.deepEqual(out[1],b);
 assert.throws(()=>selectBookmarkIds(nodes,{}));assert.throws(()=>selectBookmarkIds(nodes,{scope:'typo'}));
 assert.throws(()=>treeOperation('bookmark.patch',{changes:[{id:a.id,patch:{bold:true}},{id:'missing',patch:{bold:true}}]},nodes,3));assert.equal(a.bold,false);
});
test('calibration searches targets, not the currently displayed page; ambiguity is left for review',()=>{
 const nodes=[makeNode('A',8),makeNode('B',10)];assert.deepEqual(calibrationPages(nodes,10,1),[7,8,9,10]);
 const good={score:140,target:{page:8},evidence:'整行标题'},weak={score:30,target:{page:9}};
 const plan=calibrationPlan([{id:'a',candidates:[good]},{id:'b',candidates:[good,{...good}]},{id:'c',candidates:[weak]}]);assert.equal(plan.accepted.length,1);assert.equal(plan.review.length,2);
 const ocr=calibrationPlan([{id:'ocr',candidates:[{...good,segments:[{source:'OCR',confidence:0.7}]}]}]);assert.equal(ocr.accepted.length,0);assert.equal(ocr.review[0].confidence,0.7);
});
test('large MCP replies page losslessly without rerunning tools; images remain native',()=>{
 const cache=new ResultCache(),result={content:[{type:'text',text:'中文'.repeat(20000)}]};let page=cache.put(result),text='';const id=page.resultId;
 while(true){text+=page.text;if(page.nextOffset===null)break;page=cache.read({resultId:id,offset:page.nextOffset});}
 assert.deepEqual(JSON.parse(text),result);assert.throws(()=>cache.read({resultId:id,offset:-1}));
 const image={content:[{type:'image',data:'x'.repeat(20000)}]};assert.equal(cache.put(image),image);
 assert.equal(pageResult([1,2,3],{limit:2}).nextOffset,2);
});
