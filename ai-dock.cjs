const { WebContentsView, BrowserWindow, session } = require('electron');
const path = require('node:path');
class AIDock {
  constructor({app, win, onState}) {
    Object.assign(this, {app, win, onState, mode:'sidebar', visible:false});
    win.on('resize', () => this.layout());
  }
  async open({root, profile, pipe, token, request, approvalAuto}) {
    this.approvalAuto = approvalAuto;
    if (this.view) {this.toggle(); return {running:true};}
    const profileTools = require(path.join(root,'profile.cjs'));
    const view = this.view = new WebContentsView({webPreferences:{
      preload:path.join(root,'native/dist/preload/index.js'),
      session:session.fromPath(profile), contextIsolation:true, nodeIntegration:false,
      sandbox:true, spellcheck:true, webSecurity:false, allowRunningInsecureContent:false}});
    this.visible = true;
    const check = e => {
      if (e.sender !== view.webContents || e.senderFrame !== view.webContents.mainFrame || !e.senderFrame.url.startsWith('file:')) throw Error('Invalid Chatbox sender');
    };
    globalThis.__folioChatboxHost = {profile, view, version:require(path.join(root,'upstream.json')).version,
      check, window:()=>this.detached || this.win, hide:()=>{this.visible=false;this.layout()},
      settings:value=>profileTools.settings(value,{root,pipe,token}), migrateSettings:profileTools.migrateSettings};
    const {ipcMain} = require('electron');
    const handle = (name, fn) => ipcMain.handle(name, (e,...args)=>{check(e);return fn(...args)});
    handle('folio:display', mode=>this.setMode(mode));
    handle('folio:state', ()=>({...this.state(),auto:!!this.approvalAuto}));
    handle('folio:approval', ()=>request({name:'folio_ui', arguments:{action:'approval'}}));
    require(path.join(root,'network.cjs'))({app:this.app,ipcMain:{handle:(name, fn)=>ipcMain.handle(name,(e,...args)=>{check(e);return fn(e,...args)})}});
    require(path.join(root,'native/dist/main/main.js'));
    view.webContents.setWindowOpenHandler(({url})=>{
      if (/^https?:\/\//i.test(url)) require('electron').shell.openExternal(url);
      return {action:'deny'};
    });
    view.webContents.on('will-navigate', (e,url)=>{if(!url.startsWith('file:'))e.preventDefault()});
    this.win.contentView.addChildView(view);
    this.layout();
    try {await view.webContents.loadFile(path.join(root,'native/dist/renderer/index.html'));}
    catch(error) {this.visible=false;this.layout();throw error;}
    this.send('folio:approval',approvalAuto);
    this.send('folio:display',this.mode);
    return {running:true};
  }
  send(channel, value) {if(this.view && !this.view.webContents.isDestroyed())this.view.webContents.send(channel,value)}
  state() {return {mode:this.mode, open:!!this.view && this.visible};}
  toggle() {
    if(this.mode==='window') {this.visible=true;this.detached?.show();this.detached?.focus();this.view?.webContents.focus()}
    else this.visible=!this.visible;
    this.layout();
  }
  setOverlay(hidden) {this.overlay=hidden;this.layout()}
  setMode(mode) {
    if(!['sidebar','window'].includes(mode))throw Error('Invalid display mode');
    if(mode===this.mode && this.visible)return this.state();
    this.mode=mode;this.visible=true;this.layout();
    // Reparenting must leave keyboard input in the existing Chatbox view, not
    // the new window's empty main webContents. Do this only on explicit actions;
    // routine resize/overlay layout must never steal focus from a typed draft.
    (this.detached || this.win).focus();this.view?.webContents.focus();
    return this.state();
  }
  layout() {
    this.onState(this.state());
    const view=this.view;
    if(!view || view.webContents.isDestroyed())return;
    if(this.mode==='window') {
      if(!this.detached) {
        this.win.contentView.removeChildView(view);
        const w=this.detached=new BrowserWindow({show:false,width:900,height:780,minWidth:360,minHeight:320,title:'Chatbox · Folio',autoHideMenuBar:true});
        w.contentView.addChildView(view);
        w.on('focus',()=>view.webContents.focus());
        w.on('resize',()=>this.layout());
        w.on('close',e=>{if(!this.closing){e.preventDefault();this.setMode('sidebar')}});
      }
      const [width,height]=this.detached.getContentSize();
      view.setBounds({x:0,y:0,width,height});view.setVisible(this.visible);
      if(this.visible) {if(!this.detached.isVisible())this.detached.show();}
      else if(this.detached.isVisible())this.detached.hide();
    } else {
      if(this.detached) {
        const old=this.detached;this.detached=null;
        old.contentView.removeChildView(view);this.win.contentView.addChildView(view);old.destroy();
      }
      const [width,height]=this.win.getContentSize();
      const b=this.bounds || {x:Math.max(0,width-480),y:96,width:480,height:Math.max(1,height-128)};
      view.setBounds(Object.fromEntries(Object.entries(b).map(([k,v])=>[k,Math.max(0,Math.round(v))])));
      view.setVisible(this.visible && !this.overlay);
    }
    this.send('folio:display',this.mode);
  }
  close() {this.closing=true;this.view?.webContents.close();this.view=null;this.detached?.destroy();this.detached=null;this.onState(this.state())}
}
module.exports={AIDock};

