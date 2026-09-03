import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMerchantName, normalizeReference } from "@/lib/finance/normalization";

test("merchant alias normalization", () => {
  assert.equal(normalizeMerchantName("AMZN WEB SERVICES INDIA PVT LTD"), "amazon web services");
  assert.equal(normalizeMerchantName("AWS INDIA"), "amazon web services");
});

test("reference normalization", () => {
  assert.equal(normalizeReference("AWS-82931"), "aws82931");
  assert.equal(normalizeReference(" INV-1001 "), "inv1001");
});
