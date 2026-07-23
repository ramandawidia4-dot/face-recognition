"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import api from "@/lib/api";
import type { Attendance, ApiResponse } from "@/types";

export default function AttendancePage() {
  const [attendances, setAttendances] = useState<Attendance[]>([]);
  const [today, setToday] = useState<{ checked_in: boolean; checked_out: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = () => {
    Promise.all([
      api.get<ApiResponse<Attendance[]>>("/attendance?limit=20"),
      api.get<ApiResponse<{ checked_in: boolean; checked_out: boolean }>>("/attendance/today"),
    ]).then(([histRes, todayRes]) => {
      setAttendances(histRes.data.data);
      setToday(todayRes.data.data);
    }).catch(() => {
      toast.error("Failed to load attendance data");
    }).finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

  const handleCheckIn = async () => {
    try {
      await api.post("/attendance/check-in");
      toast.success("Check-in successful");
      fetchData();
    } catch {
      toast.error("Check-in failed");
    }
  };

  const handleCheckOut = async () => {
    try {
      await api.post("/attendance/check-out");
      toast.success("Check-out successful");
      fetchData();
    } catch {
      toast.error("Check-out failed");
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "present": return "default";
      case "late": return "destructive";
      case "half_day": return "secondary";
      default: return "outline";
    }
  } as const;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Attendance</h1>

      <Card>
        <CardHeader>
          <CardTitle>Today</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          {!today?.checked_in ? (
            <Button onClick={handleCheckIn} disabled={loading}>Check In</Button>
          ) : !today?.checked_out ? (
            <Button onClick={handleCheckOut} variant="secondary" disabled={loading}>Check Out</Button>
          ) : (
            <p className="text-sm text-muted-foreground">All done for today</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent>
          {attendances.length === 0 ? (
            <p className="text-sm text-muted-foreground">No attendance records</p>
          ) : (
            <div className="space-y-2">
              {attendances.map((a) => (
                <div key={a.id} className="flex items-center justify-between border-b pb-2 text-sm">
                  <div>
                    <p className="font-medium">{new Date(a.date).toLocaleDateString()}</p>
                    <p className="text-xs text-muted-foreground">
                      In: {a.check_in ? new Date(a.check_in).toLocaleTimeString() : "-"}
                      {" | "}
                      Out: {a.check_out ? new Date(a.check_out).toLocaleTimeString() : "-"}
                    </p>
                  </div>
                  <Badge variant={statusColor(a.status)}>{a.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
