const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process'),asar=require('@electron/asar');
const {NativeBridge}=require('../native-bridge.cjs');
const root=path.resolve(__dirname,'..'),bundle=path.join(root,'dist/Folio-PDF-Studio-win-x64/resources'),nativeRoot=path.join(bundle,'native');
const checks=[],errors=[];let bridge;
(async()=>{
  for(const name of ['font-warmup.cjs','native-bridge.cjs','main.cjs','src/fast-layout.mjs','src/page-spatial.mjs'])assert.deepEqual(asar.extractFile(path.join(bundle,'app.asar'),name),fs.readFileSync(path.join(root,name)),name);
  for(const name of ['font_warmup.py','font_similarity.py','glyph_writer.py','type3_restore.py','story.py','structure_scope.py'])assert.deepEqual(fs.readFileSync(path.join(nativeRoot,name)),fs.readFileSync(path.join(root,'native',name)),name);
  checks.push('packaged worker, preload and layout code equal the tested source');
  const python=path.join(nativeRoot,'runtime/python.exe'),fixture=path.join(root,'tests/output/editing-260-package.pdf');
  execFileSync(python,['-c',"import fitz,sys;d=fitz.open();d.new_page().insert_text((30,60),'Packaged paragraph editing');d.save(sys.argv[1])",fixture]);
  bridge=new NativeBridge(nativeRoot,python);
  const scan=await bridge.request({command:'font-scan',input:fixture,page:1});assert.equal(scan.pages,1);assert(scan.fonts.some(f=>f.fontKey));
  const face=await bridge.request({command:'font-fast',fontKey:scan.fonts.find(f=>f.fontKey).fontKey});assert(face.base64.length>100);assert(face.coverage.includes(65));
  checks.push('packaged Python discovers and prepares a real PDF font');
})().catch(e=>{errors.push(e.stack);process.exitCode=1;}).finally(()=>{
  bridge?.cancel();fs.writeFileSync(path.join(root,'tests/output/editing-260-package.json'),JSON.stringify({status:errors.length?'failed':'passed',checks,errors},null,2));console.log(JSON.stringify({checks,errors}));
});
