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
});
