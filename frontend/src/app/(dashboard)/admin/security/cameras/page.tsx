"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import api from "@/lib/api";
import type { SecurityCamera, CameraSource, ApiResponse } from "@/types";

export default function SecurityCamerasPage() {
  const [cameras, setCameras] = useState<SecurityCamera[]>([]);

  const fetchCameras = () => {
    api.get<ApiResponse<SecurityCamera[]>>("/security/cameras").then((res) => {
      setCameras(res.data.data);
    }).catch(() => toast.error("Failed to load security cameras"));
  };

  useEffect(() => { fetchCameras(); }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Security Cameras</h1>

      <Card>
        <CardHeader><CardTitle>Server Room Cameras</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cameras.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No security cameras registered
                  </TableCell>
                </TableRow>
              ) : (
                cameras.map((cam) => (
                  <TableRow key={cam.id}>
                    <TableCell className="font-medium">{cam.name}</TableCell>
                    <TableCell><Badge variant="outline">{cam.source}</Badge></TableCell>
                    <TableCell>{cam.location || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={cam.is_active ? "default" : "secondary"}>
                        {cam.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
