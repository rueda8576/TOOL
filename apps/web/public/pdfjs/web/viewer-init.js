(() => {
  const status = document.getElementById("status");
  const pagesRoot = document.getElementById("pages");
  const pdfjsLib = window.pdfjsLib;

  if (!status || !pagesRoot) {
    return;
  }

  if (!pdfjsLib) {
    status.textContent = "PDF.js runtime is unavailable.";
    return;
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc = "../build/pdf.worker.js";

  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const fileUrl = searchParams.get("file");
  const requestedFilename = (searchParams.get("filename") || "document-latest.pdf").trim() || "document-latest.pdf";
  const zoomParam = (hashParams.get("zoom") || "page-width").toLowerCase();

  if (!fileUrl) {
    status.textContent = "Missing PDF source.";
    return;
  }

  let documentRef = null;
  let renderToken = 0;

  const triggerDownload = () => {
    const anchor = document.createElement("a");
    anchor.href = fileUrl;
    anchor.download = requestedFilename;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const resolveScale = (page, containerWidth) => {
    const baseViewport = page.getViewport({ scale: 1 });
    if (zoomParam === "page-width") {
      const targetWidth = Math.max(containerWidth - 2, 1);
      return Math.max(targetWidth / baseViewport.width, 0.1);
    }

    const percent = Number.parseFloat(zoomParam);
    if (Number.isFinite(percent) && percent > 0) {
      return percent / 100;
    }
    return 1;
  };

  const renderDocument = async () => {
    if (!documentRef) {
      return;
    }

    const thisRender = ++renderToken;
    pagesRoot.innerHTML = "";
    status.textContent = "Rendering PDF...";

    for (let pageNumber = 1; pageNumber <= documentRef.numPages; pageNumber += 1) {
      if (thisRender !== renderToken) {
        return;
      }

      const page = await documentRef.getPage(pageNumber);
      const scale = resolveScale(page, pagesRoot.clientWidth);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) {
        continue;
      }

      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.className = "page-canvas";

      const wrap = document.createElement("section");
      wrap.className = "page-wrap";
      wrap.appendChild(canvas);
      pagesRoot.appendChild(wrap);

      await page.render({ canvasContext: context, viewport }).promise;
    }

    if (thisRender === renderToken) {
      status.textContent = "PDF rendered.";
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

  window.addEventListener("resize", requestRender);
  window.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey)) {
      return;
    }
    if (event.key.toLowerCase() !== "s") {
      return;
    }
    event.preventDefault();
    triggerDownload();
  });

  const loadingTask = pdfjsLib.getDocument({
    url: fileUrl
  });

  loadingTask.promise
    .then((pdf) => {
      documentRef = pdf;
      status.textContent = "PDF loaded.";
      return renderDocument();
    })
    .catch((error) => {
      status.textContent = "Failed to load PDF.";
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
