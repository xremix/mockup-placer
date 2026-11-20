export function originalExportFormat({ type, name }) {
  if (type) return type.toLowerCase() === "image/jpeg" ? "jpeg" : "png";
  return /\.jpe?g$/i.test(name) ? "jpeg" : "png";
}
