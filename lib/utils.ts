import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatMoney(value: number | null | undefined, currency = "PKR"): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${currency} ${value.toLocaleString("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-PK", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

export function formatPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "" : ""}${value.toFixed(digits)}%`;
}

export function formatSignedPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

/**
 * Normalize a ratio-engine `source_period` ("2025 FY", "2026 9M",
 * "2025 FY / 2026 9M", "2025 FY vs 2024 FY", "Last 12 months") into a
 * consistent human label ("FY2025", "9M FY2026", ...). Used by the company
 * header and the Overview so the same metric reads the same way everywhere.
 */
export function formatFinancialPeriod(period: string | null | undefined): string | null {
  if (!period) return null;
  const token = (raw: string): string => {
    const t = raw.trim();
    if (!t) return t;
    const m = t.match(/^(\d{4})\s+(.+)$/);
    if (!m) return t;
    const [, year, rest] = m;
    const kind = rest.trim();
    if (/^(fy|annual|full year)$/i.test(kind)) return `FY${year}`;
    // Interim/quarterly markers (9M, Q3, H1, ...) read better leading the year.
    return `${kind.toUpperCase()} FY${year}`;
  };
  return period
    .split(/\s+(\/|vs)\s+/)
    .map((part) => (part === "/" || part === "vs" ? part : token(part)))
    .join(" ");
}

export function plColor(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return "text-muted-foreground";
  return value > 0 ? "text-emerald-600" : "text-red-600";
}

export function parseNumberLoose(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  let s = String(input).trim();
  if (!s || s === "-" || s.toLowerCase() === "n/a") return null;
  // (1,234.50) -> -1234.50 ; strip currency text and commas
  const negative = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[()]/g, "").replace(/(pkr|rs\.?|₨)/gi, "").replace(/,/g, "").replace(/^-/, "").trim();
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

const DATE_FORMATS_HINT =
  /^(\d{4}-\d{2}-\d{2})|(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})|(\d{1,2}\s*[A-Za-z]{3,9}[\s,-]*\d{2,4})$/;

export function parseDateLoose(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    return input.toISOString().slice(0, 10);
  }
  // Excel serial date
  if (typeof input === "number" && input > 20000 && input < 80000) {
    const d = new Date(Math.round((input - 25569) * 86400 * 1000));
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(input).trim();
  if (!s || !DATE_FORMATS_HINT.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  // ISO
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // dd/mm/yyyy or dd-mm-yyyy (PK convention: day first)
  const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (dmy) {
    const [, d, m] = dmy;
    let y = dmy[3];
    if (y.length === 2) y = `20${y}`;
    const day = parseInt(d, 10);
    const month = parseInt(m, 10);
    if (month > 12 && day <= 12) {
      // actually mm/dd
      return `${y}-${String(day).padStart(2, "0")}-${String(month).padStart(2, "0")}`;
    }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    return null;
  }
  const d2 = new Date(s);
  return Number.isNaN(d2.getTime()) ? null : d2.toISOString().slice(0, 10);
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
  ].join("\n");
}

export const DISCLAIMER =
  "This platform is for personal portfolio tracking and research support only. It is not financial advice.";
