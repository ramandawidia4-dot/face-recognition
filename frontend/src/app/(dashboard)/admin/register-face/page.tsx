"use client";

import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import api from "@/lib/api";

export default function RegisterFacePage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [streaming, setStreaming] = useState(false);
  const [captured, setCaptured] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setStreaming(true);
      }
    } catch {
      toast.error("Camera access denied");
    }
  };

  const capture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx?.drawImage(video, 0, 0);
    setCaptured(canvas.toDataURL("image/jpeg", 0.8));
  };

  const stopCamera = () => {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    setStreaming(false);
  };

  const submit = async () => {
    if (!captured) return;
    setSubmitting(true);
    try {
      await api.post("/cameras/faces/me", { photo: captured });
      toast.success("Face registered successfully");
      setCaptured(null);
      stopCamera();
    } catch {
      toast.error("Failed to register face");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Register Face</h1>

      <Card>
        <CardHeader>
          <CardTitle>Capture Photo</CardTitle>
          <CardDescription>Position your face clearly in the frame</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative mx-auto aspect-video max-w-md overflow-hidden rounded-lg bg-muted">
            <video ref={videoRef} autoPlay playsInline className="h-full w-full object-cover" />
            <canvas ref={canvasRef} className="hidden" />
            {captured && (
              <img src={captured} alt="captured" className="absolute inset-0 h-full w-full object-cover" />
            )}
          </div>

          <div className="flex justify-center gap-2">
            {!streaming ? (
              <Button onClick={startCamera}>Start Camera</Button>
            ) : (
              <>
                <Button onClick={capture} disabled={!!captured}>Capture</Button>
                <Button variant="secondary" onClick={() => { stopCamera(); setCaptured(null); }}>Cancel</Button>
              </>
            )}
            {captured && (
              <Button onClick={submit} disabled={submitting}>
                {submitting ? "Registering..." : "Register Face"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
