//! Turns the pictures of every monitor into one small blurred JPEG. This is the only way a screenshot leaves this module:
//! `capture_blurred` returns a `BlurredJpeg`, and nothing here ever writes a raw capture anywhere.
//!
//! The aim (the owner's): a lead can tell what kind of screen it is (browser, spreadsheet, chat) and read large headings, but ordinary
//! body text is unreadable. The strength is the one constant `BLUR_SIGMA`; it was set by looking at real captures (see
//! docs/modules/activity-tracker.md), because a synthetic test pattern alone proved too forgiving.

use crate::platform::{CaptureError, MonitorShot, Platform};

/// Gaussian blur strength, in pixels of the final (already scaled down) picture. Chosen by looking at real captures on 2026-11-20: from 2.5
/// to 6 ordinary chat text was still readable; at 8 body text is a smudge while the layout (windows, panels, the taskbar) and large
/// headings stay.
pub const BLUR_SIGMA: f32 = 8.0;
/// The widest the finished picture gets. Wider desktops are scaled down; a narrower one is never scaled up.
pub const MAX_WIDTH: u32 = 1600;
/// The server accepts at most 300 KB.
pub const MAX_BYTES: usize = 300 * 1024;
/// JPEG quality steps tried in order until the picture fits.
const QUALITIES: [u8; 6] = [60, 55, 50, 45, 40, 35];
/// No desktop is this big; it guards memory against a bad answer from the system.
const MAX_CANVAS_SIDE: u32 = 16_384;

#[derive(Debug, PartialEq, Eq)]
pub enum BlurError {
    NoMonitors,
    /// A zero-sized canvas or monitor.
    Empty,
    TooLarge,
    /// A monitor's bytes do not match its size.
    BadShot,
    /// Even the lowest quality is over the limit.
    TooBig(usize),
    Encode(String),
    Capture(String),
}

impl std::fmt::Display for BlurError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BlurError::NoMonitors => write!(f, "no monitors"),
            BlurError::Empty => write!(f, "the picture is empty"),
            BlurError::TooLarge => write!(f, "the desktop is too large"),
            BlurError::BadShot => write!(f, "a monitor picture has the wrong size"),
            BlurError::TooBig(n) => write!(f, "the picture is still {n} bytes at the lowest quality"),
            BlurError::Encode(why) => write!(f, "could not encode: {why}"),
            BlurError::Capture(why) => write!(f, "{why}"),
        }
    }
}

impl std::error::Error for BlurError {}

impl From<CaptureError> for BlurError {
    fn from(e: CaptureError) -> Self {
        match e {
            CaptureError::NoMonitors => BlurError::NoMonitors,
            CaptureError::Failed(why) => BlurError::Capture(why),
        }
    }
}

/// A finished, blurred JPEG. The only kind of screenshot this app can hold.
pub struct BlurredJpeg(Vec<u8>);

impl BlurredJpeg {
    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }
    pub fn into_bytes(self) -> Vec<u8> {
        self.0
    }
    pub fn len(&self) -> usize {
        self.0.len()
    }
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

/// All monitors laid out as on the desktop, not yet blurred. Never leaves this module.
pub struct RawCanvas {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
}

