export const colorDefaults = Object.freeze({ warmth: 0, tint: 0, overlayColor: "#ffffff", overlayOpacity: 0, overlayBlend: "source-over" });

export function findMatchingProject(projects, filename) {
  const name = filename.toLowerCase();
  return projects.find(project => project.mockup.name.toLowerCase() === name);
}

export function screenshotSettings(project) {
  return {
    corners: project.corners.map(point => ({ ...point })),
    radius: project.radius,
    opacity: project.opacity,
    blend: project.blend,
    ...Object.fromEntries(Object.entries(colorDefaults).map(([key, fallback]) => [key, project[key] ?? fallback])),
  };
}
