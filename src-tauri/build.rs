fn main() {
    let mut attributes = tauri_build::Attributes::new();
    // Keep debug permission metadata out of normal release manifests as well as
    // excluding the implementation/handler/bootstrap with Rust cfg gates.
    if std::env::var_os("CARGO_CFG_DEBUG_ASSERTIONS").is_some() {
        let directory = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap())
            .join("debug-permissions");
        std::fs::create_dir_all(&directory).unwrap();
        for (source, name) in [
            ("permissions/setup.toml", "setup.toml"),
            ("debug/smoke-permission.toml", "smoke.toml"),
        ] {
            println!("cargo:rerun-if-changed={source}");
            std::fs::copy(source, directory.join(name)).unwrap();
        }
        let pattern = Box::leak(format!("{}/*.toml", directory.display()).into_boxed_str());
        attributes = attributes
            .app_manifest(tauri_build::AppManifest::new().permissions_path_pattern(pattern));
    }
    tauri_build::try_build(attributes).expect("Native capability build");
}
