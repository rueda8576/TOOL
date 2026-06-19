import AdmZip from "adm-zip";
import { mkdtemp, readFile, stat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { extractZipSafely } from "./safe-zip";

const makeZip = (
  entries: Array<{
    entryName: string;
    attr?: number;
    size?: number;
    isDirectory?: boolean;
    data?: Buffer;
  }>
): AdmZip =>
  ({
    getEntries: () =>
      entries.map((entry) => ({
        entryName: entry.entryName,
        isDirectory: entry.isDirectory ?? false,
        header: {
          attr: entry.attr ?? 0,
          size: entry.size ?? entry.data?.byteLength ?? 1
        },
        getData: () => entry.data ?? Buffer.from("content")
      }))
  }) as unknown as AdmZip;

describe("extractZipSafely", () => {
  it("extracts files and directories inside the target root", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlasium-zip-"));
    const zip = new AdmZip();
    zip.addFile("chapter/", Buffer.alloc(0));
    zip.addFile("chapter/main.tex", Buffer.from("content"));

    await extractZipSafely(zip, root);

    await expect(stat(join(root, "chapter"))).resolves.toEqual(expect.objectContaining({}));
    await expect(readFile(join(root, "chapter/main.tex"), "utf8")).resolves.toBe("content");
  });

  it("rejects archive entry paths that escape the target root", async () => {
    for (const entryName of ["/absolute.tex", "C:/absolute.tex", "../escape.tex", ""]) {
      await expect(
        extractZipSafely(makeZip([{ entryName }]), await mkdtemp(join(tmpdir(), "atlasium-zip-")))
      ).rejects.toThrow(
        "Invalid ZIP entry path"
      );
    }
  });

  it("rejects deeply nested, duplicate, symlink, oversized, and excessive-entry archives", async () => {
    const deepZip = new AdmZip();
    deepZip.addFile(`${Array.from({ length: 25 }, (_, index) => `d${index}`).join("/")}/main.tex`, Buffer.from("x"));
    await expect(extractZipSafely(deepZip, await mkdtemp(join(tmpdir(), "atlasium-zip-")))).rejects.toThrow(
      "ZIP entry path is too deep"
    );

    const duplicateZip = new AdmZip();
    duplicateZip.addFile("Main.tex", Buffer.from("a"));
    duplicateZip.addFile("main.tex", Buffer.from("b"));
    await expect(extractZipSafely(duplicateZip, await mkdtemp(join(tmpdir(), "atlasium-zip-")))).rejects.toThrow(
      "Duplicate ZIP entry path"
    );

    await expect(
      extractZipSafely(
        makeZip([{ entryName: "link.tex", attr: 0o120000 << 16 }]),
        await mkdtemp(join(tmpdir(), "atlasium-zip-"))
      )
    ).rejects.toThrow("ZIP archive contains unsupported symlinks");

    await expect(
      extractZipSafely(
        makeZip([{ entryName: "main.tex", size: 250 * 1024 * 1024 + 1 }]),
        await mkdtemp(join(tmpdir(), "atlasium-zip-"))
      )
    ).rejects.toThrow("ZIP archive is too large");

    const excessiveEntriesZip = new AdmZip();
    for (let index = 0; index < 2001; index += 1) {
      excessiveEntriesZip.addFile(`file-${index}.tex`, Buffer.from("x"));
    }
    await expect(
      extractZipSafely(excessiveEntriesZip, await mkdtemp(join(tmpdir(), "atlasium-zip-")))
    ).rejects.toThrow("ZIP archive contains too many files");
  });
});
