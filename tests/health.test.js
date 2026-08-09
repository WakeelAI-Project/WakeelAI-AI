import request from "supertest";
import app from "../src/app.js";

describe("GET /health", () => {
  it("should return HTTP 200 and the expected JSON response", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      service: "wakeel-ai"
    });
  });
});
