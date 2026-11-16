import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

const root=path.resolve(import.meta.dirname,'..');
const tracked=execFileSync('git',['ls-files','*.md'],{cwd:root,encoding:'utf8'}).trim().split('\n');
const docs=new Set([...tracked.filter(f=>!f.includes('/')||f.startsWith('docs/')),
  ...fs.readdirSync(path.join(root,'docs')).filter(f=>f.endsWith('.md')).map(f=>'docs/'+f)]);
const errors=[];let links=0;
for(const file of docs){
 const text=fs.readFileSync(path.join(root,file),'utf8');
 for(const match of text.matchAll(/\]\(([^)]+)\)/g)){
  const target=match[1].split(/\s+"/)[0];if(/^[a-z]+:|^#/i.test(target))continue;
  const relative=decodeURIComponent(target.split('#')[0]);if(!relative)continue;links++;
  const resolved=path.resolve(root,path.dirname(file),relative);
  const pendingManifest=process.argv.includes('--refresh-manifest')&&resolved===path.join(root,'docs/images/2.8.3/manifest.json');
  if(!fs.existsSync(resolved)&&!pendingManifest)errors.push(`${file}: missing ${target}`);
 }
}
const manifestPath=path.join(root,'docs/images/2.8.3/manifest.json');
if(process.argv.includes('--refresh-manifest')){
 const files=[...fs.readdirSync(path.dirname(manifestPath)).filter(f=>f.endsWith('.png')).sort().map(f=>'docs/images/2.8.3/'+f),
  'docs/examples/Folio-Demo.pdf','docs/examples/Folio-Demo-Scan.pdf'];
 const assets=files.map(file=>{const data=fs.readFileSync(path.join(root,file));return {path:file,sha256:crypto.createHash('sha256').update(data).digest('hex'),bytes:data.length,
  ...(file.endsWith('.png')?{width:data.readUInt32BE(16),height:data.readUInt32BE(20)}:{synthetic:true})};});
 fs.writeFileSync(manifestPath,JSON.stringify({version:'2.8.3',sourceCommit:'fe5b6a7b52350e908da9009142bb68129f7f09c2',uiLanguage:'zh-Hans',capture:'Real Electron UI; reduced motion; isolated profiles; no model requests',fixtureGenerator:'scripts/docs-fixtures.py',assets},null,2)+'\n');
}
if(!fs.existsSync(manifestPath))errors.push('Missing screenshot manifest');
else{
 const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
 if(manifest.assets.length!==15)errors.push('Expected 13 screenshots and two generated PDFs');
 for(const asset of manifest.assets){
  if(!/^docs\/(images\/2\.8\.3\/[\w-]+\.png|examples\/Folio-Demo(?:-Scan)?\.pdf)$/.test(asset.path)){errors.push('Unexpected public asset path');continue;}
  const bytes=fs.readFileSync(path.join(root,asset.path));
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==asset.sha256)errors.push('Hash mismatch: '+asset.path);
  if(asset.path.endsWith('.png')){
   if(bytes.subarray(1,4).toString()!=='PNG'||bytes.readUInt32BE(16)!==1440||bytes.readUInt32BE(20)!==960)errors.push('Unexpected screenshot dimensions: '+asset.path);
  }
 }
}
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}
else console.log(`PASS: ${docs.size} Markdown documents, ${links} local links, 15 public assets and hashes`);
