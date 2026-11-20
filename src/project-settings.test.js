import test from "node:test";
import assert from "node:assert/strict";
import { findMatchingProject, screenshotSettings } from "./project-settings.js";

test("matching uses the most recent case-insensitive mockup filename", () => {
  const projects = [{ mockup: { name: "Phone.JPG" } }, { mockup: { name: "phone.jpg" } }];
  assert.equal(findMatchingProject(projects, "PHONE.jpg"), projects[0]);
  assert.equal(findMatchingProject(projects, "other.jpg"), undefined);
});

test("older projects use neutral color settings and retain their original placement", () => {
  const project = { corners: [{ x: 0.1, y: 0.2 }], radius: 5, opacity: 0.5, blend: "screen" };
  const result = screenshotSettings(project);
  assert.deepEqual(result, { corners: [{ x: 0.1, y: 0.2 }], radius: 5, opacity: 0.5, blend: "screen", warmth: 0, tint: 0, overlayColor: "#ffffff", overlayOpacity: 0, overlayBlend: "source-over" });
  result.corners[0].x = 0.7;
  assert.equal(project.corners[0].x, 0.1);
  assert.equal(screenshotSettings({ ...project, warmth: -25, overlayOpacity: 35 }).overlayOpacity, 35);
});
