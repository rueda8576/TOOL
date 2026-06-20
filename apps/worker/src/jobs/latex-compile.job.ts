import { randomUUID } from "crypto";
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { spawn } from "child_process";

import { CompileStatus, NotificationEventType, NotificationStatus, PrismaClient } from "@prisma/client";
import AdmZip from "adm-zip";
import type { Job } from "bullmq";

import { getEnv } from "../config/env";
import { normalizeContainedRelativePath, resolveContainedPath } from "../utils/path-confinement";
import { extractZipSafely } from "../utils/safe-zip";

const env = getEnv();
const MAX_COMPILE_LOG_CHARS = 80_000;

const appendBoundedLog = (current: string, next: string): string => {
  const combined = current + next;
  if (combined.length <= MAX_COMPILE_LOG_CHARS) {
    return combined;
  }

  return `[log truncated to last ${MAX_COMPILE_LOG_CHARS} characters]\n${combined.slice(-MAX_COMPILE_LOG_CHARS)}`;
};

const buildLatexProcessEnv = (cwd: string): NodeJS.ProcessEnv => ({
  PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  HOME: cwd,
  TMPDIR: cwd,
  TEMP: cwd,
  TMP: cwd,
  TEXMFVAR: join(cwd, ".texmf-var"),
  TEXMFCONFIG: join(cwd, ".texmf-config"),
  TEXMFHOME: join(cwd, ".texmf-home"),
  openin_any: "p",
  openout_any: "p",
  shell_escape: "0"
});

const redactSensitiveText = (text: string): string => {
  let redacted = text;
  const secrets = [env.DATABASE_URL, env.REDIS_URL, env.SMTP_PASS, env.OPENAI_API_KEY].filter(
    (value): value is string => Boolean(value)
  );
  for (const secret of secrets) {
    redacted = redacted.split(secret).join("[redacted]");
  }
  return redacted;
};

const compileFailureMessage = (error: unknown): string => {
  const message = error instanceof Error && error.message ? error.message : "LaTeX compilation failed";
  return appendBoundedLog("", redactSensitiveText(message));
};

const fileExists = async (targetPath: string): Promise<boolean> => {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const normalizeLatexEntryFile = (entryFile: string): string => {
  const normalized = normalizeContainedRelativePath(entryFile, "Invalid LaTeX entry file");
  if (!normalized.toLowerCase().endsWith(".tex")) {
    throw new Error("Invalid LaTeX entry file");
  }
  if (normalized.split("/").some((segment) => segment.startsWith("-"))) {
    throw new Error("Invalid LaTeX entry file");
  }
  return normalized;
};

const copyWorkspaceSafely = async (sourceRoot: string, targetRoot: string, relativePath = ""): Promise<void> => {
  const sourceDir = relativePath ? resolveContainedPath(sourceRoot, relativePath, "Invalid LaTeX workspace path") : sourceRoot;
  const targetDir = relativePath ? resolveContainedPath(targetRoot, relativePath, "Invalid LaTeX workspace path") : targetRoot;
  await mkdir(targetDir, { recursive: true });

  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const entryRelativePath = normalizeContainedRelativePath(
      relativePath ? `${relativePath}/${entry.name}` : entry.name,
      "Invalid LaTeX workspace path"
    );

    if (entry.isSymbolicLink()) {
      throw new Error("LaTeX workspace cannot contain symlinks");
    }

    if (entry.isDirectory()) {
      await copyWorkspaceSafely(sourceRoot, targetRoot, entryRelativePath);
      continue;
    }

    if (!entry.isFile()) {
      throw new Error("LaTeX workspace contains unsupported file type");
    }

    await copyFile(
      resolveContainedPath(sourceRoot, entryRelativePath, "Invalid LaTeX workspace path"),
      resolveContainedPath(targetRoot, entryRelativePath, "Invalid LaTeX workspace path")
    );
  }
};

const runCommand = async (params: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  label: string;
}): Promise<{
  status: CompileStatus;
  log: string;
  exitCode: number;
}> => {
  const child = spawn(params.command, params.args, {
    cwd: params.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: buildLatexProcessEnv(params.cwd),
    detached: true,
    shell: false
  });

  let log = "";
  let timedOut = false;
  child.stdout.on("data", (chunk) => {
    log = appendBoundedLog(log, chunk.toString());
  });
  child.stderr.on("data", (chunk) => {
    log = appendBoundedLog(log, chunk.toString());
  });

  const exitCode = await new Promise<number>((resolveExit) => {
    let settled = false;
    const finish = (code: number): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolveExit(code);
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      log = appendBoundedLog(log, `\n[timeout] ${params.label} exceeded ${params.timeoutMs}ms`);
      if (typeof child.pid === "number") {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          try {
            process.kill(child.pid, "SIGKILL");
          } catch {
            // The process may already have exited after the timeout fired.
          }
        }
      }
      finish(-1);
    }, params.timeoutMs);

    child.on("error", (error) => {
      log = appendBoundedLog(log, `\n[spawn-error] ${(error as Error).message}`);
      finish(-1);
    });
    child.on("close", (code) => finish(code ?? -1));
  });

  const formattedLog = appendBoundedLog("", `\n[${params.label}] ${params.command} ${params.args.join(" ")}\n${log}`);
  if (exitCode === 0) {
    return {
      status: CompileStatus.SUCCEEDED,
      log: formattedLog,
      exitCode
    };
  }

  if (timedOut || log.includes("timed out") || log.includes("ETIMEDOUT")) {
    return {
      status: CompileStatus.TIMEOUT,
      log: formattedLog,
      exitCode
    };
  }

  return {
    status: CompileStatus.FAILED,
    log: formattedLog,
    exitCode
  };
};

