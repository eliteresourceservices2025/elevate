//! The SQLite queue itself.
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use rusqlite::{params, Connection};

use super::{QueueError, QueuedShot, MAX_BATCH, MAX_SHOTS, SEGMENT_MAX_AGE_MS};
use crate::capture::blur::BlurredJpeg;
use crate::core::segments::{Segment, State};

fn err<E: std::fmt::Display>(e: E) -> QueueError {
    QueueError(e.to_string())
}

pub struct Queue {
    dir: PathBuf,
    conn: Mutex<Connection>,
}

impl Queue {
    /// Opens (or creates) the queue in `dir`: `queue.db` and a `shots` folder.
    pub fn open(dir: &Path) -> Result<Queue, QueueError> {
        fs::create_dir_all(dir.join("shots")).map_err(err)?;
        let conn = Connection::open(dir.join("queue.db")).map_err(err)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             CREATE TABLE IF NOT EXISTS segments (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL,
               app TEXT NOT NULL, state TEXT NOT NULL);
             CREATE INDEX IF NOT EXISTS segments_start ON segments (start_ms, id);
             CREATE TABLE IF NOT EXISTS shots (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               file TEXT NOT NULL, taken_at_ms INTEGER NOT NULL,
               attempts INTEGER NOT NULL DEFAULT 0);",
        )
        .map_err(err)?;
        Ok(Queue { dir: dir.to_path_buf(), conn: Mutex::new(conn) })
    }

    fn lock(&self) -> Result<MutexGuard<'_, Connection>, QueueError> {
        self.conn.lock().map_err(|_| QueueError("the queue is unavailable".into()))
    }

    fn shot_path(&self, file: &str) -> PathBuf {
        self.dir.join("shots").join(file)
    }

    pub fn push_segments(&self, segments: &[Segment]) -> Result<(), QueueError> {
        if segments.is_empty() {
            return Ok(());
        }
        let mut conn = self.lock()?;
        let tx = conn.transaction().map_err(err)?;
        {
            let mut insert = tx.prepare("INSERT INTO segments (start_ms, end_ms, app, state) VALUES (?1, ?2, ?3, ?4)").map_err(err)?;
            for s in segments {
                let state = match s.state {
                    State::Active => "active",
                    State::Idle => "idle",
                };
                insert.execute(params![s.start_ms, s.end_ms, s.app, state]).map_err(err)?;
            }
        }
        tx.commit().map_err(err)
    }

    /// Oldest first, at most `max` (and never more than 200).
    pub fn next_batch(&self, max: usize) -> Result<Vec<(i64, Segment)>, QueueError> {
        let conn = self.lock()?;
        let mut q = conn.prepare("SELECT id, start_ms, end_ms, app, state FROM segments ORDER BY start_ms, id LIMIT ?1").map_err(err)?;
        let rows = q
            .query_map([max.min(MAX_BATCH) as i64], |r| {
                let state: String = r.get(4)?;
                Ok((
                    r.get::<_, i64>(0)?,
                    Segment { start_ms: r.get(1)?, end_ms: r.get(2)?, app: r.get(3)?, state: if state == "idle" { State::Idle } else { State::Active } },
                ))
            })
            .map_err(err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(err)
    }

    pub fn ack(&self, ids: &[i64]) -> Result<(), QueueError> {
        if ids.is_empty() {
            return Ok(());
        }
        let mut conn = self.lock()?;
        let tx = conn.transaction().map_err(err)?;
        for id in ids {
            tx.execute("DELETE FROM segments WHERE id = ?1", [id]).map_err(err)?;
        }
        tx.commit().map_err(err)
    }

    /// Stores the finished (already blurred) picture as a file named by a counter, never by its content.
    pub fn push_shot(&self, jpeg: BlurredJpeg, taken_at_ms: i64) -> Result<(), QueueError> {
        let conn = self.lock()?;
        conn.execute("INSERT INTO shots (file, taken_at_ms) VALUES ('', ?1)", [taken_at_ms]).map_err(err)?;
        let id = conn.last_insert_rowid();
        let file = format!("{id:08}.jpg");
        if let Err(e) = fs::write(self.shot_path(&file), jpeg.as_bytes()) {
            let _ = conn.execute("DELETE FROM shots WHERE id = ?1", [id]);
            return Err(err(e));
        }
        conn.execute("UPDATE shots SET file = ?1 WHERE id = ?2", params![file, id]).map_err(err)?;
        Ok(())
    }

    pub fn next_shot(&self) -> Result<Option<QueuedShot>, QueueError> {
        let conn = self.lock()?;
        let mut q = conn.prepare("SELECT id, file, taken_at_ms, attempts FROM shots WHERE file <> '' ORDER BY taken_at_ms, id LIMIT 1").map_err(err)?;
        let mut rows = q.query([]).map_err(err)?;
        match rows.next().map_err(err)? {
            Some(r) => {
                let file: String = r.get(1).map_err(err)?;
                Ok(Some(QueuedShot { id: r.get(0).map_err(err)?, path: self.shot_path(&file), taken_at_ms: r.get(2).map_err(err)?, attempts: r.get::<_, i64>(3).map_err(err)? as u32 }))
            }
            None => Ok(None),
        }
    }

    /// A failed try: counts it so a picture that never goes through is eventually dropped.
    pub fn shot_failed(&self, id: i64) -> Result<u32, QueueError> {
        let conn = self.lock()?;
        conn.execute("UPDATE shots SET attempts = attempts + 1 WHERE id = ?1", [id]).map_err(err)?;
        let n: i64 = conn.query_row("SELECT attempts FROM shots WHERE id = ?1", [id], |r| r.get(0)).map_err(err)?;
        Ok(n as u32)
    }

    /// Removes the row and its file.
    pub fn ack_shot(&self, id: i64) -> Result<(), QueueError> {
        let conn = self.lock()?;
        let file: Option<String> = conn.query_row("SELECT file FROM shots WHERE id = ?1", [id], |r| r.get(0)).ok();
        conn.execute("DELETE FROM shots WHERE id = ?1", [id]).map_err(err)?;
        if let Some(file) = file.filter(|f| !f.is_empty()) {
            let _ = fs::remove_file(self.shot_path(&file));
        }
        Ok(())
    }

    /// (segments, shots) waiting.
    pub fn len(&self) -> Result<(usize, usize), QueueError> {
        let conn = self.lock()?;
        let segments: i64 = conn.query_row("SELECT COUNT(*) FROM segments", [], |r| r.get(0)).map_err(err)?;
        let shots: i64 = conn.query_row("SELECT COUNT(*) FROM shots WHERE file <> ''", [], |r| r.get(0)).map_err(err)?;
        Ok((segments as usize, shots as usize))
    }

    /// Drops segments older than 24 hours and all but the newest 20 screenshots (deleting their files).
    pub fn enforce_caps(&self, now_ms: i64) -> Result<(), QueueError> {
        let conn = self.lock()?;
        conn.execute("DELETE FROM segments WHERE end_ms < ?1", [now_ms - SEGMENT_MAX_AGE_MS]).map_err(err)?;
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM shots", [], |r| r.get(0)).map_err(err)?;
        let extra = count - MAX_SHOTS as i64;
        if extra > 0 {
            let doomed: Vec<(i64, String)> = {
                let mut q = conn.prepare("SELECT id, file FROM shots ORDER BY taken_at_ms, id LIMIT ?1").map_err(err)?;
                let rows = q.query_map([extra], |r| Ok((r.get(0)?, r.get(1)?))).map_err(err)?;
                rows.collect::<Result<Vec<_>, _>>().map_err(err)?
            };
            for (id, file) in doomed {
                conn.execute("DELETE FROM shots WHERE id = ?1", [id]).map_err(err)?;
                if !file.is_empty() {
                    let _ = fs::remove_file(self.shot_path(&file));
                }
            }
        }
        Ok(())
    }
}