/// Places the monitors on one canvas by their desktop positions (the top-left of everything is the canvas origin); black where no monitor is.
pub fn compose(shots: Vec<MonitorShot>) -> Result<RawCanvas, BlurError> {
    if shots.is_empty() {
        return Err(BlurError::NoMonitors);
    }
    for s in &shots {
        if s.width == 0 || s.height == 0 {
            return Err(BlurError::Empty);
        }
        if s.rgba.len() as u64 != u64::from(s.width) * u64::from(s.height) * 4 {
            return Err(BlurError::BadShot);
        }
    }
    let min_x = shots.iter().map(|s| i64::from(s.x)).min().unwrap_or(0);
    let min_y = shots.iter().map(|s| i64::from(s.y)).min().unwrap_or(0);
    let max_x = shots.iter().map(|s| i64::from(s.x) + i64::from(s.width)).max().unwrap_or(0);
    let max_y = shots.iter().map(|s| i64::from(s.y) + i64::from(s.height)).max().unwrap_or(0);
    let (width, height) = ((max_x - min_x) as u64, (max_y - min_y) as u64);
    if width > u64::from(MAX_CANVAS_SIDE) || height > u64::from(MAX_CANVAS_SIDE) {
        return Err(BlurError::TooLarge);
    }
    let (width, height) = (width as u32, height as u32);
    let mut rgba = vec![0u8; width as usize * height as usize * 4];
    for px in rgba.chunks_exact_mut(4) {
        px[3] = 255; // black, opaque, where no monitor is
    }
    for s in &shots {
        let (dx, dy) = ((i64::from(s.x) - min_x) as usize, (i64::from(s.y) - min_y) as usize);
        let row_bytes = s.width as usize * 4;
        for row in 0..s.height as usize {
            let to = ((dy + row) * width as usize + dx) * 4;
            let from = row * row_bytes;
            rgba[to..to + row_bytes].copy_from_slice(&s.rgba[from..from + row_bytes]);
        }
    }
    Ok(RawCanvas { width, height, rgba })
}

fn shrink(img: image::RgbaImage) -> image::RgbaImage {
    if img.width() <= MAX_WIDTH {
        return img;
    }
    let height = ((u64::from(img.height()) * u64::from(MAX_WIDTH) + u64::from(img.width()) / 2) / u64::from(img.width())).max(1) as u32;
    image::imageops::resize(&img, MAX_WIDTH, height, image::imageops::FilterType::Triangle)
}

fn to_image(canvas: RawCanvas) -> Result<image::RgbaImage, BlurError> {
    if canvas.width == 0 || canvas.height == 0 {
        return Err(BlurError::Empty);
    }
    image::RgbaImage::from_raw(canvas.width, canvas.height, canvas.rgba).ok_or(BlurError::BadShot)
}

/// The canvas scaled down uniformly to at most `MAX_WIDTH` wide (never up), not blurred.
#[cfg(test)]
pub(crate) fn scale_down(canvas: &RawCanvas) -> Result<image::RgbaImage, BlurError> {
    let copy = RawCanvas { width: canvas.width, height: canvas.height, rgba: canvas.rgba.clone() };
    Ok(shrink(to_image(copy)?))
}

/// Scale, blur with `BLUR_SIGMA`, and encode as JPEG (quality 60, lowered in steps to 35 until it is at most 300 KB).
pub fn blur_and_encode(canvas: RawCanvas) -> Result<BlurredJpeg, BlurError> {
    blur_and_encode_with(canvas, BLUR_SIGMA)
}

/// Like `blur_and_encode` with a chosen strength (used to compare strengths on a real capture).
pub fn blur_and_encode_with(canvas: RawCanvas, sigma: f32) -> Result<BlurredJpeg, BlurError> {
    let small = shrink(to_image(canvas)?);
    let blurred = image::imageops::blur(&small, sigma);
    let rgb = image::DynamicImage::ImageRgba8(blurred).to_rgb8();
    let mut last = 0;
    for quality in QUALITIES {
        let mut bytes = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, quality)
            .encode_image(&rgb)
            .map_err(|e| BlurError::Encode(e.to_string()))?;
        if bytes.len() <= MAX_BYTES {
            return Ok(BlurredJpeg(bytes));
        }
        last = bytes.len();
    }
    Err(BlurError::TooBig(last))
}

