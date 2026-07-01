type ProfileInput = {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  industry?: string | null;
  exchange?: string | null;
  faceValue?: number | null;
};

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed : null;
}

function sentenceList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

export function buildExchangeSourcedProfile(input: ProfileInput) {
  const ticker = input.ticker.toUpperCase();
  const companyName = clean(input.companyName) ?? ticker;
  const sector = clean(input.sector);
  const industry = clean(input.industry) ?? sector;
  const exchange = clean(input.exchange) ?? "PSX";
  const faceValue = typeof input.faceValue === "number" && Number.isFinite(input.faceValue)
    ? input.faceValue
    : null;

  const facts = [
    `listed on the Pakistan Stock Exchange under the ticker ${ticker}`,
    sector ? `classified by the exchange in the ${sector} sector` : null,
    faceValue !== null ? `recorded with a face value of PKR ${faceValue.toLocaleString("en-PK")}` : null,
  ].filter((part): part is string => Boolean(part));

  const description = `${companyName} is ${sentenceList(facts)}. This profile is based on exchange reference data and does not add unsourced product, customer, market, or management claims.`;

  return {
    description,
    industry: industry ?? undefined,
    business_lines: sector ? [sector] : undefined,
    exchange,
  };
}
