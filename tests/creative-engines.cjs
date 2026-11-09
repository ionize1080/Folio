const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const checks=[];
(async()=>{const {app,page,call}=await require('./creative-harness.cjs')();try{
  for(const kind of ['photo','vector']){
    const session=await call({action:'open',kind,settings:{width:128,height:96}}),sessionId=session.sessionId;
    const request=a=>call({sessionId,...a}),cmd=async(command,params={})=>await request({action:'execute',command,params});
    const all=await request({action:'request',method:'engine.commands'});assert(all.length>900);
    const ids=new Set(all.map(c=>c.id));
    const required=kind==='photo'?['paint.cloneStamp','paint.healingBrush','paint.patch','edit.contentAwareFill','select.rect','layer.layerMask.revealAll','paint.stroke','filter.liquify','edit.transform.warpGrid','image.mode.bits32','image.mode.cmyk','view.proofColors','actions.play']:['path.create','shape.rectangle','text.create','object.align','object.distribute','object.pathfinder.unite','shapeBuilder.merge','paint.setFill','imageTrace.make','effect.apply','artboard.new','symbol.new'];
    for(const id of required)assert(ids.has(id),id);
    const before=await request({action:'preview'});assert(before.content.some(c=>c.type==='image'));
    if(kind==='photo'){
      await cmd('layer.new.layer',{name:'Paint and repair'});
      await cmd('paint.stroke',{points:[[20,20],[90,65]],size:18,color:'#e65336',hardness:1,seed:1});
      await cmd('paint.cloneStamp',{points:[[70,20],[85,20]],source:[30,28],size:12});
      await cmd('paint.healingBrush',{points:[[90,25],[95,30]],source:[25,25],size:8});
      await cmd('select.rect',{x:45,y:36,width:10,height:10});
      await cmd('paint.patch',{offset:[-16,-12]});
      await cmd('edit.contentAwareFill',{seed:1,output:'current'});
      await cmd('select.deselect');
      await cmd('layer.layerMask.revealAll');
      await cmd('paint.stroke',{points:[[30,30],[50,40]],size:12,color:'#000000',target:'mask'});
      await cmd('filter.liquify',{strokes:[{tool:'forwardWarp',size:22,points:[[70,50],[78,55]]}]});
      await cmd('layer.smartObjects.convertToSmartObject');
      await cmd('filter.blur.gaussianBlur',{radius:1.5});
      await cmd('image.mode.bits16');
    }else{
      const a=await cmd('shape.rectangle',{x:10,y:10,width:50,height:45});
      const b=await cmd('shape.rectangle',{x:40,y:25,width:55,height:40});
      await cmd('object.pathfinder.unite',{ids:[a.id,b.id]});
      await cmd('paint.setFill',{gradient:{kind:'linear',stops:[{offset:0,color:'#e65336'},{offset:1,color:'#245bd4'}]}});
      await cmd('object.align',{horizontal:'center',to:'artboard'});
      await cmd('path.create',{anchors:[{x:8,y:78,out:[30,40]},{x:110,y:78,in:[85,40]}]});
      await cmd('text.create',{x:12,y:85,text:'Folio',size:12});
    }
    const after=await request({action:'preview'});assert.notEqual(after.content.find(c=>c.type==='image').data,before.content.find(c=>c.type==='image').data);
    const state=await request({action:'inspect'});fs.writeFileSync('tests/output/creative-'+kind+'-state.json',JSON.stringify(state,null,2));
    const saved=await request({action:'capture'});assert(saved.sourceData.length>100);assert((saved.imageData||saved.pdfData).length>100);
    const sourceFile=path.resolve('tests/output/roundtrip-'+kind+'.'+saved.extension);fs.writeFileSync(sourceFile,Buffer.from(saved.sourceData,'base64'));
    const reopened=await call({action:'open',kind,path:sourceFile});
    const again=await call({action:'preview',sessionId:reopened.sessionId});
    assert.equal(again.content.find(c=>c.type==='image').data,after.content.find(c=>c.type==='image').data,'Native source must round-trip the same pixels');
    if(kind==='photo')assert.equal((await call({action:'inspect',sessionId:reopened.sessionId})).document.depth,16);
    await assert.rejects(call({action:'inspect',sessionId:'missing'}),/不存在|已关闭/);
    await call({action:'close',sessionId:reopened.sessionId});await request({action:'close'});
    checks.push({kind,commands:all.length,covered:required,editedPixels:true,nativeRoundtrip:true,missingSessionRejected:true});
  }
  assert.equal((await call({action:'list'})).sessions.length,0);
  fs.writeFileSync('tests/output/creative-engines.json',JSON.stringify({status:'passed',checks},null,2));console.log('PASS creative engines',checks.map(x=>[x.kind,x.commands]));
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}})().catch(e=>{console.error(e);process.exitCode=1});
