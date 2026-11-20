import test from "node:test";
import assert from "node:assert/strict";
import { originalExportFormat } from "./export-format.js";

test("export defaults to the original image's supported format", () => {
  assert.equal(originalExportFormat({ type: "image/jpeg", name: "photo" }), "jpeg");
  assert.equal(originalExportFormat({ type: "image/png", name: "photo.jpg" }), "png");
  assert.equal(originalExportFormat({ type: "", name: "photo.JPG" }), "jpeg");
  assert.equal(originalExportFormat({ name: "photo.jpeg" }), "jpeg");
  for (const type of ["image/webp", "image/avif", "image/svg+xml"]) {
    assert.equal(originalExportFormat({ type, name: "image" }), "png");
  }
});
