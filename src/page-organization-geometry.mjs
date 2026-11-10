import {PDFDocument,PDFName} from './vendor/pdf-lib.js';

// PDF.js exposes only the visible box. Retain the actual MediaBox and CropBox
// so a media-size change can use the same scale factors as the PDF writer.
export async function readPageBoxes(bytes) {
  const pdf=await PDFDocument.load(bytes,{ignoreEncryption:true,updateMetadata:false});
  return pdf.getPages().map(page=>({media:page.getMediaBox(),crop:page.getCropBox(),rotation:page.getRotation().angle,
    userUnit:page.node.lookup(PDFName.of('UserUnit'))?.asNumber?.()||1}));
}

export function organizerGeometry(item,info) {
  const base=info||{media:{x:0,y:0,width:item.width,height:item.height},crop:{x:0,y:0,width:item.width,height:item.height},rotation:0,userUnit:1};
  const {media,crop}=base,userUnit=base.userUnit||1;
  if(![media.width,media.height,userUnit].every(n=>Number.isFinite(n)&&n>0))throw Error('页面尺寸无效');
  const sx=item.size?item.size[0]/media.width:1,sy=item.size?item.size[1]/media.height:1;
  if(![sx,sy].every(n=>Number.isFinite(n)&&n>0))throw Error('页面尺寸无效');
  const scale=b=>[b.x*sx,b.y*sy,(b.x+b.width)*sx,(b.y+b.height)*sy];
  const intersect=(a,b)=>[Math.max(a[0],b[0]),Math.max(a[1],b[1]),Math.min(a[2],b[2]),Math.min(a[3],b[3])];
  const m=scale(media),c=scale(crop),original=intersect(m,c),[left,top,right,bottom]=item.crop||[0,0,0,0];
  if(![left,top,right,bottom].every(n=>Number.isFinite(n)&&n>=0))throw Error('裁剪须保留可见页面');
  const visible=intersect(m,[c[0]+left,c[1]+bottom,c[2]-right,c[3]-top]);
  const w=visible[2]-visible[0],h=visible[3]-visible[1],ow=original[2]-original[0],oh=original[3]-original[1];
  if(Math.min(w,h,ow,oh)<=0)throw Error('裁剪须保留可见页面');
  const rotation=((base.rotation+(item.rotation||0))%360+360)%360,turned=rotation%180!==0;
  return {width:w*userUnit,height:h*userUnit,rotation,
    displayedSize:turned?[h*userUnit,w*userUnit]:[w*userUnit,h*userUnit],
    sourceRect:[(visible[0]-original[0])/ow,(original[3]-visible[3])/oh,w/ow,h/oh]};
}
