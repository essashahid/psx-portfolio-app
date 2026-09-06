import {
  ANALYST_ONLY_RATIOS,
  groupRatiosForReader as sharedGroupRatiosForReader,
} from "@psx/shared/company/ratio-groups";

export { ANALYST_ONLY_RATIOS };

/**
 * The ratio card for a reader rather than an analyst, from the shared helper
 * so the web and the phone fold the same rows away.
 *
 * The one thing done here: the company route types a ratio's value as
 * number, string or null, while the shared helper is written for the numeric
 * case. A string value is rare and never a figure a reader compares, so it is
 * passed through under the numeric type and lands wherever its group lands.
 */
export function groupRatiosForReader<T extends { name: string; value: number | string | null }>(
  ratios: T[]
): { groups: { title: string; rows: T[] }[]; analyst: T[] } {
  return sharedGroupRatiosForReader(ratios as Array<T & { value: number | null }>);
}
