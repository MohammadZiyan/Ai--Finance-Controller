import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMerchantName, normalizeReference } from "@/lib/finance/normalization";

test("merchant alias normalization", () => {
  assert.equal(normalizeMerchantName("AMZN WEB SERVICES INDIA PVT LTD"), "amazon web services");
  assert.equal(normalizeMerchantName("AWS INDIA"), "amazon web services");
  assert.equal(normalizeMerchantName("STRIPE PAYMENTS INDIA PVT LTD"), "stripe");
  assert.equal(normalizeMerchantName("RAZORPAY SOFTWARE PVT LTD"), "razorpay");
  assert.equal(normalizeMerchantName("OPENAI LLC"), "openai");
  assert.equal(normalizeMerchantName("SFDC INDIA"), "salesforce");
  assert.equal(normalizeMerchantName("SNOWFLAKE COMPUTING INC"), "snowflake");
});

test("reference normalization", () => {
  assert.equal(normalizeReference("AWS-82931"), "aws82931");
  assert.equal(normalizeReference(" INV-1001 "), "inv1001");
});
