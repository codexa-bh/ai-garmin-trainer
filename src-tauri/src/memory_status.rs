use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Model {
    Unselected,
    Luna,
    Catalog,
    Unsupported,
}
#[derive(Serialize, Deserialize, PartialEq, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum State {
    Disabled,
    Unselected,
    Unavailable,
    NeverProduced,
    Fresh,
    Stale,
}
#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Status {
    version: u8,
    configured_enabled: bool,
    enabled: bool,
    model: Model,
    cap: u32,
    state: State,
    revision: u64,
    frontier: u64,
    pending: u64,
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
    if value.version != 1
        || !(1000..=20000).contains(&value.cap)
        || value.revision > 9_007_199_254_740_991
        || value.frontier > 9_007_199_254_740_991
        || value.pending > 9_007_199_254_740_991
        || (!value.enabled && value.state != State::Disabled)
        || (value.enabled && !value.configured_enabled)
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
    const BODY: &str = r#"{"version":1,"configuredEnabled":true,"enabled":true,"model":"luna","cap":6000,"state":"never-produced","revision":0,"frontier":0,"pending":4}"#;
    #[test]
    fn closed_metadata_and_exact_identity_only() {
        assert!(decode(&response(BODY, "owned"), "owned").is_ok());
        assert!(decode(&response(BODY, "foreign"), "owned").is_err());
        for body in [
            BODY.replace("never-produced", "ready"),
            BODY.replace("6000", "20001"),
            BODY.replace(
                "\"pending\":4",
                "\"pending\":4,\"detail\":\"private-sentinel\"",
            ),
            BODY.replace("\"version\":1", "\"version\":2"),
            BODY.replace("\"enabled\":true", "\"enabled\":false"),
            BODY.replace("\"configuredEnabled\":true", "\"configuredEnabled\":false"),
        ] {
            assert!(decode(&response(&body, "owned"), "owned").is_err());
        }
        let mut over = response(BODY, "owned");
        over.extend(vec![b'x'; 4096]);
        assert!(decode(&over, "owned").is_err());
    }
}
