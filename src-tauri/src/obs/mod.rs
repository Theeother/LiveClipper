//! Minimal obs-websocket v5 client.
//!
//! A background supervisor keeps one connection open (reconnecting every few
//! seconds while OBS is closed), forwards recording events to the session
//! manager, and exposes `ObsHandle::request` for request/response calls such
//! as `GetRecordStatus`. Everything fails soft: if OBS is unavailable the rest
//! of the app keeps working in manual mode.

pub mod protocol;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot, watch};
use tokio_tungstenite::tungstenite::Message;

use crate::models::ObsSettings;
use protocol::op;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const RETRY_DELAY: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ObsConnState {
    Disabled,
    Connecting,
    Connected,
    Disconnected,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsStatus {
    pub state: ObsConnState,
    pub message: Option<String>,
    pub obs_version: Option<String>,
    pub websocket_version: Option<String>,
    pub recording: bool,
}

impl ObsStatus {
    fn new(state: ObsConnState, message: Option<String>) -> Self {
        Self { state, message, obs_version: None, websocket_version: None, recording: false }
    }
}

#[derive(Debug, Clone)]
pub enum ObsEvent {
    /// Handshake complete; requests can be made.
    Connected,
    Disconnected,
    RecordStateChanged { active: bool, state: String, path: Option<String> },
    RecordFileChanged { path: String },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsTestResult {
    pub obs_version: Option<String>,
    pub websocket_version: Option<String>,
    pub recording: bool,
}

type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>>;

/// Cheap, cloneable handle to the live connection.
#[derive(Clone)]
pub struct ObsHandle {
    out_tx: mpsc::UnboundedSender<String>,
    pending: Pending,
    next_id: Arc<AtomicU64>,
}

impl ObsHandle {
    pub async fn request(&self, request_type: &str, data: Option<Value>, timeout: Duration) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed).to_string();
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id.clone(), tx);
        if self.out_tx.send(protocol::request_message(request_type, &id, data)).is_err() {
            self.pending.lock().unwrap().remove(&id);
            return Err("OBS connection closed".into());
        }
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("OBS connection closed".into()),
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                Err(format!("OBS did not answer {request_type} in time"))
            }
        }
    }
}

/// Recording status as reported by `GetRecordStatus`.
#[derive(Debug, Clone, Copy)]
pub struct RecordStatus {
    pub active: bool,
    /// Milliseconds of recorded output.
    pub duration_ms: f64,
}

impl RecordStatus {
    pub fn from_response(v: &Value) -> Self {
        Self {
            active: v.get("outputActive").and_then(Value::as_bool).unwrap_or(false),
            duration_ms: v.get("outputDuration").and_then(Value::as_f64).unwrap_or(0.0),
        }
    }
}

pub struct ObsManager {
    status: Mutex<ObsStatus>,
    handle: Mutex<Option<ObsHandle>>,
    config_tx: watch::Sender<ObsSettings>,
}

enum RunEnd {
    ConfigChanged,
    Closed(String),
    AuthFailed(String),
}

type WsStream = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

impl ObsManager {
    pub fn new(config: ObsSettings) -> Arc<Self> {
        let (config_tx, _) = watch::channel(config);
        Arc::new(Self {
            status: Mutex::new(ObsStatus::new(ObsConnState::Connecting, None)),
            handle: Mutex::new(None),
            config_tx,
        })
    }

    pub fn status(&self) -> ObsStatus {
        self.status.lock().unwrap().clone()
    }

    /// The live connection, if identified with OBS.
    pub fn handle(&self) -> Option<ObsHandle> {
        self.handle.lock().unwrap().clone()
    }

    pub fn update_config(&self, config: ObsSettings) {
        self.config_tx.send_replace(config);
    }

    fn set_status(&self, app: &AppHandle, f: impl FnOnce(&mut ObsStatus)) {
        let snapshot = {
            let mut s = self.status.lock().unwrap();
            f(&mut s);
            s.clone()
        };
        let _ = app.emit("obs-status", snapshot);
    }

    pub fn spawn(self: &Arc<Self>, app: AppHandle, events: mpsc::UnboundedSender<ObsEvent>) {
        let mgr = self.clone();
        tauri::async_runtime::spawn(async move { mgr.supervise(app, events).await });
    }

