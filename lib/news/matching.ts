export function matchesHoldingText(
  holding: { ticker: string; company_name: string | null },
  values: string[]
): boolean {
  const text = normalizeForMatch(values.join(" "));
  const compactText = text.replace(/\s+/g, "");
  const words = new Set(text.split(/\s+/).filter(Boolean));
  const ticker = normalizeForMatch(holding.ticker).replace(/\s+/g, "");

  if (ticker.length >= 5 ? compactText.includes(ticker) : words.has(ticker)) {
    return true;
  }

  for (const alias of companyAliases(holding.company_name)) {
    const normalizedAlias = normalizeForMatch(alias);
    if (!normalizedAlias) continue;
    const compactAlias = normalizedAlias.replace(/\s+/g, "");
    if (compactAlias.length >= 6 && compactText.includes(compactAlias)) {
      return true;
    }
  }

  return false;
}

export function companyAliases(companyName: string | null): string[] {
  if (!companyName) return [];

  const cleaned = companyName
    .replace(/\b(limited|ltd\.?|company|co\.?)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = normalizeForMatch(cleaned).split(/\s+/).filter(Boolean);
  const aliases = new Set([companyName, cleaned]);

  if (tokens.length >= 2) aliases.add(tokens.slice(0, 2).join(" "));
  if (tokens[0]?.length >= 5) aliases.add(tokens[0]);

  return [...aliases];
}

export function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
