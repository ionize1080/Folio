export const palettes = {
  cobalt: {label:"钴蓝",light:"#165DDB",dark:"#85AEFF",paper:"#F2F5FA",night:"#191D26"},
  jade:   {label:"青瓷",light:"#007565",dark:"#6FD5BD",paper:"#F1F6F3",night:"#181F1D"},
  amber:  {label:"琥珀",light:"#965019",dark:"#F2B378",paper:"#F8F4EF",night:"#231E19"},
  mulberry:{label:"桑葚",light:"#943E69",dark:"#E7A0BF",paper:"#F8F3F5",night:"#241B20"},
  slate:  {label:"石墨",light:"#45566C",dark:"#AFBFD3",paper:"#F3F4F5",night:"#1C1E21"},
};
const rgb = hex => hex.match(/[0-9a-f]{2}/gi).map(v=>parseInt(v,16));
const hexOf = values => "#" + values.map(v=>Math.round(v).toString(16).padStart(2,"0")).join("");
function luminance(hex) {
  const [r,g,b] = rgb(hex).map(byte => {
    const v=byte/255;
    return v<=0.04045 ? v/12.92 : ((v+0.055)/1.055)**2.4;
  });
  return 0.2126*r+0.7152*g+0.0722*b;
}
export function contrast(a,b) {
  const x=luminance(a), y=luminance(b);
  return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);
}
function readable(color, background, end, ratio) {
  const channels=rgb(color);
  for(let step=0;step<=100;step++) {
    const candidate=hexOf(channels.map(v=>v+(end-v)*step/100));
    if(contrast(candidate,background)>=ratio) return candidate;
  }
  return hexOf([end,end,end]);
}
export function colors(name, custom, dark) {
  const p=palettes[name] || palettes.cobalt;
  const chosen=name==="custom" && /^#[0-9a-f]{6}$/i.test(custom) ? custom : p[dark?"dark":"light"];
  // Leave headroom for tinted selection fills and subdued panels.
  const accent=readable(chosen,dark?"#33383F":"#F2F3F5",dark?255:0,5);
  return {accent,ink:contrast(accent,"#FFFFFF")>=4.5?"#FFFFFF":"#101318",canvas:dark?p.night:p.paper};
}
export function applyAppearance(settings) {
  const dark=settings.theme==="dark" || (settings.theme==="system" && matchMedia("(prefers-color-scheme: dark)").matches);
  const {accent,ink,canvas}=colors(settings.palette,settings.customAccent,dark);
  document.body.classList.toggle("dark",dark);
  for(const [key,value] of Object.entries({"--accent":accent,"--on-accent":ink,"--bg":canvas}))
    document.body.style.setProperty(key,value);
}
export function paletteControls() {
  return '<fieldset class="palette-field"><legend>界面配色</legend><div class="palette-options">'+
    Object.entries(palettes).map(([id,p])=>'<label><input type="radio" name="palette" value="'+id+'"><i style="--swatch:'+p.light+'"></i>'+p.label+'</label>').join("")+
    '<label><input type="radio" name="palette" value="custom">自定义<input id="custom-accent" type="color" aria-label="自定义重点色"></label></div></fieldset>';
}