    async fn supervise(self: Arc<Self>, app: AppHandle, events: mpsc::UnboundedSender<ObsEvent>) {
        let mut cfg_rx = self.config_tx.subscribe();
        loop {
            let cfg = cfg_rx.borrow_and_update().clone();
            if !cfg.enabled {
                self.set_status(&app, |s| *s = ObsStatus::new(ObsConnState::Disabled, None));
                if cfg_rx.changed().await.is_err() {
                    return;
                }
                continue;
            }

            // Background retries while OBS is closed stay "disconnected" in the UI
            // instead of flickering to "connecting" every few seconds.
            self.set_status(&app, |s| {
                if s.state != ObsConnState::Disconnected {
                    s.state = ObsConnState::Connecting;
                    s.message = None;
                }
            });
            let end = self.run_connection(&app, &cfg, &mut cfg_rx, &events).await;
            let was_connected = self.handle.lock().unwrap().take().is_some();
            if was_connected {
                let _ = events.send(ObsEvent::Disconnected);
            }

            let wait_for_change_only = match end {
                RunEnd::ConfigChanged => continue,
                RunEnd::Closed(msg) => {
                    self.set_status(&app, |s| *s = ObsStatus::new(ObsConnState::Disconnected, Some(msg)));
                    false
                }
                RunEnd::AuthFailed(msg) => {
                    // Retrying with the same wrong password is pointless.
                    self.set_status(&app, |s| *s = ObsStatus::new(ObsConnState::Error, Some(msg)));
                    true
                }
            };
            if wait_for_change_only {
                if cfg_rx.changed().await.is_err() {
                    return;
                }
            } else {
                tokio::select! {
                    _ = tokio::time::sleep(RETRY_DELAY) => {}
                    r = cfg_rx.changed() => if r.is_err() { return },
                }
            }
        }
    }

