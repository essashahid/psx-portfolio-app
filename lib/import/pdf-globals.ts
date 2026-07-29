// DOM globals that the PDF libraries expect at module-evaluation time.
//
// pdfjs-dist installs its own Node shims when it detects a Node environment,
// but that detection does not fire inside the Vercel serverless runtime, so
// importing it there throws "DOMMatrix is not defined" and PDF extraction
// silently falls back to needs_review. Installing the globals ourselves before
// the import removes the dependency on that detection entirely.
//
// The real implementations come from @napi-rs/canvas (already a dependency of
// pdf-parse) when its native binary is available. The pure-JS fallbacks below
// are enough for text extraction, which never rasterizes a page.

let installed = false;

class MinimalDOMMatrix {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;

  constructor(init?: number[] | string) {
    if (Array.isArray(init) && init.length >= 6) {
      [this.a, this.b, this.c, this.d, this.e, this.f] = init;
    }
  }

  multiply(other: MinimalDOMMatrix): MinimalDOMMatrix {
    const m = new MinimalDOMMatrix();
    m.a = this.a * other.a + this.c * other.b;
    m.b = this.b * other.a + this.d * other.b;
    m.c = this.a * other.c + this.c * other.d;
    m.d = this.b * other.c + this.d * other.d;
    m.e = this.a * other.e + this.c * other.f + this.e;
    m.f = this.b * other.e + this.d * other.f + this.f;
    return m;
  }

  translate(tx = 0, ty = 0): MinimalDOMMatrix {
    const m = new MinimalDOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f]);
    m.e += this.a * tx + this.c * ty;
    m.f += this.b * tx + this.d * ty;
    return m;
  }

  scale(sx = 1, sy = sx): MinimalDOMMatrix {
    const m = new MinimalDOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f]);
    m.a *= sx; m.b *= sx; m.c *= sy; m.d *= sy;
    return m;
  }
}

class MinimalPath2D {
  addPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  bezierCurveTo() {}
  quadraticCurveTo() {}
  rect() {}
}

/**
 * Installs DOMMatrix / Path2D / ImageData on globalThis when missing. Safe to
 * call repeatedly and never overwrites globals a runtime already provides.
 */
export async function ensurePdfGlobals(): Promise<void> {
  if (installed) return;
  installed = true;

  const g = globalThis as Record<string, unknown>;
  if (g.DOMMatrix && g.Path2D && g.ImageData) return;

  try {
    const canvas = (await import("@napi-rs/canvas")) as unknown as Record<string, unknown>;
    if (!g.DOMMatrix && canvas.DOMMatrix) g.DOMMatrix = canvas.DOMMatrix;
    if (!g.Path2D && canvas.Path2D) g.Path2D = canvas.Path2D;
    if (!g.ImageData && canvas.ImageData) g.ImageData = canvas.ImageData;
  } catch {
    // Native binary unavailable for this platform; fall through to the shims.
  }

  if (!g.DOMMatrix) g.DOMMatrix = MinimalDOMMatrix;
  if (!g.Path2D) g.Path2D = MinimalPath2D;
  if (!g.ImageData) {
    g.ImageData = class {
      data: Uint8ClampedArray;
      constructor(public width: number, public height: number) {
        this.data = new Uint8ClampedArray(width * height * 4);
      }
    };
  }
}
