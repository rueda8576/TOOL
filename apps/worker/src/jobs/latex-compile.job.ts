import { randomUUID } from "crypto";
import { access, mkdir, readFile, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { spawn } from "child_process";

import { CompileStatus, NotificationEventType, NotificationStatus, PrismaClient } from "@prisma/client";
import AdmZip from "adm-zip";
import type { Job } from "bullmq";

import { getEnv } from "../config/env";

const env = getEnv();

const fileExists = async (targetPath: string): Promise<boolean> => {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
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
    shell: false,
    timeout: params.timeoutMs
  });

  let log = "";
  child.stdout.on("data", (chunk) => {
    log += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    log += chunk.toString();
  });

  const exitCode = await new Promise<number>((resolveExit) => {
    child.on("error", (error) => {
      log += `\n[spawn-error] ${(error as Error).message}`;
      resolveExit(-1);
    });
    child.on("close", (code) => resolveExit(code ?? -1));
  });

  const formattedLog = `\n[${params.label}] ${params.command} ${params.args.join(" ")}\n${log}`;
  if (exitCode === 0) {
    return {
      status: CompileStatus.SUCCEEDED,
      log: formattedLog,
      exitCode
    };
  }

  if (log.includes("timed out") || log.includes("ETIMEDOUT")) {
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
  const sanitizedEntry = entryFile.replace(/\\/g, "/").replace(/\.\./g, "").replace(/^\/+/, "");
  const outputPdf = sanitizedEntry.replace(/\.tex$/i, ".pdf");
  const jobBase = sanitizedEntry.replace(/\.tex$/i, "");
  const auxPath = join(workingDir, `${jobBase}.aux`);
  const bcfPath = join(workingDir, `${jobBase}.bcf`);
  const pdfPath = join(workingDir, outputPdf);
  const latexArgs = [
    "-interaction=nonstopmode",
    "-halt-on-error",
    "-file-line-error",
    sanitizedEntry
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
    combinedLog += result.log;
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
    combinedLog += biberResult.log;
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
      combinedLog += bibtexResult.log;
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

  await prisma.documentCompileJob.update({
    where: { id: compileJobId },
    data: {
      status: CompileStatus.RUNNING,
      startedAt: new Date()
    }
  });

  const version = await prisma.documentVersion.findFirst({
    where: { id: documentVersionId },
    include: {
      latexBundleFile: true,
      createdBy: true
    }
  });

  if (!version || (!version.latexBundleFile && !version.latexWorkspacePath)) {
    await prisma.documentCompileJob.update({
      where: { id: compileJobId },
      data: {
        status: CompileStatus.FAILED,
        finishedAt: new Date(),
        errorMessage: "Version has no latex source"
      }
    });
    await prisma.documentVersion.update({
      where: { id: documentVersionId },
      data: {
        compileStatus: CompileStatus.FAILED,
        compileLog: "Version has no latex source"
      }
    });
    return;
  }

  let workDir: string;
  if (version.latexWorkspacePath) {
    workDir = resolve(env.STORAGE_ROOT, version.latexWorkspacePath);
    await mkdir(workDir, { recursive: true });
  } else {
    workDir = resolve(tmpdir(), `latex-${documentVersionId}-${randomUUID()}`);
    await mkdir(workDir, { recursive: true });

    const zipPath = join(env.STORAGE_ROOT, version.latexBundleFile!.storagePath);
    const zipBuffer = await readFile(zipPath);
    const zip = new AdmZip(zipBuffer);
    zip.extractAllTo(workDir, true);
  }

  const compileResult = await compileLatex(workDir, version.latexEntryFile ?? "main.tex");

  let compiledPdfFileId: string | null = null;
  if (compileResult.status === CompileStatus.SUCCEEDED && compileResult.pdfPath) {
    const pdfBuffer = await readFile(compileResult.pdfPath);
    const relativePath = `compiled/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${version.id}.pdf`;
    await mkdir(join(env.STORAGE_ROOT, "compiled", new Date().toISOString().slice(0, 10)), { recursive: true });
    await writeFile(join(env.STORAGE_ROOT, relativePath), pdfBuffer);

    const fileObject = await prisma.fileObject.create({
      data: {
        storagePath: relativePath,
        originalName: `${version.id}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: BigInt(pdfBuffer.byteLength),
        uploadedById: version.createdById
      },
      select: { id: true }
    });

    compiledPdfFileId = fileObject.id;
  }

  await prisma.documentVersion.update({
    where: { id: version.id },
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
      userId: version.createdById,
      type: NotificationEventType.DOC_COMPILED,
      status: NotificationStatus.PENDING,
      payload: {
        documentVersionId,
        compileStatus: compileResult.status
      }
    }
  });
};
