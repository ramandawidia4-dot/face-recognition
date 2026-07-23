"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import api from "@/lib/api";
import type { Leave, ApiResponse } from "@/types";

export default function AdminLeavesPage() {
  const [leaves, setLeaves] = useState<Leave[]>([]);

  const fetchLeaves = () => {
    api.get<ApiResponse<Leave[]>>("/leaves/all?limit=50").then((res) => {
      setLeaves(res.data.data);
    }).catch(() => toast.error("Failed to load leaves"));
  };

  useEffect(() => { fetchLeaves(); }, []);

  const handleAction = async (id: string, status: "approved" | "rejected") => {
    try {
      await api.patch(`/leaves/${id}`, { status });
      toast.success(`Leave ${status}`);
      fetchLeaves();
    } catch {
      toast.error(`Failed to ${status} leave`);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Leave Requests</h1>

      <Card>
        <CardHeader><CardTitle>All Requests</CardTitle></CardHeader>
        <CardContent>
          {leaves.length === 0 ? (
            <p className="text-sm text-muted-foreground">No leave requests</p>
          ) : (
            <div className="space-y-3">
              {leaves.map((l) => (
                <div key={l.id} className="flex items-center justify-between border-b pb-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{l.user?.full_name || "Unknown"}</span>
                      <Badge variant="outline" className="capitalize text-xs">{l.type}</Badge>
                      <Badge variant={
                        l.status === "approved" ? "default" :
                        l.status === "rejected" ? "destructive" : "secondary"
                      } className="text-xs">{l.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {l.start_date} → {l.end_date}
                    </p>
                    <p className="text-xs text-muted-foreground">{l.reason}</p>
                  </div>
                  {l.status === "pending" && (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => handleAction(l.id, "approved")}>Approve</Button>
                      <Button size="sm" variant="destructive" onClick={() => handleAction(l.id, "rejected")}>Reject</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
