//! What is waiting to be sent: finished activity segments and blurred screenshots, kept on disk so a closed lid, a lost connection
//! or a crash loses nothing. The database holds app names and times (that is the point) and nothing else; blurred pictures are files
//! under `shots/` named by a counter, never by what is in them.

pub mod sender;
mod store;

pub use store::Queue;

use std::path::PathBuf;

/// Segments older than this are dropped: the server refuses time that old anyway.
pub const SEGMENT_MAX_AGE_MS: i64 = 24 * 3_600_000;
/// At most this many waiting screenshots; the oldest go first.
pub const MAX_SHOTS: usize = 20;
/// The server takes at most 200 segments per batch.
pub const MAX_BATCH: usize = 200;

#[derive(Debug)]
pub struct QueueError(pub String);

impl std::fmt::Display for QueueError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "queue error: {}", self.0)
    }
}

impl std::error::Error for QueueError {}

/// A blurred screenshot waiting to be sent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueuedShot {
    pub id: i64,
    pub path: PathBuf,
    pub taken_at_ms: i64,
    /// How many times sending it has failed.
    pub attempts: u32,
}

