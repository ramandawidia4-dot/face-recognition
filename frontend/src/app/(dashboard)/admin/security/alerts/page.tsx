"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import api from "@/lib/api";
import { useSecurityStore } from "@/stores/security-store";
import type { SecurityAlert, AlertSeverity, ApiResponse } from "@/types";

const severityColor: Record<AlertSeverity, "default" | "secondary" | "destructive"> = {
  info: "default",
  warning: "secondary",
  critical: "destructive",
};

export default function SecurityAlertsPage() {
  const [alerts, setAlerts] = useState<SecurityAlert[]>([]);
  const [severity, setSeverity] = useState<string>("");
  const [reviewed, setReviewed] = useState<string>("");
  const [selected, setSelected] = useState<SecurityAlert | null>(null);
  const unacknowledged = useSecurityStore((s) => s.unacknowledgedCritical);

  const fetchAlerts = () => {
    const params: Record<string, string> = {};
    if (severity) params.severity = severity;
    if (reviewed) params.reviewed = reviewed;
    api.get<ApiResponse<SecurityAlert[]>>("/security/alerts", { params }).then((res) => {
      setAlerts(res.data.data);
    }).catch(() => toast.error("Failed to load alerts"));
  };

  useEffect(() => { fetchAlerts(); }, []);

  const handleReview = async (id: string) => {
    try {
      await api.patch(`/security/alerts/${id}/review`, { notes: "Reviewed from dashboard" });
      toast.success("Alert reviewed");
      setSelected(null);
      fetchAlerts();
    } catch {
      toast.error("Failed to review alert");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Security Alerts</h1>
        {unacknowledged && (
          <Badge variant="destructive" className="animate-pulse">
            Critical Alert Active
          </Badge>
        )}
      </div>

      <Card>
        <CardHeader><CardTitle>Filters</CardTitle></CardHeader>
        <CardContent className="flex gap-4">
          <Select value={severity} onValueChange={setSeverity}>
            <SelectTrigger className="w-32"><SelectValue placeholder="Severity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">All</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>
          <Select value={reviewed} onValueChange={setReviewed}>
            <SelectTrigger className="w-32"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">All</SelectItem>
              <SelectItem value="true">Reviewed</SelectItem>
              <SelectItem value="false">Unreviewed</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={fetchAlerts}>Apply</Button>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {alerts.map((alert) => (
          <Card key={alert.id} className={alert.reviewed ? "opacity-60" : ""}>
            <CardContent className="flex items-center justify-between py-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant={severityColor[alert.severity]}>{alert.severity}</Badge>
                  <span className="font-medium text-sm">{alert.camera_name}</span>
                  {alert.face_known ? (
                    <span className="text-xs text-muted-foreground">Known: {alert.matched_user_name}</span>
                  ) : (
                    <span className="text-xs text-destructive">Unknown face</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Confidence: {(alert.confidence * 100).toFixed(0)}% | {new Date(alert.captured_at).toLocaleString()}
                </p>
              </div>
              <div className="flex gap-2">
                {alert.snapshot_jpeg && (
                  <Button size="sm" variant="outline" onClick={() => setSelected(alert)}>
                    View
                  </Button>
                )}
                {!alert.reviewed && (
                  <Button size="sm" onClick={() => handleReview(alert.id)}>
                    Review
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <AlertDialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Security Alert</AlertDialogTitle>
            <AlertDialogDescription>
              {selected?.camera_name} — {new Date(selected?.captured_at ?? "").toLocaleString()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {selected?.snapshot_jpeg && (
            <img src={selected.snapshot_jpeg} alt="Snapshot" className="rounded-lg border" />
          )}
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>Close</Button>
            {selected && !selected.reviewed && (
              <AlertDialogAction onClick={() => handleReview(selected.id)}>
                Mark Reviewed
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
