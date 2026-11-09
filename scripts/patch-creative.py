"""Small, checked source adaptations for Folio's in-process WASM editors."""
import argparse
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
def patch(kind, source):
    def replace(name, old, new):
        p=source/name; text=p.read_text(encoding='utf-8')
        # Some replacements retain the old anchor inside a larger handler. Others
        # insert text that also legitimately occurs elsewhere in the original file.
        if new in text and (old in new or old not in text):return
        if text.count(old)!=1:raise RuntimeError(f'{name}: expected one patch anchor, got {text.count(old)}')
        p.write_text(text.replace(old,new),encoding='utf-8',newline='\n')
    # Folio owns navigation, document naming, menus and zoom. Keep the native
    # canvas, contextual tool options and inspectors, not a second application shell.
    if kind=='photo':
        replace('crates/ui-egui/src/app/frame.rs','panels::title_bar(self, ui);','// Folio supplies the application menu and title.')
        replace('crates/ui-egui/src/app/frame.rs','panels::status_bar(self, ui);','// Folio supplies zoom and document status.')
        replace('crates/ui-egui/src/canvas/tabs.rs','if !app.ui.view.hides_tabs() || opening {','if (n > 1 && !app.ui.view.hides_tabs()) || opening {')
        replace('crates/ui-egui/src/panels/options_bar.rs','(false, false) => 42.0,','(false, false) => 36.0,')
        replace('crates/ui-egui/src/theme.rs','accent: Color32::from_rgb(108, 92, 231),','accent: Color32::from_rgb(82, 103, 219),')
        replace('crates/ui-egui/src/theme.rs','accent_soft: Color32::from_rgba_unmultiplied(108, 92, 231, 36),','accent_soft: Color32::from_rgba_unmultiplied(82, 103, 219, 24),')
        replace('crates/ui-egui/src/theme.rs','accent_border: Color32::from_rgba_unmultiplied(108, 92, 231, 120),','accent_border: Color32::from_rgba_unmultiplied(82, 103, 219, 80),')
        replace('crates/ui-egui/src/theme.rs','accent_text: Color32::from_rgb(80, 64, 200),','accent_text: Color32::from_rgb(65, 85, 190),')
        replace('crates/ui-egui/src/control/dispatch.rs','"ui.menu.list" => {','''"folio.menu" => {
            let lang = crate::i18n::current();
            let items: Vec<_> = crate::menus::menu_items(app).into_iter().map(|item| {
                json!({"id": item.id, "label": crate::i18n::tr_id(lang, &item.id, &item.label),
                    "path": item.path, "displayPath": item.path.iter().map(|s| crate::i18n::tr(lang, s)).collect::<Vec<_>>(),
                    "enabled": item.enabled && crate::menus::modal_allows(app, &item.id),
                    "checked": item.checked, "shortcut": item.shortcut})
            }).collect();
            ok(json!(items))
        }
        "ui.menu.list" => {''')
    else:
        replace('crates/ui-egui/src/app.rs','chrome::app_bar(self, ui);','// Folio supplies the application menu and title.')
        replace('crates/ui-egui/src/app.rs','chrome::status_bar(self, ui);','// Folio supplies zoom and document status.')
        replace('crates/ui-egui/src/app.rs','chrome::hint_bar(self, ui);','widgets::set_menu_floor(&ctx, ctx.content_rect().bottom());')
        replace('crates/ui-egui/src/app.rs','if self.ui.screen_mode < 3 {\n            chrome::doc_tabs(self, ui);','if self.ui.screen_mode < 3 && self.session.documents().len() > 1 {\n            chrome::doc_tabs(self, ui);')
        replace('crates/ui-egui/src/control.rs','"engine.commands" => ok(all_commands(app)),','''"folio.menu.invoke" => {
            let Some(id) = s("id") else { return err("missing menu id") };
            let params = p.get("params").cloned().unwrap_or(Value::Null);
            let Some(item) = crate::menus::menu_entries(app).into_iter().find(|item|
                item.command.as_deref() == Some(id) && item.params == params) else { return err("menu item not found") };
            if !item.enabled || app.ui.dialog.is_some() { return err("menu item is unavailable") }
            let (command, params) = crate::menus::click_target(&item.label, id, &item.params);
            crate::menus::invoke_from_system_menu(app, ctx, &command, params);
            ctx.request_repaint();
            ok(json!({"invoked": id, "dialog": app.ui.dialog.as_ref().map(|d| &d.kind)}))
        }
        "engine.commands" => ok(all_commands(app)),''')
        replace('crates/ui-egui/src/control.rs','"ui.menu.list" => ok(serde_json::to_value(crate::menus::menu_entries(app)).unwrap_or_default()),','''"folio.menu" => {
            let lang = crate::i18n::current();
            let items: Vec<_> = crate::menus::menu_entries(app).into_iter().map(|item| {
                let id = item.command.as_deref().unwrap_or("");
                json!({"id": id, "label": crate::i18n::tr_id(lang, id, &item.label),
                    "path": item.path, "displayPath": item.path.iter().map(|s| crate::i18n::tr(lang, s)).collect::<Vec<_>>(),
                    "enabled": item.enabled, "params": item.params, "shortcut": item.shortcut})
            }).collect();
            ok(json!(items))
        }
        "ui.menu.list" => ok(serde_json::to_value(crate::menus::menu_entries(app)).unwrap_or_default()),''')
    if kind=='photo':
        web='apps/photocraft-web'
        for name,origin in [('api.rs','photo-api.rs'),('saved_files.rs','saved_files.rs')]:
            (source/web/'src'/name).write_bytes((ROOT/'integrations/creative'/origin).read_bytes())
        replace(web+'/Cargo.toml','log = { workspace = true }','log = { workspace = true }\nserde_json = { workspace = true }')
        replace(web+'/src/main.rs','mod web;','mod web;\n#[cfg(target_arch = "wasm32")]\nmod api;\n#[cfg(target_arch = "wasm32")]\nmod saved_files;')
        replace(web+'/src/web.rs','type Inbox =','pub(crate) type Inbox =')
        replace(web+'/src/web.rs','let mut app = PhotocraftApp::new(session, services(inbox.clone(), place_inbox.clone(), drag_pos_service(pen_target.clone(), drag)));',
            '''let (control_tx, control_rx) = std::sync::mpsc::channel();
                    crate::api::connect(Some(control_tx), inbox.clone(), cc.egui_ctx.clone());
                    crate::api::install()?;
                    let mut app = PhotocraftApp::new(session, services(inbox.clone(), place_inbox.clone(), drag_pos_service(pen_target.clone(), drag))).with_control(control_rx);'''.replace('crate::api::install()?;', 'crate::api::install().map_err(|e| format!("Folio control API: {e:?}"))?;'))
        replace(web+'/src/web.rs','self.app.logic_frame(ctx, frame);','self.app.logic_frame(ctx, frame);\n        crate::api::poll_replies();')
        replace(web+'/src/web.rs','self.app.ui_frame(ui, frame);','self.app.ui_frame(ui, frame);\n        crate::api::poll_replies();')
        replace(web+'/src/web.rs','write_unconfirmed: true,','write_unconfirmed: false,\n        automation_read: Some(Box::new(crate::api::read)),\n        automation_write: Some(Box::new(crate::api::write)),')
        replace(web+'/src/web.rs','fn download(path: &str, bytes: &[u8]) -> Result<(), String> {','fn download(path: &str, bytes: &[u8]) -> Result<(), String> {\n    if crate::api::capture(path, bytes) { return Ok(()); }')
        replace('crates/ui-egui/src/control/inspect.rs','"views": app.ui.views,','"views": app.ui.views,\n        "canvasRect": [app.last_canvas_rect.left(), app.last_canvas_rect.top(), app.last_canvas_rect.width(), app.last_canvas_rect.height()],')
        replace('crates/ui-egui/src/control/dispatch.rs','"app.save" => match crate::FormatChoices::from_params(p, "app.save") {',
            '''"app.export" => match crate::FormatChoices::from_params(p, "app.export") {
            Ok(choices) => match str_param(p, "path") {
                Some(path) => wrap(app.export_automation_copy(path, choices)),
                None => err("missing `path`"),
            },
            Err(e) => err(e),
        },
        "app.save" => match crate::FormatChoices::from_params(p, "app.save") {''')
        replace('crates/ui-egui/src/app/files.rs','    pub fn save_automation_with(&mut self, path: Option<String>, choices: FormatChoices) -> Result<Value, String> {',
            '''    // Folio exports a copy without changing the document's path or saved revision.
    pub fn export_automation_copy(&mut self, path: &str, choices: FormatChoices) -> Result<Value, String> {
        let settings = ExportSettings { read_linked_files: false, ..choices.apply(self.save_settings()) };
        let state = self.session.active().ok_or("no document")?;
        ensure_memory_to_save(&state.doc, path)?;
        let export = self.services.export.as_ref().ok_or("no exporter configured")?;
        let (bytes, warnings) = export(&state.doc, path, &settings)?;
        self.services.automation_write.as_mut().ok_or("no embedding writer")?(path, &bytes)?;
        Ok(json!({"path": path, "warnings": warnings}))
    }

    pub fn save_automation_with(&mut self, path: Option<String>, choices: FormatChoices) -> Result<Value, String> {''')
    # Keep the full engine; speed-oriented optimizations and parallel code generation reduce
    # clean build time and peak memory compared with the upstream size-focused fat-LTO profile.
    p=source/'Cargo.toml';text=p.read_text(encoding='utf-8')
    if '[profile.folio-web]' not in text:
        p.write_text(text+'\n[profile.folio-web]\ninherits = "release"\nopt-level = 2\nlto = "thin"\ncodegen-units = 16\nstrip = "debuginfo"\n',encoding='utf-8',newline='\n')

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('kind',choices=['photo','vector']);ap.add_argument('source',type=Path);a=ap.parse_args();patch(a.kind,a.source.resolve())
