use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Embeddings {
    Openai,
    Ollama,
    Deterministic,
}
#[derive(Serialize, Deserialize, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Llm,
    Deterministic,
    Off,
}
#[derive(Serialize, Deserialize, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Extractor {
    Openai,
    Deepseek,
    Deterministic,
    Off,
}
#[derive(Serialize, Deserialize, PartialEq, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum Health {
    Disabled,
    Attention,
    NotChecked,
    LocalObserved,
    TestOnly,
}
#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Status {
    configured_enabled: bool,
    user_disabled: bool,
    effective_enabled: bool,
    embedding_provider: Embeddings,
    extraction_mode: Mode,
    extraction_provider: Extractor,
    health: Health,
    age_ms: Option<u32>,
}

// Accept only the exact fixed, bounded identity-authenticated HTTP response.
// Vendor errors, paths, custom model identifiers and private content never pass.
pub fn decode(response: &[u8], nonce: &str) -> Result<Status, &'static str> {
    let error = "Active memory status unavailable; no readiness claim.";
    if response.len() > 4096 {
        return Err(error);
    }
    let text = std::str::from_utf8(response).map_err(|_| error)?;
    let (headers, body) = text.split_once("\r\n\r\n").ok_or(error)?;
    let lines: Vec<_> = headers.split("\r\n").collect();
    if !lines
        .first()
        .map(|s| s.starts_with("HTTP/1.1 200 "))
        .unwrap_or(false)
        || !lines
            .iter()
            .any(|line| line.eq_ignore_ascii_case(&format!("x-trainer-identity: {nonce}")))
        || lines
            .iter()
            .any(|line| line.to_ascii_lowercase().starts_with("transfer-encoding:"))
        || lines
            .iter()
            .filter(|line| line.to_ascii_lowercase().starts_with("content-length:"))
            .count()
            != 1
        || !lines
            .iter()
            .any(|line| line.eq_ignore_ascii_case(&format!("content-length: {}", body.len())))
        || body.len() > 2048
    {
        return Err(error);
    }
    let value: Status = serde_json::from_str(body).map_err(|_| error)?;
    if value.effective_enabled != (value.configured_enabled && !value.user_disabled)
        || value.age_ms.map(|age| age >= 60000).unwrap_or(false)
        || (value.health == Health::LocalObserved
            && (value.embedding_provider != Embeddings::Ollama || value.age_ms.is_none()))
        || (value.health == Health::TestOnly
            && (value.embedding_provider != Embeddings::Deterministic || value.age_ms.is_none()))
        || (!value.effective_enabled && value.health != Health::Disabled)
        || (value.extraction_mode == Mode::Off && value.extraction_provider != Extractor::Off)
        || (value.extraction_mode == Mode::Deterministic
            && value.extraction_provider != Extractor::Deterministic)
        || (value.extraction_mode == Mode::Llm && value.extraction_provider == Extractor::Off)
    {
        return Err(error);
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn response(body: &str, identity: &str) -> Vec<u8> {
        format!(
            "HTTP/1.1 200 OK\r\nx-trainer-identity: {identity}\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        )
        .into_bytes()
    }
    const BODY: &str = r#"{"configuredEnabled":true,"userDisabled":false,"effectiveEnabled":true,"embeddingProvider":"ollama","extractionMode":"llm","extractionProvider":"deepseek","health":"not-checked","ageMs":null}"#;
    #[test]
    fn closed_metadata_and_exact_identity_only() {
        assert!(decode(&response(BODY, "owned"), "owned").is_ok());
        assert!(decode(&response(BODY, "foreign"), "owned").is_err());
        for body in [
            BODY.replace("not-checked", "ready"),
            BODY.replace("null", "60000"),
            BODY.replace(
                "\"ageMs\":null",
                "\"ageMs\":null,\"detail\":\"private-sentinel\"",
            ),
            BODY.replace("not-checked", "local-observed"),
            BODY.replace("\"effectiveEnabled\":true", "\"effectiveEnabled\":false"),
        ] {
            assert!(decode(&response(&body, "owned"), "owned").is_err());
        }
        let mut over = response(BODY, "owned");
        over.extend(vec![b'x'; 4096]);
        assert!(decode(&over, "owned").is_err());
    }
}
