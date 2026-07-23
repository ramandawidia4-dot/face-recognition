"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import api from "@/lib/api";
import { useRealtimeStore } from "@/stores/realtime-store";
import type { Camera, CameraSource } from "@/types";

const stateColor: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  RUNNING: "default",
  STOPPED: "secondary",
  CONNECTING: "outline",
  ERROR: "destructive",
};

export default function AdminCamerasPage() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const cameraStates = useRealtimeStore((s) => s.cameraStates);

  const fetchCameras = () => {
    api.get("/cameras").then((res) => {
      setCameras(res.data.data);
    }).catch(() => toast.error("Failed to load cameras"));
  };

  useEffect(() => { fetchCameras(); }, []);

  const handleStart = async (id: string) => {
    try {
      await api.post(`/cameras/${id}/start`);
      toast.success("Camera started");
    } catch { toast.error("Failed to start camera"); }
  };

  const handleStop = async (id: string) => {
    try {
      await api.post(`/cameras/${id}/stop`);
      toast.success("Camera stopped");
    } catch { toast.error("Failed to stop camera"); }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Cameras</h1>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {cameras.map((cam) => {
          const state = cameraStates[cam.id]?.state || cam.state || "STOPPED";
          return (
            <Card key={cam.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">{cam.name}</CardTitle>
                  <Badge variant={stateColor[state] || "outline"}>{state}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-2">
                  {cam.source} | {cam.location || "No location"}
                </p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => handleStart(cam.id)} disabled={state === "RUNNING"}>
                    Start
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => handleStop(cam.id)} disabled={state === "STOPPED"}>
                    Stop
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
