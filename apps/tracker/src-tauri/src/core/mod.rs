//! The pure rules of the app: no I/O, no clock reads, no randomness except a seed. Everything here is unit-tested.
pub mod app_name;
pub mod backoff;
pub mod schedule;
pub mod segments;
pub mod timefmt;
pub mod version;
