
mod catalog_transfer;
mod pcsx2_ra;
mod process_manager;
mod ra_identify;
mod ra_status;
mod emulator_data;
mod eden_config;
mod runtime_install;

use catalog_transfer::{
    catalog_games_dir, extract_catalog_zip, extract_zip_archive, http_download_file,
    http_put_file_range, join_path, list_switch_extras, pack_cue_bundle, pack_switch_bundle,
    path_file_size, remove_path,
};
use pcsx2_ra::{inspect_pcsx2_retroachievements, open_pcsx2_for_configuration};
use process_manager::{
    get_active_process, launch_native, path_check, ProcessManagerState,
};
use ra_identify::identify_ra_content;
use ra_status::{inspect_emulator_retroachievements, open_emulator_for_configuration};
use emulator_data::{
    apply_managed_ra_credentials, import_eden_firmware_zip, initialize_emulator_data,
    install_eden_title_nsps, open_managed_eden_keys_folder, open_managed_pcsx2_bios_folder,
    prepare_runtime_launch,
};
use eden_config::{
    launch_eden_config_ui, launch_runtime_config_ui, list_audio_output_devices,
    list_game_controllers, read_eden_audio_settings, read_runtime_audio_settings,
    read_runtime_video_settings, reveal_path_in_explorer, write_eden_audio_settings,
    write_runtime_audio_settings, write_runtime_video_settings,
};
use runtime_install::{
    cancel_runtime_install, install_runtime, runtime_manifest_ids, runtime_manifest_list,
};
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let process_state = Arc::new(ProcessManagerState::default());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(process_state)
        .invoke_handler(tauri::generate_handler![
            launch_native,
            get_active_process,
            path_check,
            inspect_pcsx2_retroachievements,
            open_pcsx2_for_configuration,
            inspect_emulator_retroachievements,
            open_emulator_for_configuration,
            identify_ra_content,
            catalog_games_dir,
            http_put_file_range,
            http_download_file,
            path_file_size,
            join_path,
            pack_cue_bundle,
            pack_switch_bundle,
            list_switch_extras,
            extract_zip_archive,
            extract_catalog_zip,
            remove_path,
            install_runtime,
            cancel_runtime_install,
            runtime_manifest_ids,
            runtime_manifest_list,
            prepare_runtime_launch,
            open_managed_pcsx2_bios_folder,
            open_managed_eden_keys_folder,
            import_eden_firmware_zip,
            install_eden_title_nsps,
            initialize_emulator_data,
            apply_managed_ra_credentials,
            list_audio_output_devices,
            list_game_controllers,
            read_eden_audio_settings,
            write_eden_audio_settings,
            launch_eden_config_ui,
            read_runtime_audio_settings,
            write_runtime_audio_settings,
            read_runtime_video_settings,
            write_runtime_video_settings,
            launch_runtime_config_ui,
            reveal_path_in_explorer
        ])
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            let show_i =
                MenuItem::with_id(app, "show", "Abrir Blaze", true, None::<&str>)?;
            let quit_i =
                MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let icon = app
                .default_window_icon()
                .cloned()
                .ok_or("Falta el icono de Blaze para la bandeja")?;

            let _tray = TrayIconBuilder::with_id("blaze-tray")
                .icon(icon)
                .tooltip("Blaze")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}