    async fn run_connection(
        &self,
        app: &AppHandle,
        cfg: &ObsSettings,
        cfg_rx: &mut watch::Receiver<ObsSettings>,
        events: &mpsc::UnboundedSender<ObsEvent>,
    ) -> RunEnd {
        let (ws, hello) = match handshake(cfg).await {
            Ok(v) => v,
            Err(HandshakeError::Auth(m)) => return RunEnd::AuthFailed(m),
            Err(HandshakeError::Other(m)) => return RunEnd::Closed(m),
        };
        let (mut write, mut read) = ws.split();
        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
        let pending: Pending = Default::default();
        let handle = ObsHandle { out_tx, pending: pending.clone(), next_id: Arc::new(AtomicU64::new(1)) };
        *self.handle.lock().unwrap() = Some(handle.clone());

        let ws_version = protocol::str_field(&hello, "obsWebSocketVersion");
        self.set_status(app, |s| {
            *s = ObsStatus::new(ObsConnState::Connected, None);
            s.websocket_version = ws_version;
        });
        let _ = events.send(ObsEvent::Connected);

        // Fill in version + current recording state without blocking the read loop.
        {
            let handle = handle.clone();
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let mgr = app_obs(&app);
                if let Ok(v) = handle.request("GetVersion", None, Duration::from_secs(2)).await {
                    mgr.set_status(&app, |s| s.obs_version = protocol::str_field(&v, "obsVersion"));
                }
                if let Ok(v) = handle.request("GetRecordStatus", None, Duration::from_secs(2)).await {
                    let active = RecordStatus::from_response(&v).active;
                    mgr.set_status(&app, |s| s.recording = active);
                }
            });
        }

        loop {
            tokio::select! {
                msg = read.next() => match msg {
                    Some(Ok(Message::Text(text))) => self.handle_incoming(app, &text, &pending, events),
                    Some(Ok(Message::Close(frame))) => {
                        let reason = frame.map(|f| f.reason.to_string()).filter(|r| !r.is_empty());
                        return RunEnd::Closed(reason.unwrap_or_else(|| "OBS closed the connection".into()));
                    }
                    Some(Ok(_)) => {}
                    Some(Err(e)) => return RunEnd::Closed(format!("Connection lost: {e}")),
                    None => return RunEnd::Closed("Connection lost".into()),
                },
                out = out_rx.recv() => if let Some(text) = out {
                    if let Err(e) = write.send(Message::Text(text.into())).await {
                        return RunEnd::Closed(format!("Connection lost: {e}"));
                    }
                },
                r = cfg_rx.changed() => {
                    let _ = write.send(Message::Close(None)).await;
                    if r.is_err() { return RunEnd::Closed("Shutting down".into()); }
                    return RunEnd::ConfigChanged;
                }
            }
        }
    }

    fn handle_incoming(&self, app: &AppHandle, text: &str, pending: &Pending, events: &mpsc::UnboundedSender<ObsEvent>) {
        let Ok(msg) = serde_json::from_str::<Value>(text) else { return };
        let d = &msg["d"];
        match msg["op"].as_u64() {
            Some(op::REQUEST_RESPONSE) => {
                let (id, result) = protocol::parse_response(d);
                if let Some(tx) = pending.lock().unwrap().remove(&id) {
                    let _ = tx.send(result);
                }
            }
            Some(op::EVENT) => {
                let data = &d["eventData"];
                match d["eventType"].as_str() {
                    Some("RecordStateChanged") => {
                        let active = data["outputActive"].as_bool().unwrap_or(false);
                        let state = data["outputState"].as_str().unwrap_or_default().to_string();
                        self.set_status(app, |s| s.recording = active);
                        let _ = events.send(ObsEvent::RecordStateChanged {
                            active,
                            state,
                            path: protocol::str_field(data, "outputPath"),
                        });
                    }
                    Some("RecordFileChanged") => {
                        if let Some(path) = protocol::str_field(data, "newOutputPath") {
                            let _ = events.send(ObsEvent::RecordFileChanged { path });
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
}

fn app_obs(app: &AppHandle) -> Arc<ObsManager> {
    use tauri::Manager;
    app.state::<crate::AppState>().obs.clone()
}

enum HandshakeError {
    Auth(String),
    Other(String),
}

async fn handshake(cfg: &ObsSettings) -> Result<(WsStream, Value), HandshakeError> {
    let url = format!("ws://{}:{}", cfg.host.trim(), cfg.port);
    let (mut ws, _) = match tokio::time::timeout(CONNECT_TIMEOUT, tokio_tungstenite::connect_async(&url)).await {
        Ok(Ok(v)) => v,
        Ok(Err(e)) => return Err(HandshakeError::Other(format!("Cannot reach OBS at {url} ({e})"))),
        Err(_) => return Err(HandshakeError::Other(format!("Timed out connecting to OBS at {url}"))),
    };

    let hello = read_op(&mut ws, op::HELLO).await?;
    let identify = protocol::identify_message(&hello, &cfg.password).map_err(HandshakeError::Auth)?;
    ws.send(Message::Text(identify.into()))
        .await
        .map_err(|e| HandshakeError::Other(e.to_string()))?;
    read_op(&mut ws, op::IDENTIFIED).await?;
    Ok((ws, hello))
}

/// Wait for a message with the given opcode (returns its `d`).
async fn read_op(ws: &mut WsStream, wanted: u64) -> Result<Value, HandshakeError> {
    let fut = async {
        while let Some(msg) = ws.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    if let Ok(v) = serde_json::from_str::<Value>(&text) {
                        if v["op"].as_u64() == Some(wanted) {
                            return Ok(v["d"].clone());
                        }
                    }
                }
                Ok(Message::Close(frame)) => {
                    let code = frame.as_ref().map(|f| u16::from(f.code));
                    return Err(if code == Some(protocol::CLOSE_AUTH_FAILED) {
                        HandshakeError::Auth("OBS rejected the WebSocket password.".into())
                    } else {
                        HandshakeError::Other(
                            frame.map(|f| f.reason.to_string()).unwrap_or_else(|| "OBS closed the connection".into()),
                        )
                    });
                }
                Ok(_) => {}
                Err(e) => return Err(HandshakeError::Other(e.to_string())),
            }
        }
        Err(HandshakeError::Other("OBS closed the connection".into()))
    };
    tokio::time::timeout(Duration::from_secs(5), fut)
        .await
        .unwrap_or_else(|_| Err(HandshakeError::Other("OBS handshake timed out".into())))
}

/// One-off connection used by the Settings "Test connection" button.
pub async fn test_connection(cfg: &ObsSettings) -> Result<ObsTestResult, String> {
    let (mut ws, hello) = handshake(cfg).await.map_err(|e| match e {
        HandshakeError::Auth(m) | HandshakeError::Other(m) => m,
    })?;

    let mut responses = HashMap::new();
    for (id, ty) in [("1", "GetVersion"), ("2", "GetRecordStatus")] {
        ws.send(Message::Text(protocol::request_message(ty, id, None).into()))
            .await
            .map_err(|e| e.to_string())?;
    }
    let collect = async {
        while responses.len() < 2 {
            match ws.next().await {
                Some(Ok(Message::Text(text))) => {
                    let Ok(v) = serde_json::from_str::<Value>(&text) else { continue };
                    if v["op"].as_u64() == Some(op::REQUEST_RESPONSE) {
                        let (id, r) = protocol::parse_response(&v["d"]);
                        responses.insert(id, r.unwrap_or(json!({})));
                    }
                }
                Some(Ok(_)) => {}
                _ => break,
            }
        }
    };
    let _ = tokio::time::timeout(Duration::from_secs(3), collect).await;
    let _ = ws.close(None).await;

    let version = responses.get("1").cloned().unwrap_or_default();
    let record = responses.get("2").cloned().unwrap_or_default();
    Ok(ObsTestResult {
        obs_version: protocol::str_field(&version, "obsVersion"),
        websocket_version: protocol::str_field(&hello, "obsWebSocketVersion"),
        recording: RecordStatus::from_response(&record).active,
    })
}
