mod marketplace;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(marketplace::WatchState::default())
        .invoke_handler(tauri::generate_handler![
            marketplace::delete_downloaded_skill,
            marketplace::download_skill,
            marketplace::get_skill_detail,
            marketplace::install_downloaded_skill,
            marketplace::install_skill,
            marketplace::load_marketplace,
            marketplace::save_skill_readme,
            marketplace::restore_skill,
            marketplace::save_settings,
            marketplace::uninstall_skill,
            marketplace::uninstall_skill_target,
            marketplace::update_skill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
