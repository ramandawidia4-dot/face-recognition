"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import api from "@/lib/api";
import type { Attendance, ApiResponse } from "@/types";

export default function AdminReportsPage() {
  const [attendances, setAttendances] = useState<Attendance[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState<string>("");

  const fetchReports = () => {
    const params: Record<string, string> = {};
    if (from) params.from = from;
    if (to) params.to = to;
    if (status) params.status = status;
    api.get<ApiResponse<Attendance[]>>("/attendance/all", { params }).then((res) => {
      setAttendances(res.data.data);
    }).catch(() => toast.error("Failed to load reports"));
  };

  useEffect(() => { fetchReports(); }, []);

  const statusColor = (s: string) => {
    switch (s) {
      case "present": return "default";
      case "late": return "destructive";
      case "half_day": return "secondary";
      default: return "outline";
    }
  } as const;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Reports</h1>

      <Card>
        <CardHeader><CardTitle>Filters</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          <div className="space-y-1">
            <label className="text-xs font-medium">From</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">To</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Status</label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-32"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">All</SelectItem>
                <SelectItem value="present">Present</SelectItem>
                <SelectItem value="late">Late</SelectItem>
                <SelectItem value="half_day">Half Day</SelectItem>
                <SelectItem value="absent">Absent</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={fetchReports} className="self-end">Apply</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Attendance Records</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Check In</TableHead>
                <TableHead>Check Out</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attendances.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.user?.full_name || "-"}</TableCell>
                  <TableCell>{new Date(a.date).toLocaleDateString()}</TableCell>
                  <TableCell>{a.check_in ? new Date(a.check_in).toLocaleTimeString() : "-"}</TableCell>
                  <TableCell>{a.check_out ? new Date(a.check_out).toLocaleTimeString() : "-"}</TableCell>
                  <TableCell><Badge variant={statusColor(a.status)}>{a.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
