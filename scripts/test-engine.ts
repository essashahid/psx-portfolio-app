import { psxDpsQuote, twelveDataQuote, finnhubQuote, alphaVantageQuote } from "@/lib/providers/adapters";
import { symbolVariants } from "@/lib/providers/types";

async function main() {
  const t = "MEBL";
  console.log("psx-dps:", JSON.stringify(await psxDpsQuote(t).catch((e) => String(e))));
  console.log("twelve-data:", JSON.stringify(await twelveDataQuote(t).catch((e) => String(e))));
  for (const s of symbolVariants(t, "finnhub")) {
    console.log(`finnhub[${s}]:`, JSON.stringify(await finnhubQuote(t, s).catch((e) => String(e))));
  }
  for (const s of symbolVariants(t, "alpha-vantage")) {
    console.log(`alpha-vantage[${s}]:`, JSON.stringify(await alphaVantageQuote(t, s).catch((e) => String(e))));
  }
}
main();
