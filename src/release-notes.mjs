import { normalizeLanguage } from './i18n.mjs';
// GitHub shows English first, with translated sections inside collapsed details.
// In-app updates show only the selected locale. Legacy notes remain unchanged.
export function localizedReleaseNotes(notes, language='en') {
 const text=String(notes||'');
 const sections=new Map([...text.matchAll(/<!-- folio-locale:(en|zh-Hans|zh-Hant) -->\s*([\s\S]*?)\s*<!-- \/folio-locale -->/g)].map(m=>[m[1],m[2].trim()]));
 return sections.get(normalizeLanguage(language)) || sections.get('en') || text;
}
