//! obs-websocket v5 protocol helpers (pure functions).
//! Spec: https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

pub mod op {
    pub const HELLO: u64 = 0;
    pub const IDENTIFY: u64 = 1;
    pub const IDENTIFIED: u64 = 2;
    pub const EVENT: u64 = 5;
    pub const REQUEST: u64 = 6;
    pub const REQUEST_RESPONSE: u64 = 7;
}

/// Event subscriptions: General (ExitStarted) | Outputs (RecordStateChanged, RecordFileChanged).
pub const EVENT_SUBSCRIPTIONS: u64 = (1 << 0) | (1 << 6);

/// WebSocket close code sent by OBS when authentication fails.
pub const CLOSE_AUTH_FAILED: u16 = 4009;

/// `base64(sha256(base64(sha256(password + salt)) + challenge))`
pub fn auth_response(password: &str, salt: &str, challenge: &str) -> String {
    let secret = B64.encode(Sha256::digest(format!("{password}{salt}").as_bytes()));
    B64.encode(Sha256::digest(format!("{secret}{challenge}").as_bytes()))
}

/// Build the Identify message for a Hello payload (`d` of op 0).
/// Returns `Err` if OBS requires a password but none is configured.
pub fn identify_message(hello: &Value, password: &str) -> Result<String, String> {
    let mut d = json!({ "rpcVersion": 1, "eventSubscriptions": EVENT_SUBSCRIPTIONS });
    if let Some(auth) = hello.get("authentication") {
        if password.is_empty() {
            return Err("OBS requires a WebSocket password. Enter it in Settings.".into());
        }
        let salt = auth.get("salt").and_then(Value::as_str).unwrap_or_default();
        let challenge = auth.get("challenge").and_then(Value::as_str).unwrap_or_default();
        d["authentication"] = json!(auth_response(password, salt, challenge));
    }
    Ok(json!({ "op": op::IDENTIFY, "d": d }).to_string())
}

pub fn request_message(request_type: &str, request_id: &str, data: Option<Value>) -> String {
    let mut d = json!({ "requestType": request_type, "requestId": request_id });
    if let Some(data) = data {
        d["requestData"] = data;
    }
    json!({ "op": op::REQUEST, "d": d }).to_string()
}

/// Decoded `RequestResponse` (op 7).
pub fn parse_response(d: &Value) -> (String, Result<Value, String>) {
    let id = d.get("requestId").and_then(Value::as_str).unwrap_or_default().to_string();
    let status = d.get("requestStatus");
    let ok = status.and_then(|s| s.get("result")).and_then(Value::as_bool).unwrap_or(false);
    let result = if ok {
        Ok(d.get("responseData").cloned().unwrap_or(Value::Null))
    } else {
        let code = status.and_then(|s| s.get("code")).and_then(Value::as_u64).unwrap_or(0);
        let comment = status.and_then(|s| s.get("comment")).and_then(Value::as_str).unwrap_or("request failed");
        Err(format!("{comment} (code {code})"))
    };
    (id, result)
}

/// Non-empty string field helper (OBS sends `null` or "" for unknown paths).
pub fn str_field(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_matches_reference_algorithm() {
        // Reference values computed independently with Node's crypto module
        // using the example salt/challenge from the obs-websocket protocol docs.
        let got = auth_response(
            "supersecretpassword",
            "lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=",
            "+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY=",
        );
        assert_eq!(got, REFERENCE_AUTH);
    }

    const REFERENCE_AUTH: &str = include_str!("testdata/auth_reference.txt");

    #[test]
    fn identify_without_auth() {
        let msg: Value = serde_json::from_str(&identify_message(&json!({"rpcVersion": 1}), "").unwrap()).unwrap();
        assert_eq!(msg["op"], 1);
        assert_eq!(msg["d"]["rpcVersion"], 1);
        assert_eq!(msg["d"]["eventSubscriptions"], 65);
        assert!(msg["d"].get("authentication").is_none());
    }

    #[test]
    fn identify_requires_password_when_auth_enabled() {
        let hello = json!({"rpcVersion": 1, "authentication": {"salt": "a", "challenge": "b"}});
        assert!(identify_message(&hello, "").is_err());
        let msg: Value = serde_json::from_str(&identify_message(&hello, "pw").unwrap()).unwrap();
        assert_eq!(msg["d"]["authentication"], auth_response("pw", "a", "b"));
    }

    #[test]
    fn parses_success_and_failure_responses() {
        let (id, r) = parse_response(&json!({
            "requestId": "7", "requestStatus": {"result": true, "code": 100},
            "responseData": {"outputActive": true, "outputDuration": 1234}
        }));
        assert_eq!(id, "7");
        assert_eq!(r.unwrap()["outputDuration"], 1234);

        let (_, r) = parse_response(&json!({
            "requestId": "8", "requestStatus": {"result": false, "code": 501, "comment": "Output not running"}
        }));
        assert_eq!(r.unwrap_err(), "Output not running (code 501)");
    }

    #[test]
    fn request_message_shape() {
        let msg: Value = serde_json::from_str(&request_message("GetRecordStatus", "1", None)).unwrap();
        assert_eq!(msg["op"], 6);
        assert_eq!(msg["d"]["requestType"], "GetRecordStatus");
        assert_eq!(msg["d"]["requestId"], "1");
    }
}
