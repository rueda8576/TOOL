import { AppController } from "./app.controller";

describe("AppController", () => {
  it("returns the API identity payload", () => {
    expect(new AppController().root()).toEqual({
      name: "doctoral-platform-api",
      version: "0.1.0"
    });
  });
});
