'use client';

import React, { useEffect } from 'react';
import { ShieldAlert, AlertOctagon, CheckCircle2, Clock, Camera } from 'lucide-react';
import { useSecurityStore } from '@/stores/security-store';
import { formatDateTime } from '@/lib/utils';

export function CriticalAlertModal() {
  const { criticalAlert, setCriticalAlert } = useSecurityStore();

  useEffect(() => {
    if (criticalAlert) {
      // Synthesize alert sound if browser allows
      try {
        const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(880, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.5);
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.5);
      } catch {
        // Audio playback restricted by browser policy
      }
    }
  }, [criticalAlert]);

  if (!criticalAlert) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-slate-900 border-4 border-red-600 shadow-2xl shadow-red-950/50 critical-flash-border">
        {/* Header Banner */}
        <div className="flex items-center gap-3 p-4 bg-red-600 text-white">
          <AlertOctagon className="w-7 h-7 animate-bounce" />
          <div>
            <h3 className="text-lg font-extrabold uppercase tracking-wide">CRITICAL SECURITY ALERT</h3>
            <p className="text-xs text-red-100 font-medium">Unidentified Person Detected in Restrained Area</p>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4">
          <div className="flex flex-col items-center">
            {criticalAlert.snapshot_jpeg ? (
              <div className="relative group rounded-xl overflow-hidden border-2 border-red-500/50 bg-slate-950 p-1">
                <img
                  src={
                    criticalAlert.snapshot_jpeg.startsWith('data:')
                      ? criticalAlert.snapshot_jpeg
                      : `data:image/jpeg;base64,${criticalAlert.snapshot_jpeg}`
                  }
                  alt="Stranger Face"
                  className="w-48 h-48 object-cover rounded-lg"
                />
                <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-red-950/90 text-red-300 text-[10px] font-mono border border-red-700/50">
                  CONFIDENCE: {(criticalAlert.confidence * 100).toFixed(1)}%
                </span>
              </div>
            ) : (
              <div className="w-48 h-48 rounded-xl bg-slate-800 border border-slate-700 flex flex-col items-center justify-center text-slate-400">
                <Camera className="w-10 h-10 mb-2" />
                <span className="text-xs">No snapshot preview</span>
              </div>
            )}
          </div>

          <div className="space-y-2 rounded-xl bg-slate-950 p-4 border border-slate-800 text-sm">
            <div className="flex items-center justify-between text-slate-300">
              <span className="flex items-center gap-2 text-slate-400">
                <ShieldAlert className="w-4 h-4 text-red-400" />
                Camera Zone:
              </span>
              <span className="font-semibold text-white">{criticalAlert.camera_name}</span>
            </div>

            <div className="flex items-center justify-between text-slate-300">
              <span className="flex items-center gap-2 text-slate-400">
                <Clock className="w-4 h-4 text-slate-400" />
                Time:
              </span>
              <span className="font-mono text-xs text-slate-300">{formatDateTime(criticalAlert.captured_at)}</span>
            </div>

            <div className="flex items-center justify-between text-slate-300">
              <span className="text-slate-400">Match Result:</span>
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-red-950 text-red-300 border border-red-800">
                Unknown Stranger
              </span>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-950/50 border-t border-slate-800 flex justify-end">
          <button
            onClick={() => setCriticalAlert(null)}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold shadow-lg shadow-red-900/30 transition-all duration-200 cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            Acknowledge Alert
          </button>
        </div>
      </div>
    </div>
  );
}
