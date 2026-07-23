"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import api from "@/lib/api";
import type { Leave, LeaveType, ApiResponse } from "@/types";

const statusColor: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
};

export default function LeavePage() {
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState<LeaveType>("annual");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");

  const fetchLeaves = () => {
    api.get<ApiResponse<Leave[]>>("/leaves?limit=20").then((res) => {
      setLeaves(res.data.data);
    }).catch(() => toast.error("Failed to load leaves"));
  };

  useEffect(() => { fetchLeaves(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/leaves", { type, start_date: startDate, end_date: endDate, reason });
      toast.success("Leave request submitted");
      setShowForm(false);
      setReason("");
      fetchLeaves();
    } catch {
      toast.error("Failed to submit leave");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Leave</h1>
        <Button onClick={() => setShowForm(!showForm)}>
          {showForm ? "Cancel" : "Request Leave"}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader><CardTitle>New Leave Request</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Type</label>
                <Select value={type} onValueChange={(v) => setType(v as LeaveType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="annual">Annual</SelectItem>
                    <SelectItem value="sick">Sick</SelectItem>
                    <SelectItem value="personal">Personal</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Start Date</label>
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">End Date</label>
                  <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Reason</label>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} required placeholder="Reason for leave" />
              </div>
              <Button type="submit">Submit</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Leave History</CardTitle></CardHeader>
        <CardContent>
          {leaves.length === 0 ? (
            <p className="text-sm text-muted-foreground">No leave records</p>
          ) : (
            <div className="space-y-2">
              {leaves.map((l) => (
                <div key={l.id} className="flex items-center justify-between border-b pb-2 text-sm">
                  <div>
                    <p className="font-medium capitalize">{l.type}</p>
                    <p className="text-xs text-muted-foreground">
                      {l.start_date} → {l.end_date}
                    </p>
                    <p className="text-xs text-muted-foreground">{l.reason}</p>
                  </div>
                  <Badge variant={statusColor[l.status] || "outline"}>{l.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