const compileLatex = async (workingDir: string, entryFile: string): Promise<{ status: CompileStatus; log: string; pdfPath?: string }> => {
  const normalizedEntry = normalizeLatexEntryFile(entryFile);
  const outputPdf = normalizedEntry.replace(/\.tex$/i, ".pdf");
  const jobBase = normalizedEntry.replace(/\.tex$/i, "");
  const auxPath = resolveContainedPath(workingDir, `${jobBase}.aux`, "Invalid LaTeX output path");
  const bcfPath = resolveContainedPath(workingDir, `${jobBase}.bcf`, "Invalid LaTeX output path");
  const pdfPath = resolveContainedPath(workingDir, outputPdf, "Invalid LaTeX output path");
  const latexArgs = [
    "-interaction=nonstopmode",
    "-halt-on-error",
    "-file-line-error",
    "-no-shell-escape",
    normalizedEntry
  ];

  let combinedLog = "";
  const runLatexPass = async (pass: number): Promise<CompileStatus> => {
    const result = await runCommand({
      command: "pdflatex",
      args: latexArgs,
      cwd: workingDir,
      timeoutMs: env.LATEX_TIMEOUT_MS,
      label: `pdflatex pass ${pass}`
    });
    combinedLog = appendBoundedLog(combinedLog, result.log);
    return result.status;
  };

  const firstPassStatus = await runLatexPass(1);
  if (firstPassStatus !== CompileStatus.SUCCEEDED) {
    return {
      status: firstPassStatus,
      log: combinedLog
    };
  }

  const hasBcf = await fileExists(bcfPath);
  const hasAux = await fileExists(auxPath);
  if (hasBcf) {
    const biberResult = await runCommand({
      command: "biber",
      args: [jobBase],
      cwd: workingDir,
      timeoutMs: env.LATEX_TIMEOUT_MS,
      label: "biber"
    });
    combinedLog = appendBoundedLog(combinedLog, biberResult.log);
    if (biberResult.status !== CompileStatus.SUCCEEDED) {
      return {
        status: biberResult.status,
        log: combinedLog
      };
    }
  } else if (hasAux) {
    const auxContent = await readFile(auxPath, "utf8").catch(() => "");
    if (auxContent.includes("\\bibdata")) {
      const bibtexResult = await runCommand({
        command: "bibtex",
        args: [jobBase],
        cwd: workingDir,
        timeoutMs: env.LATEX_TIMEOUT_MS,
        label: "bibtex"
      });
      combinedLog = appendBoundedLog(combinedLog, bibtexResult.log);
      if (bibtexResult.status !== CompileStatus.SUCCEEDED) {
        return {
          status: bibtexResult.status,
          log: combinedLog
        };
      }
    }
  }

  const secondPassStatus = await runLatexPass(2);
  if (secondPassStatus !== CompileStatus.SUCCEEDED) {
    return {
      status: secondPassStatus,
      log: combinedLog
    };
  }

  const thirdPassStatus = await runLatexPass(3);
  if (thirdPassStatus !== CompileStatus.SUCCEEDED) {
    return {
      status: thirdPassStatus,
      log: combinedLog
    };
  }

  if (!(await fileExists(pdfPath))) {
    return {
      status: CompileStatus.FAILED,
      log: `${combinedLog}\nNo PDF output found at ${outputPdf}`
    };
  }

  return {
    status: CompileStatus.SUCCEEDED,
    log: combinedLog,
    pdfPath
  };
};

