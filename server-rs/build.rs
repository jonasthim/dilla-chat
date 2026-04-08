use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

fn hash_file(path: &Path) -> String {
    let mut hasher = Sha256::new();
    let mut f = fs::File::open(path)
        .unwrap_or_else(|e| panic!("open {}: {}", path.display(), e));
    let mut buf = Vec::new();
    f.read_to_end(&mut buf)
        .unwrap_or_else(|e| panic!("read {}: {}", path.display(), e));
    hasher.update(&buf);
    format!("{:x}", hasher.finalize())
}

fn main() {
    println!("cargo:rerun-if-changed=assets/voice-models");

    let models_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("assets/voice-models");
    let dfn3_dir = models_dir.join("dfn3-v1");

    let enc_path = dfn3_dir.join("enc.onnx");
    let erb_dec_path = dfn3_dir.join("erb_dec.onnx");
    let df_dec_path = dfn3_dir.join("df_dec.onnx");

    for p in [&enc_path, &erb_dec_path, &df_dec_path] {
        if !p.exists() {
            panic!("Missing model file: {}", p.display());
        }
    }

    let enc_hash = hash_file(&enc_path);
    let erb_dec_hash = hash_file(&erb_dec_path);
    let df_dec_hash = hash_file(&df_dec_path);

    let manifest = serde_json::json!({
        "version": 1,
        "minClientVersion": 0,
        "dfn3": {
            "enc":     { "url": "/api/voice/models/dfn3-v1/enc.onnx",     "sha256": enc_hash },
            "erb_dec": { "url": "/api/voice/models/dfn3-v1/erb_dec.onnx", "sha256": erb_dec_hash },
            "df_dec":  { "url": "/api/voice/models/dfn3-v1/df_dec.onnx",  "sha256": df_dec_hash },
            "config": {
                "sample_rate": 48000,
                "fft_size": 960,
                "hop_size": 480,
                "nb_erb": 32,
                "nb_df": 96,
                "df_order": 5,
                "lookahead_frames": 4
            }
        }
    });

    let manifest_path = models_dir.join("manifest.json");
    fs::write(
        &manifest_path,
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .expect("write manifest.json");
}
