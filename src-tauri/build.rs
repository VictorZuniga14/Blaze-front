use std::env;
use std::path::PathBuf;

fn main() {
    tauri_build::build();

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let rcheevos = manifest_dir.join("vendor").join("rcheevos");
    let rhash = rcheevos.join("src").join("rhash");
    let include = rcheevos.join("include");
    let src = rcheevos.join("src");

    println!("cargo:rerun-if-changed={}", rhash.join("hash.c").display());
    println!("cargo:rerun-if-changed={}", rhash.join("cdreader.c").display());
    println!("cargo:rerun-if-changed={}", rhash.join("md5.c").display());
    println!("cargo:rerun-if-changed={}", rhash.join("aes.c").display());
    println!("cargo:rerun-if-changed={}", src.join("rc_compat.c").display());

    cc::Build::new()
        .file(rhash.join("hash.c"))
        .file(rhash.join("cdreader.c"))
        .file(rhash.join("md5.c"))
        .file(rhash.join("aes.c"))
        .file(src.join("rc_compat.c"))
        .include(&include)
        .include(&src)
        .include(&rhash)
        .define("RC_STATIC", None)
        .warnings(false)
        .compile("rcheevos_rhash");
}
