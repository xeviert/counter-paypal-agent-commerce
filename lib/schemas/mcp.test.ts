import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createCheckoutInput,
  createCheckoutOutput,
  getOrderStatusInput,
  getOrderStatusOutput,
  getProductInput,
  getProductOutput,
  mcpError,
  searchProductsInput,
  searchProductsOutput,
} from "./mcp";

const schemas = {
  searchProductsInput,
  searchProductsOutput,
  getProductInput,
  getProductOutput,
  createCheckoutInput,
  createCheckoutOutput,
  getOrderStatusInput,
  getOrderStatusOutput,
  mcpError,
};

const productId = "2f1c6a1e-8a2b-4c3d-9e4f-5a6b7c8d9e0f";
const token = "q8Vb3xYz0123456789_-AB";
const usd = (value: string) => ({ currency: "USD", value });

describe("MCP schemas", () => {
  // Mirrors what the SDK does for tools/list.
  it.each(Object.entries(schemas))("%s converts to JSON Schema", (_, schema) => {
    expect(() => z.toJSONSchema(schema, { io: "input" })).not.toThrow();
    expect(() => z.toJSONSchema(schema, { io: "output" })).not.toThrow();
  });

  it("applies input defaults", () => {
    expect(searchProductsInput.parse({ query: "rug" }).limit).toBe(10);
    expect(createCheckoutInput.parse({ productId, buyerCountry: "DE" }).quantity).toBe(1);
  });

  it("rejects bad checkout input", () => {
    expect(createCheckoutInput.safeParse({ productId, buyerCountry: "de" }).success).toBe(false);
    expect(createCheckoutInput.safeParse({ productId, buyerCountry: "DE", quantity: 0 }).success).toBe(false);
    expect(createCheckoutInput.safeParse({ productId, buyerCountry: "DE", quantity: 1.5 }).success).toBe(false);
    expect(createCheckoutInput.safeParse({ productId: "abc", buyerCountry: "DE" }).success).toBe(false);
    expect(createCheckoutInput.safeParse({ productId }).success).toBe(false);
  });

  it("drops unknown input fields, so agents can't smuggle in a price", () => {
    const parsed = createCheckoutInput.parse({ productId, buyerCountry: "DE", price: "0.01" });
    expect(parsed).not.toHaveProperty("price");
  });

  it("accepts a checkout result", () => {
    const result = createCheckoutOutput.parse({
      approvalUrl: "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T",
      statusToken: token,
      statusUrl: `https://counter.example/o/${token}`,
      quantity: 1,
      unitPrice: usd("150.00"),
      totals: { item: usd("150.00"), shipping: usd("25.00"), total: usd("175.00") },
      expiresAt: "2026-10-27T18:00:00.000Z",
    });
    expect(result.totals.total.value).toBe("175.00");
  });

  it("accepts a product with native listing and approximate local price", () => {
    const result = getProductOutput.safeParse({
      product: {
        productId,
        title: "Handwoven rug",
        category: "textiles",
        price: usd("150.00"),
        approxLocalPrice: { currency: "MXN", value: "2950.00", approx: true },
        shipping: { region: "eu", amount: usd("25.00") },
        inStock: true,
        negotiable: true,
        maker: { name: "Ana", country: "MX", locality: "Oaxaca" },
        url: "https://counter.example/p/handwoven-rug",
        available: 2,
        language: "es",
        en: { title: "Handwoven rug", description: "Wool" },
        native: { title: "Tapete", description: "Lana" },
        photoUrls: ["https://counter.example/api/photos/1"],
      },
    });
    expect(result.success).toBe(true);
  });

  it("only allows known error codes", () => {
    expect(mcpError.safeParse({ error: { code: "OUT_OF_STOCK", message: "Sold out" } }).success).toBe(true);
    expect(mcpError.safeParse({ error: { code: "NOPE", message: "x" } }).success).toBe(false);
  });
});
