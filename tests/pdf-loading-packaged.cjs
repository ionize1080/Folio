const {_electron}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const checkPdfLoading=require('./pdf-loading-check.cjs');
const ROOT=path.resolve('.'),fixtures=path.join(ROOT,'tests/output/pdf-loading'),out=path.join(ROOT,'tests/output/pdf-loading-packaged');
const reportFile=path.join(ROOT,'tests/output/pdf-loading-packaged-report.json');
(async()=>{
  assert(process.env.FOLIO_EXE,'Packaged JPX checks require FOLIO_EXE');
  fs.mkdirSync(out,{recursive:true});fs.rmSync(reportFile,{force:true});
  const manifest=JSON.parse(fs.readFileSync(path.join(fixtures,'manifest.json'),'utf8'));
  assert(manifest.some(s=>s.name==='synthetic-jpx'),'The deterministic JPX fixture is required');
  const stamp=randomUUID(),executable=path.resolve(process.env.FOLIO_EXE);
  const app=await _electron.launch({executablePath:executable,args:[],env:{...process.env,FOLIO_TEST_BACKGROUND:'1',FOLIO_TEST_PROFILE:path.join(out,'profile-'+stamp),FOLIO_CHATBOX_PROFILE:path.join(out,'chat-'+stamp)},timeout:60000});
  try{
    const page=await app.firstWindow();await page.waitForSelector('#ribbon-tab-photo');
    assert(page.url().startsWith('folio://app/'),'The packaged renderer must supply all PDF modules');
    const runtime=await app.evaluate(({app})=>({executable:process.execPath,electron:process.versions.electron,chromium:process.versions.chrome,version:app.getVersion()}));
    assert.equal(path.resolve(runtime.executable).toLowerCase(),executable.toLowerCase());delete runtime.executable;
    const checks=[];
    for(const specimen of manifest){
      const documents=Object.fromEntries(Object.entries(specimen.files).map(([kind,file])=>[kind,fs.readFileSync(path.join(fixtures,file)).toString('base64')]));
      const report=await page.evaluate(checkPdfLoading,{specimen,baseURL:'folio://app/',documents});
      for(const kind of ['background','saved']){
        assert(report[kind].outsideChangedPixels<=4&&report[kind].outsideMaxError<=16,specimen.name+' '+kind+' outside paragraph '+JSON.stringify(report[kind].outsideSamples));
        assert(report[kind].imagePixels>0,specimen.name+' image has sampled pixels');
        assert.equal(report[kind].imageChangedPixels,0,specimen.name+' '+kind+' image');
        fs.writeFileSync(path.join(out,specimen.name+'-'+kind+'.png'),Buffer.from(report[kind].png.split(',')[1],'base64'));delete report[kind].png;
      }
      assert(report.thumbnailColors>=4,specimen.name+' thumbnail contains decoded image colors');
      fs.writeFileSync(path.join(out,specimen.name+'-source.png'),Buffer.from(report.source.split(',')[1],'base64'));delete report.source;
      checks.push({name:specimen.name,...report});
    }
    const result={status:'passed',runtime,moduleBase:'folio://app/',checks};
    fs.writeFileSync(reportFile,JSON.stringify(result,null,2));
    console.log('PASS packaged JPX images, paragraph backgrounds and thumbnails '+JSON.stringify(result));
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});
