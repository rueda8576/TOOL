import { INestApplication } from "@nestjs/common";
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
      fileName: "roadmap.pdf",
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
    expect(pdfResponse.headers["content-disposition"]).toBe("inline; filename=\"roadmap.pdf\"");
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
