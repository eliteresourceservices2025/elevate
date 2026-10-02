// Test-only: lets the ELEVATE integration tests (which run against the same database) build and inspect pictures without ELEVATE
// itself depending on the image library.
export { default as sharp } from "sharp";
