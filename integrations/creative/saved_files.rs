//! Bytes retained by the embedding host, isolated to one editor instance.
#[derive(Default)]
pub struct SavedFiles(Vec<(String, Vec<u8>)>);
impl SavedFiles {
    pub fn keep(&mut self, path: &str, bytes: &[u8]) {
        self.0.retain(|(p, _)| p != path);
        self.0.push((path.to_owned(), bytes.to_vec()));
        if self.0.len() > 32 { self.0.remove(0); }
    }
    pub fn get(&self, path: &str) -> Option<&[u8]> {
        self.0.iter().find(|(p, _)| p == path).map(|(_, b)| b.as_slice())
    }
    pub fn list(&self) -> impl Iterator<Item = (&str, usize)> {
        self.0.iter().map(|(p, b)| (p.as_str(), b.len()))
    }
}
