import { z } from "zod";

export const DOCUMENT_TYPES = ["paper", "manual", "model", "draft", "minutes", "other"] as const;
export const COMPILE_STATUSES = ["pending", "running", "succeeded", "failed", "timeout"] as const;

export const DocumentTypeSchema = z.enum(DOCUMENT_TYPES);
export const CompileStatusSchema = z.enum(COMPILE_STATUSES);

export type DocumentTypeValue = (typeof DOCUMENT_TYPES)[number];
export type DocumentType = DocumentTypeValue;
export type CompileStatusValue = (typeof COMPILE_STATUSES)[number];

export type DocumentVersionSummary = {
  id: string;
  versionNumber: number;
  compileStatus: CompileStatusValue;
  hasPdf: boolean;
  hasLatex: boolean;
  latexEntryFile: string | null;
  createdAt: string;
};

export type DocumentListItem = {
  id: string;
  projectId: string;
  title: string;
  type: DocumentTypeValue;
  authors: string[];
  tags: string[];
  publishedAt: string | null;
  updatedAt: string;
  latestMainVersion: DocumentVersionSummary | null;
};

export type DocumentDetail = {
  id: string;
  projectId: string;
  title: string;
  type: DocumentTypeValue;
  authors: string[];
  tags: string[];
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  latestMainVersion: DocumentVersionSummary | null;
};

export const CreateDocumentSchema = z.object({
  title: z.string().min(1).max(300),
  type: DocumentTypeSchema.default("other"),
  authors: z.array(z.string().min(1)).default([]),
  tags: z.array(z.string().min(1)).default([]),
  publishedAt: z.string().datetime().optional()
});

export type CreateDocumentInput = z.input<typeof CreateDocumentSchema>;

export type DocumentVersionCompileLog = {
  documentVersionId: string;
  compileStatus: CompileStatusValue;
  compileLog: string | null;
  compiledPdfFileId: string | null;
};
