import { decryptValue, encryptValue, generateSecureToken, hashValue } from "./crypto";

describe("crypto helpers", () => {
  it("hashes values deterministically", () => {
    expect(hashValue("atlasium")).toBe(hashValue("atlasium"));
    expect(hashValue("atlasium")).not.toBe(hashValue("gitlab"));
  });

  it("generates hex tokens with the requested size", () => {
    const token = generateSecureToken(12);

    expect(token).toMatch(/^[a-f0-9]+$/);
    expect(token).toHaveLength(24);
  });

  it("encrypts and decrypts values symmetrically", () => {
    const encrypted = encryptValue("secret payload", "top-secret-key");

    expect(encrypted).toMatch(/^v1:/);
    expect(decryptValue(encrypted, "top-secret-key")).toBe("secret payload");
  });

  it("rejects malformed encrypted payloads", () => {
    expect(() => decryptValue("bad-payload", "top-secret-key")).toThrow(
      "Unsupported encrypted payload format"
    );
  });
});
