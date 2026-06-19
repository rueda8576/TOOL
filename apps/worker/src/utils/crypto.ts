import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

function getEncryptionKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

export function encryptValue(value: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${authTag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptValue(payload: string, secret: string): string {
  const [version, ivEncoded, authTagEncoded, encryptedEncoded] = payload.split(":");
  if (version !== "v1" || !ivEncoded || !authTagEncoded || !encryptedEncoded) {
    throw new Error("Unsupported encrypted payload format");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(secret),
    Buffer.from(ivEncoded, "base64url")
  );
  decipher.setAuthTag(Buffer.from(authTagEncoded, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedEncoded, "base64url")),
    decipher.final()
  ]);
  return decrypted.toString("utf8");
}
