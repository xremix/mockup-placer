# Mockup Placer

A frontend-only mockup placer. Drop a background image and an app screenshot, position the screenshot with four perspective corner handles, and export a full-resolution PNG or JPG. Images are processed locally and never uploaded.

## Run

Requires Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev
```

`npm run build` creates the static site in `dist`. `npm run preview` serves that build. `npm test` runs the geometry tests.

## Deployment

The GitHub Actions workflow tests and builds the site on every push to `main`, then publishes it to GitHub Pages. In repository settings, set the Pages source to **GitHub Actions**. The build automatically uses the Pages base path, so it works for both project sites and custom domains. To build locally for a project subdirectory, use `npm run build -- --base=/repository-name/`.

## Using the editor

- Click either source card to load or replace its image. Drop a file on a specific card to select its role explicitly. Replacing just the screenshot preserves the fitted perspective.
- Drop two images on the preview together. Screenshot/mockup filenames and portrait/landscape dimensions help assign the roles; otherwise the first file is the mockup and the second is the screenshot.
- Paste an image with Ctrl+V (⌘V on macOS). Hover or focus an image card to paste into that slot; otherwise tall images become the screenshot and others the mockup.
- Changes automatically save to this browser after a short pause. A persistent **Recent projects** list below the preview shows thumbnails of your last five compositions and refreshes after saving. Click a thumbnail to restore both original images, perspective placement, blend mode, opacity, radius and iPhone mode, export format, export scale, and JPG quality. The toolbar's **Recent projects** button jumps to the list. The most recent project resumes on reload.
- **New project** saves the current composition and starts a fresh editor with the demo images. Replacing images without starting a new project updates the current composition. Once five projects are saved, saving a new one removes the least recently edited project.
- Drag any corner to match the mockup's screen perspective. A 4× loupe follows the selected corner. Focus a handle and use arrow keys for one source-image pixel adjustments, or Shift + arrow for ten pixels.
- Click the image to zoom toward that point (2×, then 4×, then fit); **Fit** resets the view. Zoom affects only the preview.
- Hover or keyboard-focus a blend-mode option for a temporary preview; click to commit it. The selection border and handles disappear outside the image, but remain visible while dragging or keyboard-focused.
- Adjust screenshot warmth (cool to warm), tint (green to magenta), and a color overlay with its own opacity and blend mode. These affect the screenshot before it is blended into the mockup and are included in export and saved projects.
- Choose a blend mode, opacity, and source-screenshot corner radius. iPhone corners use 12.3% of the screenshot's shorter side as an approximate modern iPhone screen radius, scaled automatically; manual adjustment accommodates different models. Loading a mockup whose filename matches a recent project restores its latest screenshot placement and appearance settings without replacing the newly selected images. Matching is case-insensitive and filename-based, so different images with the same name share settings.
- Export at the mockup's original dimensions or 2×. Loading a mockup preselects JPG for JPEG originals and PNG for other formats. You can override this; replacing only the screenshot preserves your choice. PNG is lossless; JPG supports adjustable quality and flattens transparency onto white. The selection, handles, and loupe are not exported.

The renderer uses an inverse projective homography in WebGL, not an affine triangle approximation. WebGL 2 enables trilinear mipmap filtering to retain clean detail when screenshots are reduced; WebGL 1 is supported as a fallback. Export samples the original screenshot with high-precision coordinates and antialiased rounded corners, and composites with Canvas 2D's standard blend modes. Preview resolution is independent of export resolution. Upscaling increases output dimensions, not source detail.

Input images are limited to 100 MB. Working images and exports are limited to the browser GPU's supported dimensions and 60 megapixels, with explicit errors rather than silent quality reduction. SVG screenshots are rasterized at their declared natural dimensions. Animated images are not an animation export workflow.

No backend, accounts, API keys, analytics, or image-hosting services are used. DM Sans and Manrope are bundled locally under the SIL Open Font License; their license notices are in `public/fonts`. Projects are stored locally in IndexedDB, with the original image files preserved without recompression. History belongs to the current browser and site origin: the development preview and published site have separate histories. Clearing browser data, private browsing cleanup, or browser storage eviction can remove saved projects. Storage errors are displayed explicitly; keep the tab open if saving fails. GitHub Pages may log visitors' IP addresses.
