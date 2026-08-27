/**
 * The contract for GET /api/alerts.
 *
 * Severity is carried as the same three levels the web app uses, so a warning
 * looks like a warning in both places. The mobile list shows open alerts by
 * default; history is available but is not what someone opens a phone for.
 */

export type AlertSeverity = "info" | "warning" | "critical";
export type AlertStatus = "open" | "dismissed" | "resolved";

export interface AlertRow {
  id: string;
  ticker: string | null;
  alertType: string;
  severity: AlertSeverity;
  title: string;
  message: string | null;
  status: AlertStatus;
  createdAt: string;
}

export interface AlertsResponse {
  rows: AlertRow[];
  openCount: number;
}
