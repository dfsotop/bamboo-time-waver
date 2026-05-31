import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getSettings, saveSettings } from "@/lib/bamboo/settings.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const fetchSettings = useServerFn(getSettings);
  const save = useServerFn(saveSettings);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => fetchSettings(),
  });

  const [form, setForm] = useState({
    subdomain: "",
    apiKey: "",
    clockin_start: "08:50",
    clockin_end: "09:10",
    clockout_start: "17:50",
    clockout_end: "18:30",
    enabled: true,
  });

  useEffect(() => {
    if (data?.settings) {
      setForm((f) => ({
        ...f,
        subdomain: data.settings!.subdomain,
        clockin_start: String(data.settings!.clockin_start).slice(0, 5),
        clockin_end: String(data.settings!.clockin_end).slice(0, 5),
        clockout_start: String(data.settings!.clockout_start).slice(0, 5),
        clockout_end: String(data.settings!.clockout_end).slice(0, 5),
        enabled: data.settings!.enabled,
        apiKey: "",
      }));
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: async () =>
      save({
        data: {
          subdomain: form.subdomain.trim(),
          apiKey: form.apiKey.trim() || undefined,
          clockin_start: form.clockin_start,
          clockin_end: form.clockin_end,
          clockout_start: form.clockout_start,
          clockout_end: form.clockout_end,
          enabled: form.enabled,
        },
      }),
    onSuccess: () => {
      toast.success("Settings saved");
      setForm((f) => ({ ...f, apiKey: "" }));
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    },
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  const hasKey = data?.hasApiKey ?? false;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Connect your BambooHR account and set your daily clock-in/out time ranges.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>BambooHR connection</CardTitle>
          <CardDescription>
            Account email <span className="font-medium text-foreground">{data?.email}</span> will be matched to your BambooHR employee record.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="subdomain">BambooHR subdomain</Label>
            <div className="flex items-center gap-2">
              <Input
                id="subdomain"
                value={form.subdomain}
                onChange={(e) => setForm({ ...form, subdomain: e.target.value })}
                placeholder="yourcompany"
              />
              <span className="text-sm text-muted-foreground">.bamboohr.com</span>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="apiKey">API key</Label>
            <Input
              id="apiKey"
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              placeholder={hasKey ? "•••••••••• (stored — leave blank to keep)" : "Paste your BambooHR API key"}
              autoComplete="off"
            />
            {hasKey && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <CheckCircle2 className="h-3 w-3 text-green-600" /> Key stored securely.
                Employee ID: <span className="font-mono">{data?.settings?.employee_id}</span>
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Get one from BambooHR: profile → API Keys → Add new key.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
          <CardDescription>
            A random time will be picked inside each range. Runs Mon–Fri at 10:00 Europe/Madrid.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Clock-in earliest</Label>
              <Input
                type="time"
                value={form.clockin_start}
                onChange={(e) => setForm({ ...form, clockin_start: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Clock-in latest</Label>
              <Input
                type="time"
                value={form.clockin_end}
                onChange={(e) => setForm({ ...form, clockin_end: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Clock-out earliest</Label>
              <Input
                type="time"
                value={form.clockout_start}
                onChange={(e) => setForm({ ...form, clockout_start: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Clock-out latest</Label>
              <Input
                type="time"
                value={form.clockout_end}
                onChange={(e) => setForm({ ...form, clockout_end: e.target.value })}
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Scheduler enabled</p>
              <p className="text-xs text-muted-foreground">When off, the daily cron will skip your account.</p>
            </div>
            <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </div>
  );
}