export const processLatexCompileJob = async (
  prisma: PrismaClient,
  job: Job<{ documentVersionId: string; compileJobId: string }>
): Promise<void> => {
  const { documentVersionId, compileJobId } = job.data;
  const loadActiveVersion = async () =>
    prisma.documentVersion.findFirst({
      where: {
        id: documentVersionId,
        deletedAt: null,
        branch: {
          deletedAt: null
        },
        document: {
          deletedAt: null
        }
      },
      include: {
        latexBundleFile: true
      }
    });
  let failedVersionId: string | null = null;
  let workDir: string | null = null;

  await prisma.documentCompileJob.update({
    where: { id: compileJobId },
    data: {
      status: CompileStatus.RUNNING,
      startedAt: new Date()
    }
  });

  try {
    const version = await loadActiveVersion();

    if (!version) {
      await prisma.documentCompileJob.update({
        where: { id: compileJobId },
        data: {
          status: CompileStatus.FAILED,
          finishedAt: new Date(),
          errorMessage: "Document was deleted before compilation started"
        }
      });
      return;
    }
    failedVersionId = version.id;

    if (!version.latexBundleFile && !version.latexWorkspacePath) {
      await prisma.documentVersion.update({
        where: { id: version.id },
        data: {
          compileStatus: CompileStatus.FAILED,
          compileLog: "Version has no latex source"
        }
      });
      await prisma.documentCompileJob.update({
        where: { id: compileJobId },
        data: {
          status: CompileStatus.FAILED,
          finishedAt: new Date(),
          errorMessage: "Version has no latex source"
        }
      });
      return;
    }

    const entryFile = normalizeLatexEntryFile(version.latexEntryFile ?? "main.tex");
    workDir = await mkdtemp(join(tmpdir(), "atlasium-latex-"));

    if (version.latexWorkspacePath) {
      const sourceWorkDir = resolveContainedPath(env.STORAGE_ROOT, version.latexWorkspacePath, "Invalid workspace path");
      await copyWorkspaceSafely(sourceWorkDir, workDir);
    } else {
      const zipPath = resolveContainedPath(env.STORAGE_ROOT, version.latexBundleFile!.storagePath, "Invalid latex bundle path");
      const zipBuffer = await readFile(zipPath);
      const zip = new AdmZip(zipBuffer);
      await extractZipSafely(zip, workDir);
    }

    const compileResult = await compileLatex(workDir, entryFile);
    const activeVersionAfterCompile = await loadActiveVersion();

    if (!activeVersionAfterCompile) {
      await prisma.documentCompileJob.update({
        where: { id: compileJobId },
        data: {
          status: CompileStatus.FAILED,
          finishedAt: new Date(),
          errorMessage: "Document was deleted during compilation"
        }
      });
      return;
    }

    let compiledPdfFileId: string | null = null;
    if (compileResult.status === CompileStatus.SUCCEEDED && compileResult.pdfPath) {
      const pdfBuffer = await readFile(compileResult.pdfPath);
      const compiledDate = new Date().toISOString().slice(0, 10);
      const compiledDir = resolveContainedPath(env.STORAGE_ROOT, `compiled/${compiledDate}`, "Invalid compiled output path");
      const relativePath = `compiled/${compiledDate}/${randomUUID()}-${activeVersionAfterCompile.id}.pdf`;
      const outputPath = resolveContainedPath(env.STORAGE_ROOT, relativePath, "Invalid compiled output path");
      await mkdir(compiledDir, { recursive: true });
      await writeFile(outputPath, pdfBuffer);

      const fileObject = await prisma.fileObject.create({
        data: {
          storagePath: relativePath,
          originalName: `${activeVersionAfterCompile.id}.pdf`,
          mimeType: "application/pdf",
          sizeBytes: BigInt(pdfBuffer.byteLength),
          uploadedById: activeVersionAfterCompile.createdById
        },
        select: { id: true }
      });

      compiledPdfFileId = fileObject.id;
    }

    await prisma.documentVersion.update({
      where: { id: activeVersionAfterCompile.id },
      data: {
        compileStatus: compileResult.status,
        compileLog: compileResult.log,
        compiledPdfFileId: compiledPdfFileId ?? undefined
      }
    });

    await prisma.documentCompileJob.update({
      where: { id: compileJobId },
      data: {
        status: compileResult.status,
        finishedAt: new Date(),
        errorMessage:
          compileResult.status === CompileStatus.SUCCEEDED ? null : "LaTeX compilation failed"
      }
    });

    await prisma.notificationEvent.create({
      data: {
        userId: activeVersionAfterCompile.createdById,
        type: NotificationEventType.DOC_COMPILED,
        status: NotificationStatus.PENDING,
        payload: {
          documentVersionId,
          compileStatus: compileResult.status
        }
      }
    });
  } catch (error) {
    const message = compileFailureMessage(error);
    if (failedVersionId) {
      await prisma.documentVersion.update({
        where: { id: failedVersionId },
        data: {
          compileStatus: CompileStatus.FAILED,
          compileLog: message,
          compiledPdfFileId: undefined
        }
      });
    }
    await prisma.documentCompileJob.update({
      where: { id: compileJobId },
      data: {
        status: CompileStatus.FAILED,
        finishedAt: new Date(),
        errorMessage: message
      }
    });
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true });
    }
  }
};
