//! Host interface fonts. They are session-only and never enter artwork exports.
use std::sync::{Arc, Mutex};
use base64::Engine;
use egui::{FontData, FontDefinitions};
use serde_json::{Value, json};

static FACES: Mutex<Vec<(String, Arc<FontData>)>> = Mutex::new(Vec::new());

pub(crate) fn apply(fonts: &mut FontDefinitions) {
    let faces = FACES.lock().unwrap_or_else(|p| p.into_inner());
    if faces.is_empty() { return; }
    for (name, data) in faces.iter() { fonts.font_data.insert(format!("Folio-{name}"), data.clone()); }
    for (family, stack) in fonts.families.iter_mut() {
        let key = format!("{family:?}").to_lowercase();
        let primary = if key.contains("mono") { "mono" } else if key.contains("bold") || key.contains("medium") { "semibold" } else { "regular" };
        // Keep the original symbol/emoji fallbacks, after the native UI faces.
        stack.retain(|n| !n.starts_with("Folio-"));
        let mut prefix: Vec<String> = [primary, "cjk"].iter().filter(|n| faces.iter().any(|(name,_)| name == **n)).map(|n| format!("Folio-{n}")).collect();
        prefix.append(stack); *stack = prefix;
    }
}

pub(crate) fn configure(ctx: &egui::Context, p: &Value) -> Result<Value, String> {
    if p.get("fonts").is_none() {
        let faces = FACES.lock().unwrap_or_else(|p| p.into_inner());
        return Ok(json!({"installed":faces.len(),"faces":faces.iter().map(|(n,_)| n).collect::<Vec<_>>(),"source":"host-interface"}));
    }
    let input = p["fonts"].as_array().ok_or("Missing interface fonts")?;
    if input.len() > 4 { return Err("Too many interface fonts".into()); }
    let mut faces = Vec::new();
    for face in input {
        let name = face["name"].as_str().ok_or("Missing interface font name")?;
        if !["regular","semibold","mono","cjk"].contains(&name) { return Err("Unknown interface font".into()); }
        let encoded = face["data"].as_str().ok_or("Missing interface font data")?;
        if encoded.len() > 45_000_000 { return Err("Interface font is too large".into()); }
        let bytes = base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|e| e.to_string())?;
        if bytes.len() < 12 || ![b"\0\x01\0\0",b"OTTO",b"ttcf",b"true"].iter().any(|magic| bytes.starts_with(*magic)) { return Err("Invalid interface font".into()); }
        let index = face["index"].as_u64().unwrap_or(0);
        if index > 16 { return Err("Invalid font collection index".into()); }
        let mut data = FontData::from_owned(bytes); data.index = index as u32;
        faces.push((name.to_owned(), Arc::new(data)));
    }
    let count = faces.len();
    *FACES.lock().unwrap_or_else(|p| p.into_inner()) = faces;
    let mut fonts = ctx.fonts(|f| f.definitions().clone());
    apply(&mut fonts); ctx.set_fonts(fonts); ctx.request_repaint();
    Ok(json!({"installed":count,"source":"host-interface"}))
}