/// The only public way to get a screenshot: every monitor, composed, blurred, encoded.
pub fn capture_blurred(p: &dyn Platform) -> Result<BlurredJpeg, BlurError> {
    blur_and_encode(compose(p.capture_all_monitors()?)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, ImageFormat};

    fn shot(x: i32, y: i32, w: u32, h: u32, rgba: [u8; 4]) -> MonitorShot {
        let mut bytes = Vec::with_capacity((w * h * 4) as usize);
        for _ in 0..(w * h) {
            bytes.extend_from_slice(&rgba);
        }
        MonitorShot { x, y, width: w, height: h, rgba: bytes }
    }

    fn canvas_from(img: &image::RgbaImage) -> RawCanvas {
        RawCanvas { width: img.width(), height: img.height(), rgba: img.as_raw().clone() }
    }

    fn px(c: &RawCanvas, x: u32, y: u32) -> [u8; 4] {
        let i = ((y * c.width + x) * 4) as usize;
        [c.rgba[i], c.rgba[i + 1], c.rgba[i + 2], c.rgba[i + 3]]
    }

    /// Sum of the absolute differences between neighbouring pixels (horizontal and vertical): how much detail there is.
    fn edge_energy(img: &image::GrayImage) -> f64 {
        let (w, h) = img.dimensions();
        let mut sum = 0f64;
        for y in 0..h {
            for x in 0..w {
                let p = img.get_pixel(x, y).0[0] as f64;
                if x + 1 < w {
                    sum += (p - img.get_pixel(x + 1, y).0[0] as f64).abs();
                }
                if y + 1 < h {
                    sum += (p - img.get_pixel(x, y + 1).0[0] as f64).abs();
                }
            }
        }
        sum
    }

    fn decode(jpeg: &BlurredJpeg) -> image::GrayImage {
        image::load_from_memory_with_format(jpeg.as_bytes(), ImageFormat::Jpeg).expect("a valid jpeg").to_luma8()
    }

    /// White page with text-like blocks: 1 px dark vertical strokes every 4 px, in blocks 200 px wide and 12 px tall.
    fn thin_text_page() -> image::RgbaImage {
        let mut img = image::RgbaImage::from_pixel(1920, 1080, image::Rgba([255, 255, 255, 255]));
        for block_y in (40..1040).step_by(30) {
            for block_x in (60..1700).step_by(240) {
                for x in (block_x..block_x + 200).step_by(4) {
                    for y in block_y..block_y + 12 {
                        img.put_pixel(x, y, image::Rgba([20, 20, 20, 255]));
                    }
                }
            }
        }
        img
    }

    /// White page with large heading-like bars: 24 px thick dark horizontal bars, 200 px wide.
    fn wide_bar_page() -> image::RgbaImage {
        let mut img = image::RgbaImage::from_pixel(1920, 1080, image::Rgba([255, 255, 255, 255]));
        for bar_y in (40..1040).step_by(80) {
            for bar_x in (60..1800).step_by(300) {
                for y in bar_y..bar_y + 24 {
                    for x in bar_x..bar_x + 200 {
                        img.put_pixel(x, y, image::Rgba([20, 20, 20, 255]));
                    }
                }
            }
        }
        img
    }

    #[test]
    fn two_monitors_side_by_side_make_one_wide_canvas() {
        let c = compose(vec![shot(0, 0, 1920, 1080, [255, 0, 0, 255]), shot(1920, 0, 1920, 1080, [0, 255, 0, 255])]).unwrap();
        assert_eq!((c.width, c.height), (3840, 1080));
        assert_eq!(px(&c, 100, 100), [255, 0, 0, 255]);
        assert_eq!(px(&c, 2000, 100), [0, 255, 0, 255]);
    }

    #[test]
    fn a_monitor_above_and_one_to_the_left_keep_their_places() {
        // Main at (0,0); another above it (y = -1080) and another to its left (x = -1280).
        let c = compose(vec![shot(0, 0, 1920, 1080, [10, 10, 10, 255]), shot(0, -1080, 1920, 1080, [200, 0, 0, 255]), shot(-1280, 0, 1280, 1024, [0, 0, 200, 255])]).unwrap();
        assert_eq!((c.width, c.height), (3200, 2160));
        assert_eq!(px(&c, 1280 + 10, 10), [200, 0, 0, 255]); // the one above, over the main
        assert_eq!(px(&c, 1280 + 10, 1080 + 10), [10, 10, 10, 255]); // main
        assert_eq!(px(&c, 10, 1080 + 10), [0, 0, 200, 255]); // the one on the left, beside the main
    }

    #[test]
    fn a_gap_between_monitors_is_black() {
        let c = compose(vec![shot(0, 0, 100, 100, [255, 255, 255, 255]), shot(150, 0, 100, 100, [255, 255, 255, 255])]).unwrap();
        assert_eq!(c.width, 250);
        assert_eq!(px(&c, 125, 50), [0, 0, 0, 255]);
        assert_eq!(px(&c, 50, 50), [255, 255, 255, 255]);
    }

    #[test]
    fn no_monitors_or_a_broken_monitor_is_an_error() {
        assert_eq!(compose(vec![]).err(), Some(BlurError::NoMonitors));
        let mut bad = shot(0, 0, 10, 10, [0, 0, 0, 255]);
        bad.rgba.truncate(5);
        assert_eq!(compose(vec![bad]).err(), Some(BlurError::BadShot));
        assert_eq!(compose(vec![shot(0, 0, 0, 10, [0, 0, 0, 255])]).err(), Some(BlurError::Empty));
        assert_eq!(compose(vec![shot(0, 0, 20_000, 1, [0, 0, 0, 255])]).err(), Some(BlurError::TooLarge));
    }

    #[test]
    fn the_result_is_a_jpeg_at_most_1600_wide_and_under_300_kb() {
        let jpeg = blur_and_encode(canvas_from(&thin_text_page())).unwrap();
        assert_eq!(&jpeg.as_bytes()[..3], &[0xFF, 0xD8, 0xFF]);
        assert!(jpeg.len() <= MAX_BYTES, "{} bytes", jpeg.len());
        let img = image::load_from_memory_with_format(jpeg.as_bytes(), ImageFormat::Jpeg).unwrap();
        assert!(img.width() <= MAX_WIDTH);
        assert_eq!(img.width(), 1600);
        assert_eq!(img.height(), 900); // the same shape as the desktop
    }

    #[test]
    fn a_smaller_picture_is_never_scaled_up() {
        let img = image::RgbaImage::from_pixel(800, 600, image::Rgba([120, 120, 120, 255]));
        let jpeg = blur_and_encode(canvas_from(&img)).unwrap();
        let out = image::load_from_memory_with_format(jpeg.as_bytes(), ImageFormat::Jpeg).unwrap();
        assert_eq!((out.width(), out.height()), (800, 600));
    }

    #[test]
    fn body_text_is_unreadable_after_the_blur() {
        let page = thin_text_page();
        let canvas = canvas_from(&page);
        let before = edge_energy(&DynamicImage::ImageRgba8(scale_down(&canvas).unwrap()).to_luma8());
        let after = edge_energy(&decode(&blur_and_encode(canvas).unwrap()));
        assert!(after < before * 0.15, "after {after} should be under 15% of {before}");
    }


    /// White page with body-sized text: dark stems 7 px wide every 14 px (about the size of a 14 px font), in 14 px tall lines. The first
    /// version of this check used 1 px strokes 4 px apart, which no real text looks like; a real capture at the old strength was still readable.
    fn body_text_page() -> image::RgbaImage {
        let mut img = image::RgbaImage::from_pixel(1920, 1080, image::Rgba([255, 255, 255, 255]));
        for line_y in (40..1040).step_by(26) {
            for block_x in (60..1700).step_by(240) {
                for x in (block_x..block_x + 200).step_by(14) {
                    for y in line_y..line_y + 14 {
                        for dx in 0..7 {
                            img.put_pixel(x + dx, y, image::Rgba([20, 20, 20, 255]));
                        }
                    }
                }
            }
        }
        img
    }

    #[test]
    fn body_sized_text_comes_out_almost_flat() {
        let page = body_text_page();
        let canvas = canvas_from(&page);
        let before = edge_energy(&DynamicImage::ImageRgba8(scale_down(&canvas).unwrap()).to_luma8());
        let after = edge_energy(&decode(&blur_and_encode(canvas).unwrap()));
        // Measured on this pattern: strength 2.5 keeps 67%, 4.5 keeps 25%, 6 keeps 12% (still partly readable on a real capture), 8 keeps 5.7%
        // (unreadable on a real capture). The line is between 6 and 8.
        assert!(after < before * 0.08, "body-sized text keeps {:.1}% of its detail, it must keep under 8%", 100.0 * after / before);
    }

    #[test]
    fn large_headings_survive_so_the_blur_is_not_too_strong() {
        let page = wide_bar_page();
        let canvas = canvas_from(&page);
        let before = edge_energy(&DynamicImage::ImageRgba8(scale_down(&canvas).unwrap()).to_luma8());
        let after = edge_energy(&decode(&blur_and_encode(canvas).unwrap()));
        assert!(after > before * 0.5, "after {after} should keep at least 50% of {before}");
    }

    #[test]
    fn a_flat_colour_keeps_its_colour() {
        let img = image::RgbaImage::from_pixel(640, 480, image::Rgba([40, 120, 200, 255]));
        let out = decode_rgb(&blur_and_encode(canvas_from(&img)).unwrap());
        let p = out.get_pixel(320, 240).0;
        assert!((p[0] as i32 - 40).abs() <= 6 && (p[1] as i32 - 120).abs() <= 6 && (p[2] as i32 - 200).abs() <= 6, "{p:?}");
    }

    fn decode_rgb(jpeg: &BlurredJpeg) -> image::RgbImage {
        image::load_from_memory_with_format(jpeg.as_bytes(), ImageFormat::Jpeg).unwrap().to_rgb8()
    }

    #[test]
    fn an_empty_canvas_is_an_error_not_a_panic() {
        let c = RawCanvas { width: 0, height: 0, rgba: vec![] };
        assert_eq!(blur_and_encode(c).err(), Some(BlurError::Empty));
    }

    #[test]
    fn a_noisy_double_wide_desktop_still_fits_in_300_kb() {
        let mut state = 0x9E37_79B9_7F4A_7C15u64;
        let mut img = image::RgbaImage::new(3840, 1080);
        for p in img.pixels_mut() {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            *p = image::Rgba([state as u8, (state >> 8) as u8, (state >> 16) as u8, 255]);
        }
        let jpeg = blur_and_encode(canvas_from(&img)).unwrap();
        assert!(jpeg.len() <= MAX_BYTES, "{} bytes", jpeg.len());
    }

    struct FakePlatform(Vec<(i32, i32, u32, u32)>);
    impl Platform for FakePlatform {
        fn foreground_app(&self) -> Option<String> {
            None
        }
        fn idle_seconds(&self) -> u32 {
            0
        }
        fn capture_all_monitors(&self) -> Result<Vec<MonitorShot>, CaptureError> {
            if self.0.is_empty() {
                return Err(CaptureError::NoMonitors);
            }
            Ok(self.0.iter().map(|&(x, y, w, h)| shot(x, y, w, h, [90, 90, 90, 255])).collect())
        }
    }

    #[test]
    fn capture_blurred_gives_only_a_blurred_jpeg_and_passes_failures_on() {
        let jpeg = capture_blurred(&FakePlatform(vec![(0, 0, 1920, 1080), (1920, 0, 1920, 1080)])).unwrap();
        assert_eq!(&jpeg.as_bytes()[..3], &[0xFF, 0xD8, 0xFF]);
        assert_eq!(capture_blurred(&FakePlatform(vec![])).err(), Some(BlurError::NoMonitors));
    }
}
