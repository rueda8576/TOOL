import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const webRoot = join(scriptDirectory, "..");
const sourceRoot = join(webRoot, "node_modules", "pdfjs-dist");
const destinationRoot = join(webRoot, "public", "pdfjs");

if (!existsSync(sourceRoot)) {
  console.error("pdfjs-dist is not installed. Run pnpm install first.");
  process.exit(1);
}

rmSync(destinationRoot, { recursive: true, force: true });
mkdirSync(destinationRoot, { recursive: true });

for (const folder of ["web", "build", "cmaps", "standard_fonts"]) {
  const sourcePath = join(sourceRoot, folder);
  if (!existsSync(sourcePath)) {
    continue;
  }

  cpSync(sourcePath, join(destinationRoot, folder), {
    recursive: true,
    force: true
  });
}

const viewerWebRoot = join(destinationRoot, "web");
mkdirSync(viewerWebRoot, { recursive: true });

const viewerHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>PDF Preview</title>
    <style>
      :root {
        color-scheme: light;
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        margin: 0;
        height: 100%;
        background: #eef3fb;
        color: #172133;
        font: 13px/1.4 "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      }

      body {
        display: flex;
        flex-direction: column;
      }

      #status {
        min-height: 34px;
        padding: 8px 12px;
        border-bottom: 1px solid #d8e0ec;
        background: #f8fbff;
        color: #5b6980;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }

      #status.is-hidden {
        display: none;
      }

      #pages {
        flex: 1;
        overflow: auto;
        padding: 12px;
        display: grid;
        gap: 12px;
      }

      .page-wrap {
        width: 100%;
        position: relative;
        border: 1px solid #d8e0ec;
        background: #ffffff;
        box-shadow: 0 2px 8px rgba(16, 24, 40, 0.08);
      }

      .page-canvas {
        width: 100%;
        height: auto;
        display: block;
      }

      .page-text-layer {
        position: absolute;
        inset: 0;
        overflow: hidden;
        line-height: 1;
        z-index: 2;
      }

      .page-text-layer span,
      .page-text-layer br {
        position: absolute;
        color: transparent;
        white-space: pre;
        cursor: text;
        transform-origin: 0 0;
      }

      .page-text-layer ::selection {
        background: rgba(31, 79, 143, 0.24);
      }

      .page-text-layer .pdf-word-highlight {
        background: rgba(43, 122, 104, 0.24);
        box-shadow: inset 0 -1px 0 rgba(43, 122, 104, 0.6);
        border-radius: 2px;
      }
    </style>
  </head>
  <body>
    <div id="status">Loading PDF...</div>
    <main id="pages" aria-live="polite"></main>
    <script src="../build/pdf.js"></script>
    <script src="./viewer-init.js"></script>
  </body>
