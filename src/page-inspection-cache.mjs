// A page inspection belongs to immutable PDF bytes, not to the current camera
// or edit draft. Reuse it when entering editing again, and share in-flight work.
export function createPageInspectionCache(inspect, maxPages = 3) {
  const sources = new WeakMap();
  function lookup(source, page) {
    let pages=sources.get(source);
    if(!pages){pages=new Map();sources.set(source,pages);}
    let entry=pages.get(page);
    if(entry) {pages.delete(page);pages.set(page,entry);}
    else {
      entry=Promise.resolve().then(()=>inspect(source,page));pages.set(page,entry);
      while(pages.size>maxPages)pages.delete(pages.keys().next().value);
      entry.catch(()=>{if(pages.get(page)===entry)pages.delete(page);});
    }
    return entry;
  }
  const read = async (source, page) => structuredClone(await lookup(source, page));
  // Speculative warm-up has no consumer for the potentially large glyph tree.
  read.warm = async (source, page) => { await lookup(source, page); };
  return read;
}
