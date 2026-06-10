import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { ImportWizard } from "@/components/import-wizard";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: batches } = await supabase
    .from("import_batches")
    .select("id, statement_type, status, total_rows, accepted_rows, rejected_rows, duplicate_rows, created_at, uploaded_statements(file_name, file_type)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(15);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Import Center"
        description="Bring in AKD/CDC statements without sharing any credentials. Every file goes through preview and confirmation before it touches your portfolio."
      />
      <ImportWizard />

      <Card>
        <CardHeader>
          <CardTitle>Import history</CardTitle>
          <CardDescription>Recent statement imports and their outcomes.</CardDescription>
        </CardHeader>
        <CardContent>
          {(batches ?? []).length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">No imports yet.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH>File</TH>
                  <TH>Type</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Rows</TH>
                  <TH className="text-right">Accepted</TH>
                  <TH className="text-right">Rejected</TH>
                  <TH className="text-right">Duplicates</TH>
                </TR>
              </THead>
              <TBody>
                {(batches ?? []).map((b) => {
                  const stmt = Array.isArray(b.uploaded_statements)
                    ? b.uploaded_statements[0]
                    : b.uploaded_statements;
                  return (
                    <TR key={b.id}>
                      <TD className="text-xs">{b.created_at.slice(0, 16).replace("T", " ")}</TD>
                      <TD className="max-w-[220px] truncate text-xs">{stmt?.file_name ?? "—"}</TD>
                      <TD><Badge variant="outline">{b.statement_type}</Badge></TD>
                      <TD>
                        <Badge variant={b.status === "committed" ? "green" : b.status === "preview" ? "amber" : "secondary"}>
                          {b.status}
                        </Badge>
                      </TD>
                      <TD className="text-right text-xs">{b.total_rows}</TD>
                      <TD className="text-right text-xs">{b.accepted_rows}</TD>
                      <TD className="text-right text-xs">{b.rejected_rows}</TD>
                      <TD className="text-right text-xs">{b.duplicate_rows}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