</html>
`;

const viewerInit = `(() => {
  const status = document.getElementById("status");
  const pagesRoot = document.getElementById("pages");
  const pdfjsLib = window.pdfjsLib;
  const PDF_HIGHLIGHT_EVENT = "doctoral:pdf-highlight-word";
  const PDF_WORD_PICKED_EVENT = "doctoral:pdf-word-picked";
  const DEFAULT_HIGHLIGHT_DURATION_MS = 1500;
  const ZOOM_IN_FACTOR = 1.1;
  const ZOOM_OUT_FACTOR = 1 / ZOOM_IN_FACTOR;
  const MIN_ZOOM_SCALE = 0.25;
  const MAX_ZOOM_SCALE = 4;

  if (!status || !pagesRoot) {
    return;
  }

  const setStatus = (message) => {
    const text = String(message || "").trim();
    status.textContent = text;
    status.classList.toggle("is-hidden", text.length === 0);
  };

  if (!pdfjsLib) {
    setStatus("PDF.js runtime is unavailable.");
    return;
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc = "../build/pdf.worker.js";

  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const fileUrl = searchParams.get("file");
  const requestedFilename = (searchParams.get("filename") || "document-latest.pdf").trim() || "document-latest.pdf";
  const zoomParam = (hashParams.get("zoom") || "page-width").toLowerCase();

  if (!fileUrl) {
    setStatus("Missing PDF source.");
    return;
  }

  let documentRef = null;
  let renderToken = 0;
  let highlightTimeout = null;
  let manualScale = null;
  let effectiveScale = null;
  const pageViews = [];

  const clearHighlights = () => {
    if (highlightTimeout) {
      window.clearTimeout(highlightTimeout);
      highlightTimeout = null;
    }

    for (const pageView of pageViews) {
      for (const span of pageView.textSpans) {
        span.classList.remove("pdf-word-highlight");
      }
    }
  };

  const escapeRegExp = (value) => value.replace(/[.*+?^$(){}|[\\]\\\\]/g, "\\\\$&");

  const normalizeWordToken = (rawValue) =>
    String(rawValue || "")
      .trim()
      .replace(/^[^A-Za-z0-9_]+|[^A-Za-z0-9_]+$/g, "");

  const triggerDownload = () => {
    const anchor = document.createElement("a");
    anchor.href = fileUrl;
    anchor.download = requestedFilename;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const clampScale = (value) => {
    if (!Number.isFinite(value)) {
      return 1;
    }
    return Math.min(Math.max(value, MIN_ZOOM_SCALE), MAX_ZOOM_SCALE);
  };

  if (zoomParam !== "page-width") {
    const percent = Number.parseFloat(zoomParam);
    if (Number.isFinite(percent) && percent > 0) {
      manualScale = clampScale(percent / 100);
    }
  }

  const resolveScale = (page, containerWidth) => {
    const baseViewport = page.getViewport({ scale: 1 });
    const targetWidth = Math.max(containerWidth - 2, 1);
    const pageWidthScale = Math.max(targetWidth / baseViewport.width, 0.1);
    if (manualScale !== null) {
      return clampScale(manualScale);
    }
    return pageWidthScale;
  };

  const highlightWord = (rawWord, durationMs = DEFAULT_HIGHLIGHT_DURATION_MS) => {
    clearHighlights();

    const normalizedWord = normalizeWordToken(rawWord);
    if (!normalizedWord) {
      return;
    }

    const escapedWord = escapeRegExp(normalizedWord);
    const matcher = new RegExp("(^|[^A-Za-z0-9_])" + escapedWord + "([^A-Za-z0-9_]|$)", "i");

    const matches = [];
    for (const pageView of pageViews) {
      for (const span of pageView.textSpans) {
        const text = span.textContent || "";
        if (!matcher.test(text)) {
          continue;
        }
        span.classList.add("pdf-word-highlight");
        matches.push(span);
      }
    }

    if (matches.length > 0) {
      matches[0].scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    }

    if (durationMs > 0) {
      highlightTimeout = window.setTimeout(() => {
        clearHighlights();
      }, durationMs);
    }
  };

  const postPickedWord = (word) => {
    if (!window.parent || window.parent === window) {
      return;
    }

    window.parent.postMessage(
      {
        type: PDF_WORD_PICKED_EVENT,
        payload: {
          word
        }
      },
      window.location.origin
    );
  };

  const renderDocument = async () => {
    if (!documentRef) {
      return;
    }

    const thisRender = ++renderToken;
    pagesRoot.innerHTML = "";
    pageViews.length = 0;
    clearHighlights();
    setStatus("Rendering PDF...");
    effectiveScale = null;

    for (let pageNumber = 1; pageNumber <= documentRef.numPages; pageNumber += 1) {
      if (thisRender !== renderToken) {
        return;
      }

      const page = await documentRef.getPage(pageNumber);
      const scale = resolveScale(page, pagesRoot.clientWidth);
      if (pageNumber === 1) {
        effectiveScale = scale;
      }
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) {
        continue;
      }

      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.className = "page-canvas";

      const textLayer = document.createElement("div");
      textLayer.className = "page-text-layer";

      const wrap = document.createElement("section");
      wrap.className = "page-wrap";
      wrap.style.width = String(canvas.width) + "px";
      wrap.appendChild(canvas);
      wrap.appendChild(textLayer);
      pagesRoot.appendChild(wrap);

      const renderTask = page.render({ canvasContext: context, viewport });
      const textContent = await page.getTextContent();
      const textLayerTask = pdfjsLib.renderTextLayer({
        textContentSource: textContent,
        container: textLayer,
        viewport,
        textDivs: []
      });

      await Promise.all([renderTask.promise, textLayerTask.promise || Promise.resolve()]);

      const textSpans = Array.from(textLayer.querySelectorAll("span"));
      pageViews.push({ pageNumber, textSpans });
    }

    if (thisRender === renderToken) {
      setStatus("");
    }
  };

  const requestRender = (() => {
    let timeout = null;
    return () => {
      if (timeout) {
        window.clearTimeout(timeout);
      }
      timeout = window.setTimeout(() => {
        timeout = null;
        void renderDocument();
      }, 120);
    };
  })();

  const zoomByFactor = (factor) => {
    const baseScale = manualScale !== null ? manualScale : effectiveScale !== null ? effectiveScale : 1;
    manualScale = clampScale(baseScale * factor);
    requestRender();
  };

  const resetZoomToPageWidth = () => {
    manualScale = null;
    requestRender();
  };

  pagesRoot.addEventListener("dblclick", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (!target.closest(".page-text-layer")) {
      return;
    }

    const selectionText = window.getSelection()?.toString() || "";
    const normalizedWord = normalizeWordToken(selectionText || target.textContent || "");
    if (!normalizedWord) {
      return;
    }

    highlightWord(normalizedWord, DEFAULT_HIGHLIGHT_DURATION_MS);
    postPickedWord(normalizedWord);
  });

  pagesRoot.addEventListener(
    "wheel",
    (event) => {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }

      event.preventDefault();
      if (event.deltaY < 0) {
        zoomByFactor(ZOOM_IN_FACTOR);
        return;
      }

      if (event.deltaY > 0) {
        zoomByFactor(ZOOM_OUT_FACTOR);
      }
    },
    { passive: false }
  );

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) {
      return;
    }

    const message = event.data;
    if (!message || typeof message !== "object") {
      return;
    }

    if (message.type !== PDF_HIGHLIGHT_EVENT) {
      return;
    }

    const payload = message.payload;
    if (!payload || typeof payload !== "object") {
      return;
    }

    const word = normalizeWordToken(payload.word);
    if (!word) {
      return;
    }

    const durationMs = Number.isFinite(payload.durationMs) ? Math.max(0, Number(payload.durationMs)) : DEFAULT_HIGHLIGHT_DURATION_MS;
    highlightWord(word, durationMs);
  });

  window.addEventListener("resize", requestRender);
  window.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey)) {
      return;
    }

    const key = event.key.toLowerCase();
    if (key === "s") {
      event.preventDefault();
      triggerDownload();
      return;
    }

    if (key === "+" || key === "=" || key === "add") {
      event.preventDefault();
      zoomByFactor(ZOOM_IN_FACTOR);
      return;
    }

    if (key === "-" || key === "_" || key === "subtract") {
      event.preventDefault();
      zoomByFactor(ZOOM_OUT_FACTOR);
      return;
    }

    if (key === "0") {
      event.preventDefault();
      resetZoomToPageWidth();
    }
  });

  setStatus("Loading PDF...");
  const loadingTask = pdfjsLib.getDocument({
    url: fileUrl
  });

  loadingTask.promise
    .then((pdf) => {
      documentRef = pdf;
      return renderDocument();
    })
    .catch((error) => {
      setStatus("Failed to load PDF.");
      const message = error instanceof Error ? error.message : String(error);
      const details = document.createElement("pre");
      details.style.margin = "0";
      details.style.padding = "12px";
      details.style.color = "#b3453f";
      details.textContent = message;
      pagesRoot.innerHTML = "";
      pagesRoot.appendChild(details);
    });
})();
`;

writeFileSync(join(viewerWebRoot, "viewer.html"), viewerHtml, "utf8");
writeFileSync(join(viewerWebRoot, "viewer-init.js"), viewerInit, "utf8");

console.log("Synced PDF.js viewer assets to apps/web/public/pdfjs");
