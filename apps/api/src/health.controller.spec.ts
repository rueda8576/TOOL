import { HealthController } from "./health.controller";

describe("HealthController", () => {
  it("returns an ok status and ISO timestamp", () => {
    const result = new HealthController().health();

    expect(result.status).toBe("ok");
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });
});
