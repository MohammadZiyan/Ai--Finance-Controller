const LEGAL_SUFFIXES = [
  "pvt ltd",
  "private limited",
  "limited",
  "ltd",
  "inc",
  "llc",
  "corp",
  "co",
  "india",
  "india pvt ltd",
];

const MERCHANT_ALIASES: Record<string, string> = {
  "aws": "amazon web services",
  "amzn web services": "amazon web services",
  "aws india": "amazon web services",
  "amazon web services india": "amazon web services",
  "ggl cloud": "google cloud",
  "google cloud platform": "google cloud",
  "meta ads": "meta platforms",
  "fb ads": "meta platforms",
  "azure": "microsoft azure",
  "msft azure": "microsoft azure",
  "azure india": "microsoft azure",
  "tata communications ltd": "tata communications",
  "zoho corporation": "zoho",
};

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeReference(reference: string | null | undefined): string {
  if (!reference) return "";
  return reference.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

export function normalizeMerchantName(input: string): string {
  let normalized = input.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  normalized = normalizeWhitespace(normalized);

  for (const suffix of LEGAL_SUFFIXES) {
    const regex = new RegExp(`\\b${suffix}\\b`, "g");
    normalized = normalized.replace(regex, " ");
  }

  normalized = normalizeWhitespace(normalized);

  const alias = MERCHANT_ALIASES[normalized];
  if (alias) return alias;

  const fuzzyAlias = Object.entries(MERCHANT_ALIASES).find(([key]) => normalized.includes(key));
  if (fuzzyAlias) return fuzzyAlias[1];

  return normalized;
}

export function extractReferenceFromText(text: string): string {
  const match = text.match(/[A-Z]{2,5}[- ]?\d{3,8}/i);
  return normalizeReference(match?.[0] ?? "");
}

export function tokenize(text: string): string[] {
  return normalizeMerchantName(text)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}
