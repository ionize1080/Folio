//! Folio's view-only reference plane. Never stored in an artwork document or its history.
use base64::Engine;
use egui::{Color32, Pos2};
use serde_json::{Value, json};

#[derive(Clone)]
struct Backdrop {
    mode: String,
    color: Color32,
    opacity: f32,
    quad: [[f32; 2]; 4],
    texture: Option<egui::TextureHandle>,
}
fn key() -> egui::Id { egui::Id::unique("folio-reference-plane") }
fn get(ctx: &egui::Context) -> Option<Backdrop> { ctx.data(|d| d.get_temp(key())) }
pub(crate) fn active(ctx: &egui::Context) -> bool { get(ctx).is_some_and(|b| b.mode != "checker") }

pub(crate) fn configure(ctx: &egui::Context, p: &Value) -> Result<Value, String> {
    let mut b = get(ctx).unwrap_or(Backdrop { mode: "checker".into(), color: Color32::from_gray(238), opacity: 0.6, quad: [[0.0; 2]; 4], texture: None });
    if let Some(mode) = p.get("mode") {
        let mode = mode.as_str().ok_or("Invalid background mode")?;
        if !["checker", "solid", "pdf"].contains(&mode) { return Err("Invalid background mode".into()); }
        b.mode = mode.into();
    }
    if let Some(color) = p.get("color") {
        let c: [u8; 3] = serde_json::from_value(color.clone()).map_err(|e| e.to_string())?;
        b.color = Color32::from_rgb(c[0], c[1], c[2]);
    }
    if let Some(opacity) = p.get("opacity") {
        let v = opacity.as_f64().ok_or("Invalid background opacity")?;
        if !v.is_finite() || !(0.0..=1.0).contains(&v) { return Err("Background opacity must be 0–1".into()); }
        b.opacity = v as f32;
    }
    if let Some(quad) = p.get("quad") {
        b.quad = serde_json::from_value(quad.clone()).map_err(|e| e.to_string())?;
        if !b.quad.iter().flatten().all(|v| v.is_finite()) { return Err("Invalid PDF reference geometry".into()); }
    }
    if let Some(data) = p.get("rgbaBase64") {
        let width = p["width"].as_u64().ok_or("Missing reference width")? as usize;
        let height = p["height"].as_u64().ok_or("Missing reference height")? as usize;
        if width == 0 || height == 0 || width > 2048 || height > 2048 { return Err("Reference image must be 1–2048 pixels per side".into()); }
        let bytes = base64::engine::general_purpose::STANDARD.decode(data.as_str().ok_or("Invalid reference pixels")?).map_err(|e| e.to_string())?;
        if bytes.len() != width * height * 4 { return Err("Reference image dimensions do not match its pixels".into()); }
        b.texture = Some(ctx.load_texture("folio-pdf-reference", egui::ColorImage::from_rgba_unmultiplied([width, height], &bytes), egui::TextureOptions::LINEAR));
    }
    if b.mode == "pdf" && b.texture.is_none() { return Err("Load a PDF page before enabling its background".into()); }
    let result = json!({"mode": b.mode, "opacity": b.opacity, "color": [b.color.r(), b.color.g(), b.color.b()], "quad": b.quad, "hasPage": b.texture.is_some(), "viewOnly": true});
    ctx.data_mut(|d| d.insert_temp(key(), b));
    ctx.request_repaint();
    Ok(result)
}

// Clip both positions and UVs. A high-resolution transparent detail tile must replace
// its low-resolution preview without painting outside the rotated tile's boundary.
fn clipped(mut vertices: Vec<(Pos2, Pos2)>, clip: &[Pos2; 4]) -> Vec<(Pos2, Pos2)> {
    let cross = |a: Pos2, b: Pos2, c: Pos2| (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
    let sign = if cross(clip[0], clip[1], clip[2]) >= 0.0 { 1.0 } else { -1.0 };
    for edge in 0..4 {
        let (a, b) = (clip[edge], clip[(edge+1)%4]);
        let input = std::mem::take(&mut vertices);
        if input.is_empty() { break; }
        let mut prev = *input.last().unwrap();
        let mut dp = cross(a, b, prev.0)*sign;
        for current in input {
            let dc = cross(a, b, current.0)*sign;
            if (dc >= 0.0) != (dp >= 0.0) {
                let t = dp/(dp-dc);
                vertices.push((prev.0+(current.0-prev.0)*t, prev.1+(current.1-prev.1)*t));
            }
            if dc >= 0.0 { vertices.push(current); }
            prev = current; dp = dc;
        }
    }
    vertices
}

pub(crate) fn paint(painter: &egui::Painter, map: impl Fn([f32; 2]) -> Pos2, region: Option<[Pos2; 4]>) -> bool {
    let Some(b) = get(painter.ctx()).filter(|b| b.mode != "checker") else { return false };
    if let Some(q) = region {
        painter.add(egui::Shape::convex_polygon(q.to_vec(), b.color, egui::Stroke::NONE));
    } else {
        painter.rect_filled(painter.clip_rect(), 0.0, b.color);
    }
    if b.mode == "pdf" && let Some(texture) = &b.texture {
        let uv = [Pos2::new(0.0,0.0), Pos2::new(1.0,0.0), Pos2::new(1.0,1.0), Pos2::new(0.0,1.0)];
        let mut vertices: Vec<_> = b.quad.into_iter().map(map).zip(uv).collect();
        if let Some(q) = region { vertices = clipped(vertices, &q); }
        if vertices.len() >= 3 && vertices.iter().all(|(p,_)| p.x.is_finite() && p.y.is_finite()) {
            let mut mesh = egui::Mesh::with_texture(texture.id());
            for (pos, uv) in vertices { mesh.vertices.push(egui::epaint::Vertex { pos, uv, color: Color32::from_white_alpha((b.opacity*255.0).round() as u8) }); }
            for i in 1..mesh.vertices.len() as u32-1 { mesh.add_triangle(0,i,i+1); }
            painter.add(egui::Shape::mesh(mesh));
        }
    }
    true
}
