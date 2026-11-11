//! Native-only ChatGPT credential ownership. No renderer receives a token or URL.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, AtomicI32, AtomicU64, AtomicUsize, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const ERROR: &str =
    "ChatGPT connection unavailable. Reload connection status; no API-key fallback.";
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Model {
    slug: String,
    display_name: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Registration {
    id: String,
    epoch: u64,
    issuer: String,
    subject: String,
    email: String,
    client_id: String,
    access_token: Option<String>,
    refresh_token: Option<String>,
    id_token: Option<String>,
    scopes: Vec<String>,
    expires_at: u64,
    earliest_refresh_at: u64,
    models: Vec<Model>,
    state: String,
    disclosed: bool,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Document {
    version: u8,
    host_id: String,
    registrations: Vec<Registration>,
}
#[derive(Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum BrokerOperation {
    Credential,
    Current,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct BrokerRequest {
    operation: BrokerOperation,
    registration_id: String,
    epoch: u64,
}
struct Store {
    document: Document,
    bytes: Vec<u8>,
    file_identity: Option<(u64, u64)>,
    records: crate::private_store::PinnedDirectory,
    _owner: crate::private_store::PinnedDirectory,
}
pub struct Owner {
    store: Mutex<Store>,
    path: PathBuf,
    resources: PathBuf,
    attempt: AtomicU64,
    attempt_gate: Mutex<()>,
    auth_pid: AtomicI32,
    authorizing: AtomicBool,
    pending_client: Mutex<Option<String>>,
    stopped: AtomicBool,
    requests: AtomicUsize,
    port: u16,
    capability: String,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn text(value: &str, max: usize) -> bool {
    !value.is_empty() && value.encode_utf16().count() <= max && !value.chars().any(char::is_control)
}
fn ui_current(scope: Option<(&AtomicU64, u64)>) -> bool {
    scope
        .map(|(generation, expected)| generation.load(Ordering::SeqCst) == expected)
        .unwrap_or(true)
}
// Caller serializes this with reservation/close. A cancelled queued request
// cannot start later, and a stale Cancel cannot invalidate a newer reservation.
pub fn cancel_ui_generation(generation: &AtomicU64, base: u64) -> bool {
    let current = generation.load(Ordering::SeqCst);
    if base > 9_007_199_254_740_989 || (current != base && current != base + 1) {
        return false;
    }
    generation
        .compare_exchange(current, base + 2, Ordering::SeqCst, Ordering::SeqCst)
        .is_ok()
}
fn plan(registration: &Registration) -> bool {
    registration.access_token.is_some()
        && ["chatgpt.tokens.use.direct", "resource.invoke"]
            .iter()
            .all(|s| registration.scopes.iter().any(|v| v == s))
}
fn uuid4(value: &str) -> bool {
    uuid::Uuid::parse_str(value)
        .map(|id| id.get_version_num() == 4 && id.to_string() == value)
        .unwrap_or(false)
}
fn valid(document: &Document) -> bool {
    let mut ids = std::collections::HashSet::new();
    let mut bindings = std::collections::HashSet::new();
    document.version == 1
        && document.host_id.starts_with("urn:uuid:")
        && uuid4(&document.host_id[9..])
        && document.registrations.len() <= 16
        && document.registrations.iter().all(|r| {
            let mut models = std::collections::HashSet::new();
            r.id.starts_with("registration_")
                && uuid4(&r.id[13..])
                && ids.insert(&r.id)
                && bindings.insert((&r.issuer, &r.subject, &r.client_id))
                && r.epoch > 0
                && r.epoch <= 9_007_199_254_740_991
                && r.issuer == "https://auth.openai.com"
                && text(&r.subject, 256)
                && text(&r.email, 254)
                && text(&r.client_id, 256)
                && r.client_id != "dynamic_agent_client"
                && [&r.access_token, &r.refresh_token, &r.id_token]
                    .iter()
                    .all(|token| token.as_ref().map(|s| text(s, 16384)).unwrap_or(true))
                && r.scopes.len() <= 32
                && r.scopes.iter().all(|s| text(s, 128))
                && r.models.len() <= 256
                && r.models.iter().all(|m| {
                    text(&m.slug, 256) && text(&m.display_name, 256) && models.insert(&m.slug)
                })
                && [
                    "connected",
                    "identity-only",
                    "disconnected",
                    "reconnect-required",
                ]
                .contains(&r.state.as_str())
        })
}
impl Owner {
    pub fn start(root: &Path, resources: &Path) -> Result<Arc<Self>, &'static str> {
        let root = root.join("chatgpt-v1");
        let path = root.join("records/credentials-v1.json");
        // Exclusive initial publication also creates private parents. Existing unsafe
        // objects and unknown versions refuse rather than being adopted/downgraded.
        if !path.try_exists().map_err(|_| ERROR)? {
            let initial = Document {
                version: 1,
                host_id: format!("urn:uuid:{}", uuid::Uuid::new_v4()),
                registrations: vec![],
            };
            let confirmed = crate::private_store::publish(
                &path,
                &serde_json::to_vec(&initial).map_err(|_| ERROR)?,
                None,
            )?;
            if !confirmed {
                return Err("ChatGPT host identity committed; durability uncertain. Reopen and inspect before authorizing.");
            }
        }
        let pinned = crate::private_store::PinnedDirectory::open(&root)?;
        pinned.lock_exclusive()?; // Cross-process refresh exclusion; no lock stealing.
        let records = crate::private_store::PinnedDirectory::open(path.parent().ok_or(ERROR)?)?;
        let (device, inode, bytes) = crate::private_store::capture(&path)?;
        records.verify()?;
        let document: Document = serde_json::from_slice(&bytes).map_err(|_| ERROR)?;
        if !valid(&document) {
            return Err(ERROR);
        }
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|_| ERROR)?;
        listener.set_nonblocking(true).map_err(|_| ERROR)?;
        let owner = Arc::new(Self {
            store: Mutex::new(Store {
                document,
                bytes,
                file_identity: Some((device, inode)),
                records,
                _owner: pinned,
            }),
            path,
            resources: resources.into(),
            attempt: AtomicU64::new(0),
            attempt_gate: Mutex::new(()),
            auth_pid: AtomicI32::new(0),
            authorizing: AtomicBool::new(false),
            pending_client: Mutex::new(None),
            stopped: AtomicBool::new(false),
            requests: AtomicUsize::new(0),
            port: listener.local_addr().map_err(|_| ERROR)?.port(),
            capability: format!("{}{}", uuid::Uuid::new_v4(), uuid::Uuid::new_v4()),
        });
        let weak = Arc::downgrade(&owner);
        std::thread::spawn(move || loop {
            let Some(owner) = weak.upgrade() else {
                break;
            };
            if owner.stopped.load(Ordering::SeqCst) {
                break;
            }
            match listener.accept() {
                Ok((socket, _)) => {
                    if owner.requests.fetch_add(1, Ordering::SeqCst) >= 8 {
                        owner.requests.fetch_sub(1, Ordering::SeqCst);
                        drop(socket);
                        continue;
                    }
                    let worker = owner.clone();
                    std::thread::spawn(move || {
                        struct Request(Arc<Owner>);
                        impl Drop for Request {
                            fn drop(&mut self) {
                                self.0.requests.fetch_sub(1, Ordering::SeqCst);
                            }
                        }
                        let request = Request(worker);
                        let _ = request.0.serve(socket);
                    });
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(50))
                }
                Err(_) => break,
            }
        });
        Ok(owner)
    }
    pub fn descriptor(&self) -> Value {
        json!({"version":1,"port":self.port,"capability":self.capability,"connections":self.metadata()})
    }
    pub fn metadata(&self) -> Value {
        let Ok(store) = self.store.lock() else {
            return json!([]);
        };
        let current = self.verify_store(&store).is_ok();
        Value::Array(store.document.registrations.iter().enumerate().map(|(index,r)| json!({"id":r.id,"epoch":r.epoch,"label":format!("{} · {}",r.email,index+1),"state":if current {r.state.as_str()} else {"unavailable"},"planEnabled":current && plan(r),"models":r.models,"disclosed":r.disclosed})).collect())
    }
    fn verify_store(&self, store: &Store) -> Result<(), &'static str> {
        store._owner.verify()?;
        store.records.verify()?;
        let (device, inode, mut current) = crate::private_store::capture(&self.path)?;
        let unchanged = store.file_identity == Some((device, inode))
            && current == store.bytes
            && valid(&store.document);
        current.fill(0);
        store.records.verify()?;
        if !unchanged {
            return Err(ERROR);
        }
        Ok(())
    }
    fn publish(&self, store: &mut Store) -> Result<(), &'static str> {
        if let Err(error) = self.verify_store(store) {
            store.document = serde_json::from_slice(&store.bytes).map_err(|_| ERROR)?;
            return Err(error);
        }
        if !valid(&store.document) {
            store.document = serde_json::from_slice(&store.bytes).map_err(|_| ERROR)?;
            return Err(ERROR);
        }
        let next = serde_json::to_vec(&store.document).map_err(|_| ERROR)?;
        let confirmed = match crate::private_store::publish(&self.path, &next, Some(&store.bytes)) {
            Ok(confirmed) => confirmed,
            Err(error) => {
                // Failed precommit mutation must not become in-memory authority.
                store.document = serde_json::from_slice(&store.bytes).map_err(|_| ERROR)?;
                return Err(error);
            }
        };
        store.bytes.fill(0);
        store.bytes = next;
        store.file_identity = None;
        if let Ok((device, inode, mut current)) = crate::private_store::capture(&self.path) {
            if current == store.bytes
                && store._owner.verify().is_ok()
                && store.records.verify().is_ok()
            {
                store.file_identity = Some((device, inode));
            }
            current.fill(0);
        }
        if !confirmed || store.file_identity.is_none() {
            return Err("ChatGPT credentials committed; durability uncertain. Reload before another action.");
        }
        Ok(())
    }
    fn helper(
        &self,
        input: Value,
        auth_epoch: Option<u64>,
        scope: Option<(&AtomicU64, u64)>,
    ) -> Result<Value, &'static str> {
        let start = self.attempt_gate.lock().map_err(|_| ERROR)?;
        if self.stopped.load(Ordering::SeqCst)
            || !ui_current(scope)
            || auth_epoch
                .map(|epoch| self.attempt.load(Ordering::SeqCst) != epoch)
                .unwrap_or(false)
        {
            return Err(ERROR);
        }
        let mut child = Command::new(self.resources.join("node"))
            .arg(self.resources.join("runtime/scripts/chatgpt-oauth.mjs"))
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .process_group(0)
            .spawn()
            .map_err(|_| ERROR)?;
        let pid = child.id() as i32;
        if auth_epoch.is_some() {
            self.auth_pid.store(pid, Ordering::SeqCst);
        }
        drop(start);
        let result = (|| {
            let mut bytes = serde_json::to_vec(&input).map_err(|_| ERROR)?;
            let sent = child.stdin.take().ok_or(ERROR)?.write_all(&bytes);
            bytes.fill(0);
            sent.map_err(|_| ERROR)?;
            let mut stdout = child.stdout.take().ok_or(ERROR)?;
            let (tx, rx) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                let mut bytes = Vec::new();
                let result = stdout.by_ref().take(128 * 1024 + 1).read_to_end(&mut bytes);
                let _ = tx.send((result.is_ok(), bytes));
            });
            let deadline =
                Instant::now() + Duration::from_secs(if auth_epoch.is_some() { 180 } else { 50 });
            let mut output = loop {
                if self.stopped.load(Ordering::SeqCst)
                    || !ui_current(scope)
                    || auth_epoch
                        .map(|epoch| self.attempt.load(Ordering::SeqCst) != epoch)
                        .unwrap_or(false)
                    || Instant::now() >= deadline
                {
                    return Err(
                        "ChatGPT operation cancelled or timed out; committed state is preserved.",
                    );
                }
                match rx.recv_timeout(Duration::from_millis(50)) {
                    Ok((true, bytes)) if bytes.len() <= 128 * 1024 => break bytes,
                    Ok(_) | Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                        return Err(ERROR)
                    }
                    Err(_) => continue,
                }
            };
            let parsed = serde_json::from_slice::<Value>(&output);
            output.fill(0);
            let value = parsed.map_err(|_| ERROR)?;
            if value["ok"] != true {
                if auth_epoch.is_some() && value["code"] == "reconnect-required" {
                    if let Some(client) = value["pendingClientId"]
                        .as_str()
                        .filter(|client| text(client, 256) && *client != "dynamic_agent_client")
                    {
                        *self.pending_client.lock().map_err(|_| ERROR)? = Some(client.into());
                        return Err("ChatGPT authorization code expired. Sign in again; the issued registration is retained for this session.");
                    }
                    return Err("ChatGPT authorization code expired. Sign in again using the selected saved registration.");
                }
                return Err(match value["code"].as_str() {
                    Some("reconnect-required") => "reconnect-required",
                    Some("denied") => "ChatGPT permission declined; previous connection preserved.",
                    Some("identity") => {
                        "ChatGPT identity validation failed; previous connection preserved."
                    }
                    Some("consent-required") => "ChatGPT plan permission required.",
                    Some("ineligible") => "ChatGPT plan access unavailable for this registration.",
                    _ => ERROR,
                });
            }
            Ok(value["result"].clone())
        })();
        // Serialize cancellation and reaping so a sampled PID cannot outlive
        // its owned child and be reused by an unrelated process before kill.
        let _settlement = self
            .attempt_gate
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        unsafe {
            libc::kill(-pid, libc::SIGKILL);
        }
        let _ = child.wait();
        if auth_epoch.is_some() {
            let _ = self
                .auth_pid
                .compare_exchange(pid, 0, Ordering::SeqCst, Ordering::SeqCst);
        }
        result
    }
    pub fn cancel(&self) {
        let _gate = self
            .attempt_gate
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        self.cancel_locked();
    }
    fn cancel_locked(&self) {
        self.attempt.fetch_add(1, Ordering::SeqCst);
        let pid = self.auth_pid.load(Ordering::SeqCst);
        if pid > 0 {
            unsafe {
                libc::kill(-pid, libc::SIGTERM);
            }
        }
    }
    pub fn stop(&self) {
        self.stopped.store(true, Ordering::SeqCst);
        self.cancel();
    }
    pub fn reserve_sign_in(&self) -> Result<u64, &'static str> {
        let _gate = self.attempt_gate.lock().map_err(|_| ERROR)?;
        if self.stopped.load(Ordering::SeqCst) {
            return Err(ERROR);
        }
        if self.authorizing.swap(true, Ordering::SeqCst) {
            return Err("ChatGPT sign-in is already active.");
        }
        Ok(self.attempt.fetch_add(1, Ordering::SeqCst) + 1)
    }
    pub fn sign_in(
        &self,
        selected: Option<String>,
        consent: bool,
        epoch: u64,
        scope: Option<(&AtomicU64, u64)>,
    ) -> Result<(), &'static str> {
        struct Attempt<'a>(&'a AtomicBool);
        impl Drop for Attempt<'_> {
            fn drop(&mut self) {
                self.0.store(false, Ordering::SeqCst);
            }
        }
        let _attempt = Attempt(&self.authorizing);
        if !ui_current(scope)
            || self.attempt.load(Ordering::SeqCst) != epoch
            || self.stopped.load(Ordering::SeqCst)
        {
            return Err(ERROR);
        }
        let (host, registration) = {
            let store = self.store.lock().map_err(|_| ERROR)?;
            self.verify_store(&store)?;
            let registration = selected
                .as_ref()
                .map(|id| {
                    store
                        .document
                        .registrations
                        .iter()
                        .find(|r| &r.id == id)
                        .cloned()
                        .ok_or(ERROR)
                })
                .transpose()?;
            if registration.is_none() && store.document.registrations.len() >= 16 {
                return Err("Maximum 16 saved ChatGPT registrations.");
            }
            (store.document.host_id.clone(), registration)
        };
        let pending_client = if registration.is_none() {
            self.pending_client.lock().map_err(|_| ERROR)?.clone()
        } else {
            None
        };
        let result = self.helper(json!({"operation":"sign-in","hostId":host,"registration":registration,"pendingClientId":pending_client,"consent":consent}), Some(epoch), scope)?;
        let mut store = self.store.lock().map_err(|_| ERROR)?;
        let _commit = self.attempt_gate.lock().map_err(|_| ERROR)?;
        if !ui_current(scope)
            || self.attempt.load(Ordering::SeqCst) != epoch
            || self.stopped.load(Ordering::SeqCst)
        {
            return Err("Cancelled ChatGPT sign-in cannot replace credentials.");
        }
        let id = registration
            .as_ref()
            .map(|r| r.id.clone())
            .unwrap_or_else(|| format!("registration_{}", uuid::Uuid::new_v4()));
        // Preserve distinct registrations even when emails match; duplicate verified
        // binding must be reauthorized deliberately through its existing entry.
        let mut value = result;
        value["id"] = json!(id);
        value["epoch"] = json!(registration.as_ref().map(|r| r.epoch + 1).unwrap_or(1));
        value["state"] = json!("connected");
        value["disclosed"] = json!(registration.as_ref().map(|r| r.disclosed).unwrap_or(false));
        let mut connection: Registration = serde_json::from_value(value).map_err(|_| ERROR)?;
        if !plan(&connection) {
            connection.state = "identity-only".into();
        }
        if let Some(prior) = registration {
            if prior.issuer != connection.issuer
                || prior.subject != connection.subject
                || prior.client_id != connection.client_id
            {
                return Err(ERROR);
            }
            let position = store
                .document
                .registrations
                .iter()
                .position(|r| r.id == id && r.epoch == prior.epoch)
                .ok_or(ERROR)?;
            store.document.registrations[position] = connection;
        } else {
            if store.document.registrations.iter().any(|r| {
                r.issuer == connection.issuer
                    && r.subject == connection.subject
                    && r.client_id == connection.client_id
            }) {
                return Err("This ChatGPT registration already exists. Choose its saved entry to reconnect.");
            }
            store.document.registrations.push(connection);
        }
        self.publish(&mut store)?;
        *self.pending_client.lock().map_err(|_| ERROR)? = None;
        Ok(())
    }
    fn renewable(
        &self,
        store: &mut Store,
        id: &str,
        epoch: u64,
    ) -> Result<Registration, &'static str> {
        self.verify_store(store)?;
        let position = store
            .document
            .registrations
            .iter()
            .position(|r| r.id == id && r.epoch == epoch)
            .ok_or(ERROR)?;
        let mut registration = store.document.registrations[position].clone();
        if !plan(&registration) {
            return Err("ChatGPT plan permission or reconnection required.");
        }
        if now() + 60 >= registration.expires_at && now() >= registration.earliest_refresh_at {
            if registration.refresh_token.is_none() {
                if registration.expires_at > now() {
                    return Ok(registration);
                }
                let r = &mut store.document.registrations[position];
                r.access_token = None;
                r.id_token = None;
                r.epoch += 1;
                r.state = "reconnect-required".into();
                self.publish(store)?;
                return Err("ChatGPT session expired without renewable permission; reconnect the saved registration.");
            }
            let result = self.helper(
                json!({"operation":"refresh","registration":registration}),
                None,
                None,
            );
            match result {
                Ok(mut value) => {
                    value["id"] = json!(registration.id);
                    value["epoch"] = json!(registration.epoch);
                    value["state"] = json!("connected");
                    value["disclosed"] = json!(registration.disclosed);
                    value["models"] = json!(registration.models);
                    let mut next: Registration =
                        serde_json::from_value(value).map_err(|_| ERROR)?;
                    if next.client_id != registration.client_id
                        || next.issuer != registration.issuer
                        || next.subject != registration.subject
                    {
                        return Err(ERROR);
                    }
                    if !plan(&next) {
                        next.state = "identity-only".into();
                        next.epoch += 1;
                    }
                    store.document.registrations[position] = next.clone();
                    self.publish(store)?;
                    registration = next;
                }
                Err("reconnect-required") => {
                    let r = &mut store.document.registrations[position];
                    r.access_token = None;
                    r.refresh_token = None;
                    r.id_token = None;
                    r.epoch += 1;
                    r.state = "reconnect-required".into();
                    self.publish(store)?;
                    return Err("ChatGPT session ended; reconnect the saved registration.");
                }
                Err(error) => return Err(error), // Transient failures never erase tokens.
            }
        }
        if registration.expires_at <= now() || !plan(&registration) {
            return Err("ChatGPT plan session unavailable; reconnect or retry later.");
        }
        Ok(registration)
    }
    pub fn discover_models(
        &self,
        id: &str,
        scope: Option<(&AtomicU64, u64)>,
    ) -> Result<(), &'static str> {
        let mut store = self.store.lock().map_err(|_| ERROR)?;
        if !ui_current(scope) {
            return Err(ERROR);
        }
        let epoch = store
            .document
            .registrations
            .iter()
            .find(|r| r.id == id)
            .ok_or(ERROR)?
            .epoch;
        let registration = self.renewable(&mut store, id, epoch)?;
        let models: Vec<Model> = serde_json::from_value(self.helper(
            json!({"operation":"models","registration":registration}),
            None,
            scope,
        )?)
        .map_err(|_| ERROR)?;
        let _commit = self.attempt_gate.lock().map_err(|_| ERROR)?;
        if !ui_current(scope) {
            return Err(ERROR);
        }
        let registration = store
            .document
            .registrations
            .iter_mut()
            .find(|r| r.id == id && r.epoch == epoch)
            .ok_or(ERROR)?;
        if registration.models == models {
            return Ok(());
        }
        registration.models = models;
        registration.epoch += 1;
        self.publish(&mut store)
    }
    pub fn disclose(&self, id: &str, scope: Option<(&AtomicU64, u64)>) -> Result<(), &'static str> {
        let mut store = self.store.lock().map_err(|_| ERROR)?;
        self.verify_store(&store)?;
        let _commit = self.attempt_gate.lock().map_err(|_| ERROR)?;
        if !ui_current(scope) {
            return Err(ERROR);
        }
        let registration = store
            .document
            .registrations
            .iter_mut()
            .find(|r| r.id == id)
            .ok_or(ERROR)?;
        if !plan(registration) {
            return Err(ERROR);
        }
        if registration.disclosed {
            return Ok(());
        }
        registration.disclosed = true;
        registration.epoch += 1;
        self.publish(&mut store)
    }
    pub fn disconnect(
        &self,
        id: &str,
        after_local: impl FnOnce(),
        scope: Option<(&AtomicU64, u64)>,
    ) -> Result<bool, &'static str> {
        let old = {
            let mut store = self.store.lock().map_err(|_| ERROR)?;
            let _commit = self.attempt_gate.lock().map_err(|_| ERROR)?;
            if !ui_current(scope) {
                return Err(ERROR);
            }
            self.cancel_locked();
            let registration = store
                .document
                .registrations
                .iter_mut()
                .find(|r| r.id == id)
                .ok_or(ERROR)?;
            let old = registration.clone();
            registration.epoch += 1;
            registration.access_token = None;
            registration.refresh_token = None;
            registration.id_token = None;
            registration.scopes.clear();
            registration.state = "disconnected".into();
            registration.models.clear();
            self.publish(&mut store)?;
            old
        };
        after_local();
        // Local disconnect is already committed even if remote revocation fails.
        Ok(old.refresh_token.is_some()
            && self
                .helper(json!({"operation":"revoke","registration":old}), None, None)
                .map(|value| value["confirmed"] == true)
                .unwrap_or(false))
    }
    fn serve(&self, mut socket: TcpStream) -> Result<(), &'static str> {
        socket
            .set_read_timeout(Some(Duration::from_secs(2)))
            .map_err(|_| ERROR)?;
        socket
            .set_write_timeout(Some(Duration::from_secs(2)))
            .map_err(|_| ERROR)?;
        let mut bytes = Vec::new();
        let deadline = Instant::now() + Duration::from_secs(2);
        while !bytes.ends_with(b"\r\n\r\n") {
            if bytes.len() >= 8192 || Instant::now() >= deadline {
                return Err(ERROR);
            }
            let mut byte = [0];
            if socket.read(&mut byte).map_err(|_| ERROR)? != 1 {
                return Err(ERROR);
            }
            bytes.push(byte[0]);
        }
        let header = std::str::from_utf8(&bytes).map_err(|_| ERROR)?;
        let lines: Vec<_> = header.split("\r\n").collect();
        let allowed = format!("x-chatgpt-owner: {}", self.capability);
        let hosts: Vec<_> = lines
            .iter()
            .filter_map(|line| {
                line.to_ascii_lowercase()
                    .strip_prefix("host:")
                    .map(|host| host.trim().to_owned())
            })
            .collect();
        let authorized = !(lines.first() != Some(&"POST /credential HTTP/1.1")
            || hosts != vec![format!("127.0.0.1:{}", self.port)]
            || lines
                .iter()
                .filter(|line| line.to_ascii_lowercase().starts_with("x-chatgpt-owner:"))
                .count()
                != 1
            || !lines.iter().any(|line| *line == allowed)
            || lines.iter().any(|line| {
                let lower = line.to_ascii_lowercase();
                lower.starts_with("origin:")
                    || lower.starts_with("sec-fetch-")
                    || lower.starts_with("transfer-encoding:")
            }));
        let lengths: Vec<_> = lines
            .iter()
            .filter_map(|line| {
                line.to_ascii_lowercase()
                    .strip_prefix("content-length:")
                    .map(str::trim)
                    .and_then(|s| s.parse::<usize>().ok())
            })
            .collect();
        if lengths.len() != 1
            || lengths[0] > 512
            || lines
                .iter()
                .filter(|line| line.to_ascii_lowercase().starts_with("content-length:"))
                .count()
                != 1
        {
            return Err(ERROR);
        }
        let mut body = vec![0; lengths[0]];
        socket.read_exact(&mut body).map_err(|_| ERROR)?;
        if !authorized {
            socket
                .write_all(
                    b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .map_err(|_| ERROR)?;
            return Ok(());
        }
        let result = (|| {
            let value: BrokerRequest = serde_json::from_slice(&body).map_err(|_| ERROR)?;
            let id = value.registration_id.as_str();
            let epoch = value.epoch;
            let mut store = self.store.lock().map_err(|_| ERROR)?;
            if self.stopped.load(Ordering::SeqCst) {
                return Err(ERROR);
            }
            if value.operation == BrokerOperation::Current {
                self.verify_store(&store)?;
                let r = store
                    .document
                    .registrations
                    .iter()
                    .find(|r| r.id == id && r.epoch == epoch)
                    .ok_or(ERROR)?;
                if !plan(r) {
                    return Err(ERROR);
                }
                return Ok(json!({"current":true}));
            }
            let registration = self.renewable(&mut store, id, epoch)?;
            Ok(json!({"accessToken":registration.access_token,"epoch":epoch}))
        })();
        let (status, result) = match result {
            Ok(value) => ("200 OK", value),
            Err(_) => (
                "409 Conflict",
                json!({"code":"chatgpt_connection_unavailable","connections":self.metadata()}),
            ),
        };
        let mut output = serde_json::to_vec(&result).map_err(|_| ERROR)?;
        let sent = write!(socket,"HTTP/1.1 {status}\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",output.len()).and_then(|_| socket.write_all(&output));
        output.fill(0);
        sent.map_err(|_| ERROR)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("trainer-chatgpt-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&path).unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
            Self(std::fs::canonicalize(path).unwrap())
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn registration() -> Registration {
        Registration {
            id: format!("registration_{}", uuid::Uuid::new_v4()),
            epoch: 1,
            issuer: "https://auth.openai.com".into(),
            subject: "authored-subject".into(),
            email: "synthetic@example.invalid".into(),
            client_id: "oaiapp_authored".into(),
            access_token: Some("authored-private-access".into()),
            refresh_token: Some("authored-private-refresh".into()),
            id_token: Some("authored-private-id".into()),
            scopes: vec!["resource.invoke".into(), "chatgpt.tokens.use.direct".into()],
            expires_at: now() + 3600,
            earliest_refresh_at: now(),
            models: vec![Model {
                slug: "authored-model".into(),
                display_name: "Authored model".into(),
            }],
            state: "connected".into(),
            disclosed: false,
        }
    }
    fn connected(owner: &Owner) -> Registration {
        let r = registration();
        let mut store = owner.store.lock().unwrap();
        store.document.registrations.push(r.clone());
        owner.publish(&mut store).unwrap();
        r
    }
    fn request(owner: &Owner, headers: &str, body: Value) -> String {
        let body = serde_json::to_string(&body).unwrap();
        let mut socket = TcpStream::connect(("127.0.0.1", owner.port)).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        write!(socket,"POST /credential HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nContent-Length: {}\r\n{headers}\r\n{body}",owner.port,body.len()).unwrap();
        let mut response = String::new();
        socket.read_to_string(&mut response).unwrap();
        response
    }
    #[test]
    fn private_metadata_restart_and_host_identity_preserve_exact_registration() {
        let fixture = Fixture::new();
        let owner = Owner::start(&fixture.0, &fixture.0).unwrap();
        let registration = connected(&owner);
        let host = owner.store.lock().unwrap().document.host_id.clone();
        let metadata = owner.metadata().to_string();
        for secret in [
            "authored-private-access",
            "authored-private-refresh",
            "authored-private-id",
            "oaiapp_authored",
            "authored-subject",
        ] {
            assert!(!metadata.contains(secret));
        }
        assert!(metadata.contains("synthetic@example.invalid"));
        owner.stop();
        drop(owner);
        std::thread::sleep(Duration::from_millis(100));
        let reopened = Owner::start(&fixture.0, &fixture.0).unwrap();
        let store = reopened.store.lock().unwrap();
        assert_eq!(store.document.host_id, host);
        assert_eq!(store.document.registrations[0].id, registration.id);
        assert_eq!(
            store.document.registrations[0].access_token.as_deref(),
            Some("authored-private-access")
        );
    }
    #[test]
    fn cross_process_ownership_and_unknown_documents_refuse_without_adoption() {
        let fixture = Fixture::new();
        let owner = Owner::start(&fixture.0, &fixture.0).unwrap();
        assert!(Owner::start(&fixture.0, &fixture.0).is_err());
        let path = owner.path.clone();
        owner.stop();
        drop(owner);
        std::thread::sleep(Duration::from_millis(100));
        let before = crate::private_store::read(&path).unwrap();
        let mut document: Value = serde_json::from_slice(&before).unwrap();
        document["version"] = json!(999);
        let unsupported = serde_json::to_vec(&document).unwrap();
        crate::private_store::publish(&path, &unsupported, Some(&before)).unwrap();
        assert!(Owner::start(&fixture.0, &fixture.0).is_err());
        assert_eq!(crate::private_store::read(&path).unwrap(), unsupported);
    }
    #[test]
    fn broker_refuses_browser_wrong_capability_stale_epoch_and_extra_fields() {
        for body in [
            r#"{"operation":"credential","operation":"current","registrationId":"a","epoch":1}"#,
            r#"{"operation":"unknown","registrationId":"a","epoch":1}"#,
            r#"{"operation":"current","registrationId":"a","epoch":1,"extra":true}"#,
        ] {
            assert!(serde_json::from_str::<BrokerRequest>(body).is_err());
        }
        let fixture = Fixture::new();
        let owner = Owner::start(&fixture.0, &fixture.0).unwrap();
        let r = connected(&owner);
        let body = json!({"operation":"credential","registrationId":r.id,"epoch":r.epoch});
        let valid = format!("x-chatgpt-owner: {}\r\n", owner.capability);
        assert!(request(&owner, "", body.clone()).starts_with("HTTP/1.1 403"));
        assert!(request(
            &owner,
            &format!("{valid}Host: foreign.invalid\r\n"),
            body.clone()
        )
        .starts_with("HTTP/1.1 403"));
        assert!(request(
            &owner,
            &format!("{valid}Origin: http://127.0.0.1\r\n"),
            body.clone()
        )
        .starts_with("HTTP/1.1 403"));
        assert!(
            request(&owner, "x-chatgpt-owner: foreign\r\n", body.clone())
                .starts_with("HTTP/1.1 403")
        );
        let accepted = request(&owner, &valid, body.clone());
        assert!(accepted.starts_with("HTTP/1.1 200"));
        assert!(accepted.contains("authored-private-access"));
        assert!(!accepted.contains("authored-private-refresh"));
        let mut stale = body.clone();
        stale["epoch"] = json!(2);
        assert!(request(&owner, &valid, stale).starts_with("HTTP/1.1 409"));
        let mut extra = body;
        extra["url"] = json!("https://foreign.invalid");
        assert!(request(&owner, &valid, extra).starts_with("HTTP/1.1 409"));
        assert!(!owner.disconnect(&r.id, || {}, None).unwrap()); // No helper resources: remote proof unavailable, local clearing still commits.
        let current = request(
            &owner,
            &valid,
            json!({"operation":"current","registrationId":r.id,"epoch":r.epoch}),
        );
        assert!(current.starts_with("HTTP/1.1 409"));
        let store = owner.store.lock().unwrap();
        let saved = &store.document.registrations[0];
        assert!(
            saved.access_token.is_none()
                && saved.refresh_token.is_none()
                && saved.id_token.is_none()
        );
        assert_eq!(saved.client_id, r.client_id);
        assert_eq!(saved.epoch, 2);
    }
    fn shell_quote(value: &str) -> String {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
    fn fake_helper(fixture: &Fixture, result: Value, before: &str) {
        let script = format!(
            "#!/bin/sh\numask 077\n/bin/cat >/dev/null\n{before}\nprintf '%s' {}\n",
            shell_quote(&result.to_string())
        );
        std::fs::write(fixture.0.join("node"), script).unwrap();
        std::fs::set_permissions(
            fixture.0.join("node"),
            std::fs::Permissions::from_mode(0o700),
        )
        .unwrap();
    }
    fn wait_until(mut condition: impl FnMut() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(3);
        while !condition() {
            assert!(
                Instant::now() < deadline,
                "Owned fixture did not reach the bounded condition"
            );
            std::thread::sleep(Duration::from_millis(2));
        }
    }
    #[test]
    fn ui_generation_refuses_queued_and_stale_operations_before_any_helper_launch() {
        let fixture = Fixture::new();
        let owner = Owner::start(&fixture.0, &fixture.0).unwrap();
        let r = connected(&owner);
        let launched = fixture.0.join("launched");
        fake_helper(
            &fixture,
            json!({"ok":true,"result":r}),
            &format!(
                "printf launched > {}",
                shell_quote(launched.to_str().unwrap())
            ),
        );
        let before = crate::private_store::read(&owner.path).unwrap();
        let generation = AtomicU64::new(0);
        let epoch = owner.reserve_sign_in().unwrap();
        generation.store(1, Ordering::SeqCst);
        assert!(cancel_ui_generation(&generation, 0)); // Cancellation can precede the queued worker.
        assert!(owner
            .sign_in(Some(r.id.clone()), false, epoch, Some((&generation, 1)))
            .is_err());
        assert!(!launched.exists());
        assert_eq!(before, crate::private_store::read(&owner.path).unwrap());
        assert!(!cancel_ui_generation(&generation, 0));
        generation.store(3, Ordering::SeqCst);
        assert!(!cancel_ui_generation(&generation, 0)); // Newer reservation is untouched.
        assert_eq!(generation.load(Ordering::SeqCst), 3);
        let stale = Some((&generation, 2));
        assert!(owner.discover_models(&r.id, stale).is_err());
        assert!(owner.disclose(&r.id, stale).is_err());
        assert!(owner
            .disconnect(
                &r.id,
                || panic!("Stale disconnect reached activation"),
                stale
            )
            .is_err());
        assert!(!launched.exists());
        assert_eq!(before, crate::private_store::read(&owner.path).unwrap());
        assert!(!cancel_ui_generation(&generation, u64::MAX));
    }
    #[test]
    fn late_success_cannot_commit_after_cancel_and_owned_child_reaping() {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;
        let fixture = Fixture::new();
        let owner = Owner::start(&fixture.0, &fixture.0).unwrap();
        let r = connected(&owner);
        let before = crate::private_store::read(&owner.path).unwrap();
        let fifo = fixture.0.join("release");
        let name = CString::new(fifo.as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0);
        fake_helper(
            &fixture,
            json!({"ok":true,"result":r}),
            &format!(
                "/bin/cat {} >/dev/null",
                shell_quote(fifo.to_str().unwrap())
            ),
        );
        let worker = owner.clone();
        let id = r.id.clone();
        let epoch = worker.reserve_sign_in().unwrap();
        let thread = std::thread::spawn(move || worker.sign_in(Some(id), false, epoch, None));
        wait_until(|| owner.auth_pid.load(Ordering::SeqCst) > 0);
        let store = owner.store.lock().unwrap();
        std::fs::write(&fifo, b"release authored result").unwrap();
        wait_until(|| owner.auth_pid.load(Ordering::SeqCst) == 0);
        owner.cancel();
        drop(store);
        assert!(thread.join().unwrap().is_err());
        assert_eq!(crate::private_store::read(&owner.path).unwrap(), before);
        assert_eq!(
            owner.store.lock().unwrap().document.registrations[0].epoch,
            1
        );
    }
    #[test]
    fn concurrent_requests_serialize_one_rotating_refresh_and_persist_replacement() {
        let fixture = Fixture::new();
        let owner = Owner::start(&fixture.0, &fixture.0).unwrap();
        let mut r = connected(&owner);
        {
            let mut store = owner.store.lock().unwrap();
            store.document.registrations[0].expires_at = now() - 1;
            store.document.registrations[0].earliest_refresh_at = 0;
            owner.publish(&mut store).unwrap();
        }
        r.access_token = Some("authored-rotated-access".into());
        r.refresh_token = Some("authored-rotated-refresh".into());
        r.expires_at = now() + 3600;
        let counter = fixture.0.join("helper-count");
        fake_helper(
            &fixture,
            json!({"ok":true,"result":r}),
            &format!("printf x >> {}", shell_quote(counter.to_str().unwrap())),
        );
        let a = owner.clone();
        let b = owner.clone();
        let id = r.id.clone();
        let other_id = id.clone();
        let first = std::thread::spawn(move || {
            request(
                &a,
                &format!("x-chatgpt-owner: {}\r\n", a.capability),
                json!({"operation":"credential","registrationId":id,"epoch":1}),
            )
        });
        let second = std::thread::spawn(move || {
            request(
                &b,
                &format!("x-chatgpt-owner: {}\r\n", b.capability),
                json!({"operation":"credential","registrationId":other_id,"epoch":1}),
            )
        });
        for response in [first.join().unwrap(), second.join().unwrap()] {
            assert!(response.starts_with("HTTP/1.1 200"));
            assert!(response.contains("authored-rotated-access"));
            assert!(!response.contains("authored-rotated-refresh"));
        }
        assert_eq!(std::fs::read(counter).unwrap(), b"x");
        let saved = owner.store.lock().unwrap();
        assert_eq!(
            saved.document.registrations[0].refresh_token.as_deref(),
            Some("authored-rotated-refresh")
        );
        assert_eq!(saved.document.registrations[0].epoch, 1);
    }
    #[test]
    fn terminal_refresh_clears_tokens_but_transient_failure_preserves_originals() {
        for terminal in [false, true] {
            let fixture = Fixture::new();
            let owner = Owner::start(&fixture.0, &fixture.0).unwrap();
            let r = connected(&owner);
            {
                let mut store = owner.store.lock().unwrap();
                store.document.registrations[0].expires_at = now() - 1;
                store.document.registrations[0].earliest_refresh_at = 0;
                owner.publish(&mut store).unwrap();
            }
            let before = crate::private_store::read(&owner.path).unwrap();
            fake_helper(
                &fixture,
                json!({"ok":false,"code":if terminal {"reconnect-required"}else{"network"}}),
                "",
            );
            let response = request(
                &owner,
                &format!("x-chatgpt-owner: {}\r\n", owner.capability),
                json!({"operation":"credential","registrationId":r.id,"epoch":1}),
            );
            assert!(response.starts_with("HTTP/1.1 409"));
            let store = owner.store.lock().unwrap();
            let saved = &store.document.registrations[0];
            assert_eq!(saved.client_id, r.client_id);
            if terminal {
                assert!(
                    saved.access_token.is_none()
                        && saved.refresh_token.is_none()
                        && saved.id_token.is_none()
                );
                assert_eq!(saved.state, "reconnect-required");
                assert_eq!(saved.epoch, 2);
            } else {
                assert_eq!(crate::private_store::read(&owner.path).unwrap(), before);
                assert!(saved.access_token.is_some());
                assert_eq!(saved.epoch, 1);
            }
        }
    }
    #[test]
    fn same_byte_file_or_record_parent_replacement_never_transfers_credential_authority() {
        for replace_parent in [false, true] {
            let fixture = Fixture::new();
            let owner = Owner::start(&fixture.0, &fixture.0).unwrap();
            let r = connected(&owner);
            let before = crate::private_store::read(&owner.path).unwrap();
            let launched = fixture.0.join("launched");
            fake_helper(
                &fixture,
                json!({"ok":true,"result":r}),
                &format!(
                    "printf launched > {}",
                    shell_quote(launched.to_str().unwrap())
                ),
            );
            if replace_parent {
                std::fs::rename(
                    owner.path.parent().unwrap(),
                    owner.path.parent().unwrap().with_file_name("prior-records"),
                )
                .unwrap();
                crate::private_store::publish(&owner.path, &before, None).unwrap();
            } else {
                let incoming = owner.path.with_file_name("incoming.json");
                crate::private_store::publish(&incoming, &before, None).unwrap();
                std::fs::rename(incoming, &owner.path).unwrap();
            }
            assert_eq!(owner.metadata()[0]["state"], "unavailable");
            let denied = request(
                &owner,
                &format!("x-chatgpt-owner: {}\r\n", owner.capability),
                json!({"operation":"credential","registrationId":r.id,"epoch":r.epoch}),
            );
            assert!(denied.starts_with("HTTP/1.1 409"));
            assert!(!denied.contains(r.access_token.as_ref().unwrap()));
            assert!(owner.disclose(&r.id, None).is_err());
            let epoch = owner.reserve_sign_in().unwrap();
            assert!(owner.sign_in(Some(r.id), false, epoch, None).is_err());
            assert!(!launched.exists());
            assert_eq!(before, crate::private_store::read(&owner.path).unwrap());
            owner.stop();
        }
    }
    #[test]
    fn failed_publication_restores_prior_memory_without_overwriting_changed_disk() {
        let fixture = Fixture::new();
        let owner = Owner::start(&fixture.0, &fixture.0).unwrap();
        let r = connected(&owner);
        let original = crate::private_store::read(&owner.path).unwrap();
        // Simulate a separate owner changing the pinned document while this form
        // retains its original revision. Refusal must not overwrite either truth.
        let mut changed: Value = serde_json::from_slice(&original).unwrap();
        changed["registrations"][0]["disclosed"] = json!(true);
        let external = serde_json::to_vec(&changed).unwrap();
        crate::private_store::publish(&owner.path, &external, Some(&original)).unwrap();
        let mut store = owner.store.lock().unwrap();
        store.document.registrations[0].email = "changed@example.invalid".into();
        assert!(owner.publish(&mut store).is_err());
        assert_eq!(store.document.registrations[0].email, r.email);
        assert_eq!(store.bytes, original);
        assert_eq!(crate::private_store::read(&owner.path).unwrap(), external);
    }
}
impl Drop for Owner {
    fn drop(&mut self) {
        self.stop();
    }
}
