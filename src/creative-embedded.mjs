import {fromBase64,toBase64} from './portable-state.mjs';
import {viewPlan} from './creative-view.mjs';
import {referenceQuad,artworkBounds} from './creative-background.mjs';
import {t} from './i18n.mjs';

const delay=ms=>new Promise(r=>setTimeout(r,ms));
const imageResult=data=>({content:[{type:'image',mimeType:'image/png',data}]});
const METHODS=['engine.commands','engine.execute','ui.inspect','ui.set','ui.menu.list','ui.menu.invoke','ui.pointer','ui.key','ui.click','ui.drag','ui.move','ui.text','ui.screenshot','ui.dialog.set','ui.dialog.confirm','ui.dialog.cancel','document.inspect','app.export','app.save'];
export class EmbeddedStudio extends EventTarget {
  constructor({writeFile}){
    super();this.sessions=new Map();this.writeFile=writeFile;this.mount=document.createElement('div');this.mount.className='studio-canvases';
    let last='';const observer=new MutationObserver(()=>{const theme=(document.body.classList.contains('dark')?'dark':'light')+document.documentElement.lang;if(theme===last)return;last=theme;
      for(const s of this.sessions.values())if(s.api){const task=s.queue.then(()=>s.closed?null:this.appearance(s));s.queue=task.catch(e=>this.notify('error',{sessionId:s.id,message:e.message}));}
    });observer.observe(document.body,{attributes:true,attributeFilter:['class']});observer.observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  }
  async appearance(s){
    s.frame.title='Folio '+t(s.kind==='photo'?'图像工作室':'矢量工作室');s.frame.contentDocument.documentElement.lang=document.documentElement.lang||'en';
    await s.api.execute('prefs.set',s.kind==='photo'?{path:'interface.language',value:document.documentElement.lang||'en'}:{key:'interfaceLanguage',value:document.documentElement.lang||'en'});
    await this.interfaceFonts(s);
    const dark=document.body.classList.contains('dark');return s.api.request('ui.set',s.kind==='photo'?{theme:dark?'studio':'studioLight'}:{brightness:dark?'dark':'light'});
  }
  async interfaceFonts(s){
    const language=document.documentElement.lang||'en',key=language==='zh-Hant'?'zh-Hant':'zh-Hans';
    if(s.fontLanguage===key)return;
    this.fonts??=new Map();
    if(!this.fonts.has(key))this.fonts.set(key,window.desktop.creativeStudio({action:'ui-fonts',language}));
    const fonts=await this.fonts.get(key);
    if(fonts.fonts.length)await s.api.request('folio.fonts',fonts);
    s.fontLanguage=key;
  }
  notify(type,detail){this.dispatchEvent(new CustomEvent(type,{detail}));}
  get(id){const s=this.sessions.get(id);if(!s)throw Error('编辑会话已关闭，请重新打开');return s;}
  async open(a){
    const kind=a.kind||'photo';if(!['photo','vector'].includes(kind))throw Error('未知编辑类型');
    let asset=a;
    if(a.path||a.pick){asset={...a,...await window.desktop.creativeStudio({action:'asset',kind,path:a.path,pick:a.pick})};if(asset.cancelled)return asset;}
    const id=crypto.randomUUID(),frame=document.createElement('iframe');frame.className='studio-frame studio-parked';frame.title='Folio '+t(kind==='photo'?'图像工作室':'矢量工作室');
    frame.setAttribute('allow','clipboard-read; clipboard-write');frame.src=`./creative/${kind}/index.html?webgl&lang=${document.documentElement.lang}`;
    const s={id,kind,frame,queue:Promise.resolve(),closed:false,viewMode:null,title:asset.name||a.settings?.name||t(kind==='photo'?'未命名图像':'未命名矢量图')};this.sessions.set(id,s);this.mount.append(frame);
    try{
      const deadline=Date.now()+120000;
      while(Date.now()<deadline){
        if(s.closed)throw Error('编辑会话已关闭');
        if(frame.contentWindow?.folioStartError)throw Error(frame.contentWindow.folioStartError);
        s.api=frame.contentWindow?.[kind==='photo'?'photocraft':'vectorcraft'];if(s.api)break;await delay(100);
      }
      if(!s.api)throw Error('画布未能载入，请检查内嵌编辑组件是否完整');
      // UI Save/Export uses Folio's chooser. Automated exports return bytes
      // directly, so they neither open a chooser nor change the save target.
      s.api.captureDownloads(false);
      frame.contentWindow.folioDownload=async(name,bytes)=>{try{await this.writeFile(name,new Uint8Array(bytes),name.split('.').pop());}catch(e){this.notify('error',{sessionId:id,message:e.message});}};
      const anchors=frame.contentWindow.HTMLAnchorElement.prototype,click=anchors.click;
      anchors.click=function(){
        if(this.download&&this.href.startsWith('blob:')){
          const name=this.download;
          frame.contentWindow.fetch(this.href).then(r=>r.arrayBuffer()).then(bytes=>frame.contentWindow.folioDownload(name,new Uint8Array(bytes))).catch(e=>{frame.contentWindow.parent.console.error('Artwork export failed',e);});
        }else return click.call(this);
      };
      const language=document.documentElement.lang||'en';
      frame.contentDocument.documentElement.lang=language;
      await s.api.execute('prefs.set',kind==='photo'?{path:'interface.language',value:language}:{key:'interfaceLanguage',value:language});
      if(asset.data){
        const name=asset.name||'Artwork.'+(asset.extension||'png');
        if(kind==='photo'){
          s.api.putFile(name,new Uint8Array(fromBase64(asset.data)));await s.api.request('app.open',{path:name});
        }else await s.api.execute('document.open',{name,dataBase64:asset.data});
      }else await s.api.execute('file.new',{name:s.title,width:1200,height:800,...(kind==='photo'?{background:'transparent'}:{}),...a.settings});
      if(kind==='photo'){
        await s.api.execute('prefs.set',{path:'interface.showCanvasDots',value:false});
        await s.api.request('ui.set',{theme:document.body.classList.contains('dark')?'studio':'studioLight',dockWidth:260,panels:{properties:false},fit:true});
      }else {
        await s.api.execute('prefs.set',{key:'uiAccent',value:'blue'});
        await s.api.request('ui.set',{brightness:document.body.classList.contains('dark')?'dark':'light'});await s.api.execute('view.fitArtboard',{});
      }
      await this.interfaceFonts(s);
      const state=await this.inspect(s),d=state.document;
      s.dimensions=kind==='photo'?[d.width,d.height]:[d.artboards?.[0]?.width||1200,d.artboards?.[0]?.height||800];
      this.notify('opened',{sessionId:id,kind});
      return {sessionId:id,kind,embedded:true,dimensions:s.dimensions,viewLimits:{maxPercent:kind==='photo'?12800:64000}};
    }catch(e){this.close(id);throw e;}
  }
  async inspect(s){
    const ui=await s.api.inspect();
    return {document:s.kind==='photo'?ui.document:await s.api.request('document.inspect',{}),ui};
  }
  async export(s,format='png',options={}){
    if(!/^[a-z0-9]{1,16}$/.test(format))throw Error('导出格式无效');
    let data,details;
    if(s.kind==='photo'){
      const name='Folio-export.'+format,params={...options,path:name};
      // The photo encoder's JPEG quality is 0–12; Folio displays the conventional 0–100 scale.
      if(['jpg','jpeg'].includes(format)&&params.quality!==undefined)params.quality=Math.round(params.quality*12/100);
      details=await s.api.request('app.export',params);data=toBase64(new Uint8Array(s.api.readFile(name)));
    }else {
      details=await s.api.request('app.export',{artboard:0,format,...options});data=details.dataBase64;
      if(!data)throw Error('编辑器未返回导出文件');
    }
    return {data,extension:format,details};
  }
  async capture(s){
    const extension=s.kind==='photo'?'pcraft':'vectorcraft';
    const source=await this.export(s,extension),art=await this.export(s,s.kind==='photo'?'png':'pdf',s.kind==='vector'?{preserveEditing:false}:{});
    return {sourceData:source.data,extension,[s.kind==='photo'?'imageData':'pdfData']:art.data,warnings:[...(source.details?.warnings||[]),...(art.details?.warnings||[])]};
  }
  async background(s,options={}){
    const next={mode:'checker',color:'#eef0f3',opacity:.6,...s.background,...Object.fromEntries(['mode','color','opacity'].filter(k=>options[k]!==undefined).map(k=>[k,options[k]]))};
    if(!['checker','solid','pdf'].includes(next.mode)||!/^#[0-9a-f]{6}$/i.test(next.color)||!Number.isFinite(next.opacity)||next.opacity<0||next.opacity>1)throw Error('画布背景设置无效');
    const params={...next,color:next.color.slice(1).match(/../g).map(v=>parseInt(v,16))};
    if(options.reference){
      const bitmap=await createImageBitmap(new Blob([fromBase64(options.reference.imageData)],{type:'image/png'}));
      try{
        const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
        const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);
        params.rgbaBase64=toBase64(new Uint8Array(ctx.getImageData(0,0,canvas.width,canvas.height).data.buffer));params.width=canvas.width;params.height=canvas.height;
      }finally{bitmap.close();}
    }
    const reference=options.reference||s.reference,matrix=options.matrix||s.referenceMatrix;
    if(next.mode==='pdf'){
      if(!reference||!matrix)throw Error('请先载入 PDF 页面背景');
      params.quad=referenceQuad(reference.bounds,matrix,artworkBounds(s.kind,await this.inspect(s)));
    }
    const result=await s.api.request('folio.backdrop',params);
    if(reference)s.reference={bounds:reference.bounds,revision:reference.revision};if(matrix)s.referenceMatrix=matrix;
    s.background=next;s.referenceQuad=params.quad;this.notify('background',{sessionId:s.id,...next});
    return {...result,...next};
  }
  async view(s,options={}){
    if(options.mode==='selection'){
      await s.api.execute(s.kind==='photo'?'view.fitLayersOnScreen':'addon.arrange.zoomSelection',{});
      s.viewMode=null;
    }else if(options.mode){
      const {document:d,ui}=await this.inspect(s),v=s.kind==='photo'?ui.views[ui.session.active]:ui.view;
      let bounds;
      if(s.kind==='photo')bounds=[0,0,d.width,d.height];
      else {const b=d.artboards?.[v.artboard||0]||d.artboards?.[0];bounds=[b.x,b.y,b.width,b.height];}
      if(options.mode==='page'){
        if(!s.reference||!s.referenceMatrix)throw Error('请先选择 PDF 页面背景');
        const quad=referenceQuad(s.reference.bounds,s.referenceMatrix,artworkBounds(s.kind,{document:d}));
        const xs=quad.map(p=>p[0]),ys=quad.map(p=>p[1]),x=Math.min(...xs),y=Math.min(...ys);bounds=[x,y,Math.max(...xs)-x,Math.max(...ys)-y];
      }
      const center=Array.isArray(v.center)?v.center:[v.center.x,v.center.y];
      const pixelScale=s.kind==='photo'?ui.window.pixelsPerPoint:1;
      const canvas=ui.canvasRect.map((n,i)=>i>1?n*pixelScale:n);
      const plan=viewPlan({bounds,canvas,center,zoom:v.zoom,rotation:v.rotation,maxZoom:s.kind==='photo'?128:640,minZoom:s.kind==='photo'?2/Math.min(d.width,d.height):.0313},{...options,mode:options.mode==='page'?'fit':options.mode,margin:(options.margin??24)*pixelScale});
      if(s.kind==='photo')await s.api.request('ui.set',plan);
      else {const print=await s.api.execute('prefs.get',{key:'displayPrintSize'});await s.api.execute('view.setZoom',{zoom:plan.zoom*100/(print?96/72:1),center:plan.center});}
      s.viewMode=['fit','width','height','fill','page'].includes(options.mode)?{...options}:null;
    }
    const ui=await s.api.inspect(),v=s.kind==='photo'?ui.views[ui.session.active]:ui.view;
    if(s.background?.mode==='pdf'){
      const state=s.kind==='photo'?{document:ui.document}:await this.inspect(s),quad=referenceQuad(s.reference.bounds,s.referenceMatrix,artworkBounds(s.kind,state));
      if(JSON.stringify(quad)!==JSON.stringify(s.referenceQuad)){await s.api.request('folio.backdrop',{quad});s.referenceQuad=quad;}
    }
    const result={percent:v.zoom*100,center:v.center,rotation:v.rotation,mode:s.viewMode?.mode||'custom',maxPercent:s.kind==='photo'?12800:64000};this.notify('view',{sessionId:s.id,...result});return result;
  }
  async request(a){
    if(a.action==='open')return this.open(a);
    const s=this.get(a.sessionId);
    const task=s.queue.then(()=>this.perform(s,a));s.queue=task.catch(()=>{});return task;
  }
  async perform(s,a){
    if(s.closed)throw Error('编辑会话已关闭');
    switch(a.action){
      case 'inspect':return this.inspect(s);
      case 'commands':{
        const r=await s.api.commands(),q=(a.query||'').toLowerCase();
        const rows=(Array.isArray(r)?r:r.commands||[]).filter(c=>(!q||[c.id,c.label,c.menu,c.params].join(' ').toLowerCase().includes(q))&&(!a.enabledOnly||c.enabled));
        const offset=a.offset||0,limit=Math.max(1,Math.min(a.limit||40,100));return {total:rows.length,commands:rows.slice(offset,offset+limit),nextOffset:offset+limit<rows.length?offset+limit:null};
      }
      case 'tools':return {transport:'embedded control channel',methods:[...METHODS,'folio.backdrop'],usage:'request(method,params) drives all UI controls; commands discovers every editing command and its parameters; execute(command,params) changes the live document.',view:{modes:['fit','page','width','height','fill','actual','center','center-x','center-y','zoom','in','out','selection'],percent:'custom percentage',margin:'screen pixels'},background:{modes:['checker','solid','pdf'],color:'#rrggbb',opacity:'0–1',refresh:'reload current PDF snapshot',viewOnly:true}};
      case 'request':return s.api.request(a.method,a.params||{});
      case 'execute':return s.api.execute(a.command,a.params||{});
      case 'tool':{
        const aliases={command_run:'engine.execute',ui_set:'ui.set',ui_inspect:'ui.inspect',doc_inspect:'document.inspect'};
        if(a.tool==='doc_inspect'&&s.kind==='photo')return (await this.inspect(s)).document;
        const method=aliases[a.tool]||a.tool,params=a.tool==='command_run'?{command:a.params.id,params:a.params.params||{}}:a.params||{};
        return s.api.request(method,params);
      }
      case 'batch':{
        if(!Array.isArray(a.steps)||!a.steps.length||a.steps.length>256)throw Error('批量操作须包含 1–256 步');
        const results=[],group=s.kind==='vector'&&a.atomic!==false;
        if(group)await s.api.execute('edit.undoGroup.begin',{label:'Folio AI'});
        try{for(const step of a.steps){try{results.push({id:step.id,result:await s.api.execute(step.id,step.params||{})});}catch(e){return {results,completed:results.length,error:e.message,partial:results.length>0};}}}
        finally{if(group)await s.api.execute('edit.undoGroup.end',{});}
        return {completed:results.length,results};
      }
      case 'preview':{
        const png=await this.export(s,'png');
        const bitmap=await createImageBitmap(new Blob([fromBase64(png.data)],{type:'image/png'}));
        try{const scale=Math.min(1,(a.maxSide||1200)/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);return imageResult(canvas.toDataURL('image/png').split(',')[1]);}finally{bitmap.close();}
      }
      case 'asset':{
        const r=await window.desktop.creativeStudio({...a,action:'asset',kind:s.kind});if(r.cancelled)return r;
        if(s.kind==='photo'){s.api.putFile(r.name,fromBase64(r.data));return {path:r.name,name:r.name,bytes:r.bytes};}
        return {name:r.name,dataBase64:r.data,bytes:r.bytes,usage:'Pass name and dataBase64 to an import/place command; browser sessions have no filesystem paths.'};
      }
      case 'capture':return this.capture(s);
      case 'export':return this.export(s,a.format,a.options);
      case 'view':return this.view(s,a.options||{});
      case 'background':return this.background(s,a.options||{});
      case 'show':this.notify('show',{sessionId:s.id,kind:s.kind});return {visible:true,embedded:true};
      case 'close':this.close(s.id);return {closed:true};
      default:throw Error('未知编辑操作');
    }
  }
  close(id){const s=this.sessions.get(id);if(!s)return;s.closed=true;s.frame.remove();this.sessions.delete(id);this.notify('closed',{sessionId:id});}
}
