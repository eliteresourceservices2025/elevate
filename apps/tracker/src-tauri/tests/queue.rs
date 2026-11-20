//! The on-disk queue: order, batches, acknowledging, surviving a restart, and the caps.
mod common;

use common::{jpeg, seg};
use elevate_tracker_lib::queue::{Queue, MAX_SHOTS, SEGMENT_MAX_AGE_MS};

const NOW: i64 = 1_700_000_000_000;

fn files_in(dir: &std::path::Path) -> usize {
    std::fs::read_dir(dir.join("shots")).map(|d| d.count()).unwrap_or(0)
}

#[test]
fn segments_come_back_oldest_first_in_batches_of_at_most_200() {
    let dir = tempfile::tempdir().unwrap();
    let q = Queue::open(dir.path()).unwrap();
    // 450 segments pushed newest first: the queue must still hand them out oldest first.
    let all: Vec<_> = (0..450).rev().map(|i| seg(NOW - i * 60_000, 30_000, "chrome")).collect();
    q.push_segments(&all).unwrap();
    assert_eq!(q.len().unwrap(), (450, 0));

    let mut seen = Vec::new();
    loop {
        let batch = q.next_batch(1000).unwrap();
        if batch.is_empty() {
            break;
        }
        assert!(batch.len() <= 200, "a batch never exceeds 200");
        seen.extend(batch.iter().map(|(_, s)| s.start_ms));
        q.ack(&batch.iter().map(|(id, _)| *id).collect::<Vec<_>>()).unwrap();
    }
    assert_eq!(seen.len(), 450);
    assert!(seen.windows(2).all(|w| w[0] <= w[1]), "oldest first across batches");
    assert_eq!(q.len().unwrap().0, 0);
}

#[test]
fn ack_removes_only_the_acknowledged_rows() {
    let dir = tempfile::tempdir().unwrap();
    let q = Queue::open(dir.path()).unwrap();
    q.push_segments(&[seg(NOW, 1000, "a"), seg(NOW + 1000, 1000, "b"), seg(NOW + 2000, 1000, "c")]).unwrap();
    let batch = q.next_batch(10).unwrap();
    q.ack(&[batch[0].0, batch[2].0]).unwrap();
    let left = q.next_batch(10).unwrap();
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].1.app, "b");
}

#[test]
fn rows_survive_closing_and_reopening() {
    let dir = tempfile::tempdir().unwrap();
    {
        let q = Queue::open(dir.path()).unwrap();
        q.push_segments(&[seg(NOW, 5000, "chrome")]).unwrap();
        q.push_shot(jpeg(), NOW).unwrap();
    }
    let q = Queue::open(dir.path()).unwrap();
    assert_eq!(q.len().unwrap(), (1, 1));
    assert_eq!(q.next_batch(10).unwrap()[0].1.app, "chrome");
    assert!(q.next_shot().unwrap().is_some());
}

#[test]
fn a_shot_is_a_file_that_is_removed_with_its_row_and_never_named_after_its_content() {
    let dir = tempfile::tempdir().unwrap();
    let q = Queue::open(dir.path()).unwrap();
    q.push_shot(jpeg(), NOW).unwrap();
    let shot = q.next_shot().unwrap().unwrap();
    assert!(shot.path.exists());
    assert_eq!(&std::fs::read(&shot.path).unwrap()[..3], &[0xFF, 0xD8, 0xFF]);
    assert_eq!(shot.taken_at_ms, NOW);
    assert_eq!(shot.attempts, 0);
    q.ack_shot(shot.id).unwrap();
    assert!(!shot.path.exists());
    assert_eq!(q.len().unwrap().1, 0);
    assert!(q.next_shot().unwrap().is_none());
}

#[test]
fn a_failed_try_is_counted() {
    let dir = tempfile::tempdir().unwrap();
    let q = Queue::open(dir.path()).unwrap();
    q.push_shot(jpeg(), NOW).unwrap();
    let id = q.next_shot().unwrap().unwrap().id;
    assert_eq!(q.shot_failed(id).unwrap(), 1);
    assert_eq!(q.shot_failed(id).unwrap(), 2);
    assert_eq!(q.next_shot().unwrap().unwrap().attempts, 2);
}

#[test]
fn caps_drop_day_old_segments_and_the_oldest_shots_with_their_files() {
    let dir = tempfile::tempdir().unwrap();
    let q = Queue::open(dir.path()).unwrap();
    q.push_segments(&[seg(NOW - SEGMENT_MAX_AGE_MS - 1000, 1000, "old"), seg(NOW - 1000, 1000, "fresh")]).unwrap();
    for i in 0..(MAX_SHOTS as i64 + 1) {
        q.push_shot(jpeg(), NOW - 10_000_000 + i * 1000).unwrap();
    }
    assert_eq!(files_in(dir.path()), MAX_SHOTS + 1);

    q.enforce_caps(NOW).unwrap();

    let batch = q.next_batch(10).unwrap();
    assert_eq!(batch.len(), 1);
    assert_eq!(batch[0].1.app, "fresh");
    assert_eq!(q.len().unwrap().1, MAX_SHOTS);
    assert_eq!(files_in(dir.path()), MAX_SHOTS, "the dropped shot's file is deleted too");
    // The oldest was the one dropped: the first one waiting now is the second that was pushed.
    assert_eq!(q.next_shot().unwrap().unwrap().taken_at_ms, NOW - 10_000_000 + 1000);
}

#[test]
fn nothing_waiting_is_fine() {
    let dir = tempfile::tempdir().unwrap();
    let q = Queue::open(dir.path()).unwrap();
    q.push_segments(&[]).unwrap();
    q.ack(&[]).unwrap();
    q.enforce_caps(NOW).unwrap();
    assert!(q.next_batch(10).unwrap().is_empty());
    assert_eq!(q.len().unwrap(), (0, 0));
}
