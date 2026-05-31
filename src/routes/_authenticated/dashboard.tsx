import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getHistory } from "@/lib/bamboo/history.functions";
import { getSettings } from "@/lib/bamboo/settings.functions";
import { runNow, retryExecution } from "@/lib/bamboo/run.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Play, RotateCw } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

const STATUS_LABEL: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  success: { label: "Success", variant: "default" },
  skipped_holiday: { label: "Holiday", variant: "secondary" },
  skipped_timeoff: { label: "Time off", variant: "secondary" },
  skipped_existing: { label: "Already logged", variant: "secondary" },
  skipped_weekend: { label: "Weekend", variant: "secondary" },
  failed: { label: "Failed", variant: "destructive" },
};

function DashboardPage() {
  const fetchHistory = useServerFn(getHistory);
  const fetchSettings = useServerFn(getSettings);
  const runNowFn = useServerFn(runNow);
  const retryFn = useServerFn(retryExecution);
  const qc = useQueryClient();

  const settings = useQuery({ queryKey: ["settings"], queryFn: () => fetchSettings() });
  const history = useQuery({ queryKey: ["history"], queryFn: () => fetchHistory() });

  const runMutation = useMutation({
    mutationFn: () => runNowFn(),
    onSuccess: (r: { status: string }) => {
      toast.success(`Run complete: ${r.status}`);
      qc.invalidateQueries({ queryKey: ["history"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Run failed"),
  });

  const retryMutation = useMutation({
    mutationFn: (historyId: string) => retryFn({ data: { historyId } }),
    onSuccess: (r: { status: string }) => {
      toast.success(`Retry complete: ${r.status}`);
      qc.invalidateQueries({ queryKey: ["history"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Retry failed"),
  });

  const isConfigured = Boolean(settings.data?.hasApiKey);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Daily auto clock-in for BambooHR, weekdays at 10:00 Europe/Madrid.
          </p>
        </div>
        <Button
          onClick={() => runMutation.mutate()}
          disabled={!isConfigured || runMutation.isPending}
        >
          <Play className="mr-2 h-4 w-4" />
          {runMutation.isPending ? "Running…" : "Run now"}
        </Button>
      </div>

      {!isConfigured && (
        <Card>
          <CardHeader>
            <CardTitle>Get started</CardTitle>
            <CardDescription>
              Connect your BambooHR account in{" "}
              <Link to="/settings" className="text-primary underline">
                Settings
              </Link>{" "}
              to enable the daily scheduler.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {isConfigured && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Subdomain</CardDescription>
              <CardTitle className="text-lg">{settings.data?.settings?.subdomain}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Clock-in window</CardDescription>
              <CardTitle className="text-lg">
                {String(settings.data?.settings?.clockin_start).slice(0, 5)} –{" "}
                {String(settings.data?.settings?.clockin_end).slice(0, 5)}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Clock-out window</CardDescription>
              <CardTitle className="text-lg">
                {String(settings.data?.settings?.clockout_start).slice(0, 5)} –{" "}
                {String(settings.data?.settings?.clockout_end).slice(0, 5)}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Execution history</CardTitle>
          <CardDescription>Most recent runs first. Retry any failed execution.</CardDescription>
        </CardHeader>
        <CardContent>
          {history.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (history.data?.history ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No executions yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Times</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.data!.history.map((row) => {
                  const meta = STATUS_LABEL[row.status] ?? {
                    label: row.status,
                    variant: "outline" as const,
                  };
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(row.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell>{row.run_date}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.planned_clock_in && row.planned_clock_out
                          ? `${String(row.planned_clock_in).slice(0, 5)} → ${String(row.planned_clock_out).slice(0, 5)}`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-xs">{row.triggered_by}</TableCell>
                      <TableCell>
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-xs text-muted-foreground" title={row.error ?? ""}>
                        {row.error ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.status === "failed" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => retryMutation.mutate(row.id)}
                            disabled={retryMutation.isPending}
                          >
                            <RotateCw className="mr-1 h-3 w-3" /> Retry
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
