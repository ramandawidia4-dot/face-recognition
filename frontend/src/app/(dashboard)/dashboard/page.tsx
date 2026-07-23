"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useRealtimeStore } from "@/stores/realtime-store";
import { useAuthStore } from "@/stores/auth-store";
import api from "@/lib/api";

interface TodayAttendance {
  checked_in: boolean;
  checked_out: boolean;
  attendance: {
    id: string;
    check_in: string;
    check_out: string | null;
    status: string;
  } | null;
}

export default function DashboardPage() {
  const { user } = useAuthStore();
  const { recentAttendances } = useRealtimeStore();
  const [today, setToday] = useState<TodayAttendance | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/attendance/today").then((res) => {
      setToday(res.data.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Status</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : today?.checked_in ? (
              <div className="space-y-1">
                <Badge variant={today.checked_out ? "secondary" : "default"}>
                  {today.checked_out ? "Checked Out" : "Checked In"}
                </Badge>
                <p className="text-xs text-muted-foreground">
                  In: {today.attendance ? new Date(today.attendance.check_in).toLocaleTimeString() : "-"}
                  {today.attendance?.check_out && (
                    <> | Out: {new Date(today.attendance.check_out).toLocaleTimeString()}</>
                  )}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Not checked in today</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Role</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="outline">{user?.role}</Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Recent Events</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{recentAttendances.length}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Attendance</CardTitle>
        </CardHeader>
        <CardContent>
          {recentAttendances.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent events</p>
          ) : (
            <div className="space-y-2">
              {recentAttendances.slice(0, 10).map((event, i) => (
                <div key={`${event.attendance_id}-${i}`} className="flex items-center justify-between text-sm">
                  <span className="font-medium">{event.full_name}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant={event.status === "late" ? "destructive" : "secondary"}>
                      {event.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
