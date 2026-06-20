import { INestApplication } from "@nestjs/common";
import { rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import request from "supertest";

import { DocumentsController } from "../../src/documents/documents.controller";
import { DocumentsService } from "../../src/documents/documents.service";
import { authHeaders, createHttpTestApp } from "./http-test.utils";

describe("DocumentsController HTTP", () => {
  let app: INestApplication;
  let documentsService: Record<string, jest.Mock>;

  beforeEach(async () => {
    documentsService = {
      listDocuments: jest.fn(),
      getDocumentDetail: jest.fn(),
      createDocument: jest.fn(),
      deleteDocument: jest.fn(),
      createBranch: jest.fn(),
      createVersion: jest.fn(),
      enqueueCompile: jest.fn(),
      getCompileLog: jest.fn(),
      getPdfBytes: jest.fn(),
      getLatexTree: jest.fn(),
      getLatexFile: jest.fn(),
      updateLatexFile: jest.fn()
    };

    app = await createHttpTestApp({
      controllers: [DocumentsController],
      providers: [{ provide: DocumentsService, useValue: documentsService }]
    });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it("returns 401 when the request is unauthenticated", async () => {
    await request(app.getHttpServer()).get("/projects/project-1/documents").expect(401);
  });

  it("returns 400 for malformed document creation payloads", async () => {
    await request(app.getHttpServer())
      .post("/projects/project-1/documents")
      .set(authHeaders("editor"))
      .send({ title: "Doc", type: "invalid-type" })
      .expect(400);
  });

  it("lists documents and binds the current user", async () => {
    documentsService.listDocuments.mockResolvedValue([
      {
        id: "document-1",
        projectId: "project-1",
        title: "Roadmap",
        type: "paper"
      }
    ]);

    const response = await request(app.getHttpServer())
      .get("/projects/project-1/documents")
      .set(authHeaders("reader", { userId: "reader-1" }))
      .expect(200);

    expect(documentsService.listDocuments).toHaveBeenCalledWith("project-1", {
      userId: "reader-1",
      email: "reader@example.com",
      globalRole: "reader"
    });
    expect(response.body[0].id).toBe("document-1");
  });

  it("creates and deletes documents through the expected routes", async () => {
    documentsService.createDocument.mockResolvedValue({
      id: "document-1",
      projectId: "project-1",
      title: "Roadmap",
      type: "paper",
      mainBranchId: "branch-1"
    });
    documentsService.deleteDocument.mockResolvedValue({
      id: "document-1",
      deletedAt: "2026-04-06T10:00:00.000Z"
    });

    const createResponse = await request(app.getHttpServer())
      .post("/projects/project-1/documents")
      .set(authHeaders("editor", { userId: "editor-1" }))
      .send({
        title: "Roadmap",
        type: "paper",
        authors: ["Ada"],
        tags: ["planning"]
      })
      .expect(201);

    const deleteResponse = await request(app.getHttpServer())
      .delete("/documents/document-1")
      .set(authHeaders("editor", { userId: "editor-1" }))
      .expect(200);

    expect(documentsService.createDocument).toHaveBeenCalledWith(
      "project-1",
      {
        title: "Roadmap",
        type: "paper",
        authors: ["Ada"],
        tags: ["planning"]
      },
      {
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      }
    );
    expect(documentsService.deleteDocument).toHaveBeenCalledWith("document-1", {
      userId: "editor-1",
      email: "editor@example.com",
      globalRole: "editor"
    });
    expect(createResponse.body.mainBranchId).toBe("branch-1");
    expect(deleteResponse.body.deletedAt).toBe("2026-04-06T10:00:00.000Z");
  });

  it("binds documentVersionId and query params for latex file reads", async () => {
    documentsService.getLatexFile.mockResolvedValue({
      documentVersionId: "version-1",
      path: "main.tex",
      content: "\\section{Intro}"
    });

    const response = await request(app.getHttpServer())
      .get("/document-versions/version-1/latex/file")
      .query({ path: "main.tex" })
      .set(authHeaders("reader", { userId: "reader-1" }))
      .expect(200);

    expect(documentsService.getLatexFile).toHaveBeenCalledWith(
      "version-1",
      "main.tex",
      {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      }
    );
    expect(response.body).toEqual({
      documentVersionId: "version-1",
      path: "main.tex",
      content: "\\section{Intro}"
    });
  });

  it("binds document detail and branch creation params", async () => {
    documentsService.getDocumentDetail.mockResolvedValue({
      id: "document-1",
      projectId: "project-1",
      title: "Roadmap",
      type: "latex",
      mainBranchId: "branch-1",
      branches: []
    });
    documentsService.createBranch.mockResolvedValue({
      id: "branch-2",
      documentId: "document-1",
      name: "draft",
      baseVersionId: "version-1"
    });

    const detailResponse = await request(app.getHttpServer())
      .get("/projects/project-1/documents/document-1")
      .set(authHeaders("reader", { userId: "reader-1" }))
      .expect(200);

    const branchResponse = await request(app.getHttpServer())
      .post("/documents/document-1/branches")
      .set(authHeaders("editor", { userId: "editor-1" }))
      .send({ name: "draft", baseVersionId: "version-1" })
      .expect(201);

    expect(documentsService.getDocumentDetail).toHaveBeenCalledWith(
      "project-1",
      "document-1",
      {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      }
    );
    expect(documentsService.createBranch).toHaveBeenCalledWith(
      "document-1",
      { name: "draft", baseVersionId: "version-1" },
      {
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      }
    );
    expect(detailResponse.body.id).toBe("document-1");
    expect(branchResponse.body.id).toBe("branch-2");
  });

  it("starts compilation and streams PDFs inline", async () => {
    documentsService.enqueueCompile.mockResolvedValue({
      compileJobId: "compile-1",
      documentVersionId: "version-1",
      status: "PENDING"
    });
    documentsService.getPdfBytes.mockResolvedValue({
      fileName: "roadmap\r\n\"draft\".pdf",
      buffer: Buffer.from("%PDF-1.4")
    });

    const compileResponse = await request(app.getHttpServer())
      .post("/document-versions/version-1/compile")
      .set(authHeaders("editor", { userId: "editor-1" }))
      .expect(201);

    const pdfResponse = await request(app.getHttpServer())
      .get("/document-versions/version-1/pdf")
      .set(authHeaders("reader", { userId: "reader-1" }))
      .expect(200);

    expect(documentsService.enqueueCompile).toHaveBeenCalledWith(
      "version-1",
      {
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      }
    );
    expect(documentsService.getPdfBytes).toHaveBeenCalledWith(
      "version-1",
      {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      }
    );
    expect(compileResponse.body.compileJobId).toBe("compile-1");
    expect(pdfResponse.headers["content-type"]).toContain("application/pdf");
    expect(pdfResponse.headers["cache-control"]).toBe("private, no-store");
    expect(pdfResponse.headers["x-content-type-options"]).toBe("nosniff");
    expect(pdfResponse.headers["content-disposition"]).toBe('inline; filename="roadmap___draft_.pdf"');
  });

  it("returns compile logs and LaTeX tree data with bound params", async () => {
    documentsService.getCompileLog.mockResolvedValue({
      documentVersionId: "version-1",
      compileStatus: "FAILED",
      compileLog: "Missing figure",
      compiledPdfFileId: null
    });
    documentsService.getLatexTree.mockResolvedValue({
      documentVersionId: "version-1",
      files: [{ path: "main.tex", isDirectory: false }]
    });

    const compileLogResponse = await request(app.getHttpServer())
      .get("/document-versions/version-1/compile-log")
      .set(authHeaders("reader", { userId: "reader-1" }))
      .expect(200);

    const treeResponse = await request(app.getHttpServer())
      .get("/document-versions/version-1/latex/tree")
      .set(authHeaders("reader", { userId: "reader-1" }))
      .expect(200);

    expect(documentsService.getCompileLog).toHaveBeenCalledWith("version-1", {
      userId: "reader-1",
      email: "reader@example.com",
      globalRole: "reader"
    });
    expect(documentsService.getLatexTree).toHaveBeenCalledWith("version-1", {
      userId: "reader-1",
      email: "reader@example.com",
      globalRole: "reader"
    });
    expect(compileLogResponse.body.compileStatus).toBe("FAILED");
    expect(treeResponse.body.files).toEqual([{ path: "main.tex", isDirectory: false }]);
  });

  it("creates document versions via multipart upload and exercises upload storage callbacks", async () => {
    const uploadDir = join(tmpdir(), "doctoral-platform-uploads");
    rmSync(uploadDir, { recursive: true, force: true });

    documentsService.createVersion.mockResolvedValue({
      id: "version-2",
      documentId: "document-1",
      branchId: "branch-1",
      versionNumber: 2,
      compileStatus: "PENDING"
    });

    const response = await request(app.getHttpServer())
      .post("/documents/document-1/versions")
      .set(authHeaders("editor", { userId: "editor-1" }))
      .field("branchName", "main")
      .field("notes", "Initial upload")
      .field("latexEntryFile", "main.tex")
      .field("latexPaths", "main.tex,references.bib")
      .attach("pdf", Buffer.from("%PDF-1.4"), "roadmap.pdf")
      .attach("latexBundle", Buffer.from("zip"), "bundle.zip")
      .attach("latexFiles", Buffer.from("\\section{Intro}"), "main.tex")
      .expect(201);

    expect(documentsService.createVersion).toHaveBeenCalledWith(
      "document-1",
      {
        branchName: "main",
        notes: "Initial upload",
        latexEntryFile: "main.tex",
        latexPaths: "main.tex,references.bib"
      },
      expect.objectContaining({
        pdf: [expect.objectContaining({ originalname: "roadmap.pdf" })],
        latexBundle: [expect.objectContaining({ originalname: "bundle.zip" })],
        latexFiles: [expect.objectContaining({ originalname: "main.tex" })]
      }),
      {
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      }
    );
    expect(response.body.id).toBe("version-2");
  });

  it("updates LaTeX files through the DTO payload", async () => {
    documentsService.updateLatexFile.mockResolvedValue({
      documentVersionId: "version-1",
      path: "main.tex",
      sizeBytes: 32
    });

    const response = await request(app.getHttpServer())
      .put("/document-versions/version-1/latex/file")
      .set(authHeaders("editor", { userId: "editor-1" }))
      .send({ path: "main.tex", content: "\\section{Updated}" })
      .expect(200);

    expect(documentsService.updateLatexFile).toHaveBeenCalledWith(
      "version-1",
      "main.tex",
      "\\section{Updated}",
      {
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      }
    );
    expect(response.body.sizeBytes).toBe(32);
  });
});
