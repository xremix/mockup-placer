import { inverseHomography } from "./geometry.js";

export class Renderer {
  constructor() {
    this.canvas = document.createElement("canvas");
    const attributes = {
      alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true,
      antialias: false, depth: false, stencil: false,
    };
    const modernContext = this.canvas.getContext("webgl2", attributes);
    const gl = modernContext || this.canvas.getContext("webgl", attributes);
    if (!gl) throw new Error("This editor needs WebGL. Enable hardware acceleration or open it in a current browser.");
    this.gl = gl;
    this.maxSize = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), ...gl.getParameter(gl.MAX_VIEWPORT_DIMS));
    this.modern = Boolean(modernContext);
    const vertex = this.shader(gl.VERTEX_SHADER, `${this.modern ? "#version 300 es" : ""}
      ${this.modern ? "in" : "attribute"} vec2 position;
      void main() { gl_Position = vec4(position, 0.0, 1.0); }
    `);
    const fragment = this.shader(gl.FRAGMENT_SHADER, `${this.modern ? "#version 300 es" : ""}
      precision highp float;
      ${this.modern ? "out vec4 outputColor;" : ""}
      uniform sampler2D image;
      uniform mat3 mapping;
      uniform vec2 outputSize;
      uniform vec2 imageSize;
      uniform float radius;
      uniform float feather;
      void main() {
        vec2 point = vec2(gl_FragCoord.x / outputSize.x, 1.0 - gl_FragCoord.y / outputSize.y);
        vec3 projected = mapping * vec3(point, 1.0);
        vec2 uv = projected.xy / projected.z;
        if (projected.z <= 0.0 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
          ${this.modern ? "outputColor" : "gl_FragColor"} = vec4(0.0);
          return;
        }
        vec2 q = abs(uv * imageSize - imageSize * 0.5) - (imageSize * 0.5 - radius);
        float distance = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
        vec4 color = ${this.modern ? "texture" : "texture2D"}(image, uv);
        color.a *= 1.0 - smoothstep(-feather, feather, distance);
        ${this.modern ? "outputColor" : "gl_FragColor"} = color;
      }
    `);
    this.program = gl.createProgram();
    gl.attachShader(this.program, vertex);
    gl.attachShader(this.program, fragment);
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error("The image renderer could not start.");
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    gl.useProgram(this.program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const attribute = gl.getAttribLocation(this.program, "position");
    gl.enableVertexAttribArray(attribute);
    gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
    this.uniforms = Object.fromEntries(["mapping", "outputSize", "imageSize", "radius", "feather"].map(name => [name, gl.getUniformLocation(this.program, name)]));
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.canvas.addEventListener("webglcontextlost", event => {
      event.preventDefault();
      this.lost = true;
      window.dispatchEvent(new CustomEvent("renderer-error", { detail: "The graphics context was lost. Reload this page and re-add your images to continue." }));
    });
  }

  shader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`Your browser could not compile the image renderer: ${gl.getShaderInfoLog(shader)}`);
    return shader;
  }

  compose(canvas, state, width, height, jpeg = false) {
    if (this.lost) throw new Error("The graphics context was lost. Reload the page to continue.");
    if (width > this.maxSize || height > this.maxSize || width * height > 60_000_000) {
      throw new Error(`This export exceeds your browser's image limit (${this.maxSize}px per side, 60 megapixels). Choose a smaller export size.`);
    }
    const { gl, uniforms } = this;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if (this.source !== state.screenshot.image) {
      const { image } = state.screenshot;
      if (image.naturalWidth > this.maxSize || image.naturalHeight > this.maxSize) {
        throw new Error(`Your screenshot exceeds the ${this.maxSize}px texture limit of this browser. Resize the source image first.`);
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      const powerOfTwo = size => (size & (size - 1)) === 0;
      if (this.modern || (powerOfTwo(image.naturalWidth) && powerOfTwo(image.naturalHeight))) {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      } else {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      }
      this.source = image;
    }
    gl.uniformMatrix3fv(uniforms.mapping, false, inverseHomography(state.corners));
    gl.uniform2f(uniforms.outputSize, width, height);
    gl.uniform2f(uniforms.imageSize, state.screenshot.width, state.screenshot.height);
    gl.uniform1f(uniforms.radius, state.radius);
    const area = Math.abs(state.corners.reduce((sum, p, i, points) => {
      const next = points[(i + 1) % 4];
      return sum + p.x * next.y - next.x * p.y;
    }, 0)) / 2;
    gl.uniform1f(uniforms.feather, Math.max(0.3, Math.sqrt(state.screenshot.width * state.screenshot.height / (area * width * height)) * 0.65));
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Your browser could not create the export canvas.");
    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    if (jpeg) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(state.mockup.image, 0, 0, width, height);
    ctx.globalAlpha = state.opacity;
    ctx.globalCompositeOperation = state.blend;
    ctx.drawImage(this.canvas, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
}
