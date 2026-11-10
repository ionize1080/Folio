// A page inspection belongs to immutable PDF bytes, not to the current camera
// or edit draft. Reuse it when entering editing again, and share in-flight work.
export function createPageInspectionCache(inspect, maxPages = 3) {
  const sources = new WeakMap();
  return async function read(source, page) {
    let pages=sources.get(source);
    if(!pages){pages=new Map();sources.set(source,pages);}
    let entry=pages.get(page);
    if(entry) {pages.delete(page);pages.set(page,entry);}
    else {
      entry=Promise.resolve().then(()=>inspect(source,page));pages.set(page,entry);
      while(pages.size>maxPages)pages.delete(pages.keys().next().value);
      entry.catch(()=>{if(pages.get(page)===entry)pages.delete(page);});
    }
    // Grouping and editing callers must never mutate the cached evidence.
    return structuredClone(await entry);
  };
}
