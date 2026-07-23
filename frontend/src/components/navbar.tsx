'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Sun, Moon, ShieldAlert, Wifi, UserCheck } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { useSecurityStore } from '@/stores/security-store';

export function Navbar() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { user } = useAuth();
  const { unreviewedCount } = useSecurityStore();

  const getPageTitle = (path: string) => {
    switch (path) {
      case '/dashboard':
        return 'Dashboard Monitoring';
      case '/attendance':
        return 'Riwayat Presensi & Manual Check-in';
      case '/leave':
        return 'Pengajuan & Riwayat Cuti';
      case '/admin/users':
        return 'Manajemen Karyawan & User';
      case '/admin/cameras':
        return 'Kamera Presensi & Live Control';
      case '/admin/security/cameras':
        return 'Kamera Keamanan Server Room';
      case '/admin/security/alerts':
        return 'Review Log Security Alert';
      case '/admin/leaves':
        return 'Persetujuan Pengajuan Cuti';
      case '/admin/reports':
        return 'Laporan Rekap Absensi Karyawan';
      case '/admin/register-face':
        return 'Registrasi Embedding Wajah Karyawan';
      default:
        return 'Sistem Absensi Face Recognition';
    }
  };

  return (
    <header className="h-16 shrink-0 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 px-6 flex items-center justify-between sticky top-0 z-30">
      {/* Page Title & Breadcrumb */}
      <div>
        <h1 className="text-lg font-bold text-white tracking-wide">{getPageTitle(pathname)}</h1>
        <p className="text-xs text-slate-400 font-medium hidden sm:block">
          Sistem Absensi Wajah Otomatis & Security Monitoring
        </p>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-3">
        {/* Realtime Status Indicator */}
        <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-full bg-slate-950 border border-slate-800 text-xs font-medium text-slate-300">
          <Wifi className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
          <span>Realtime WS Connected</span>
        </div>

        {/* Security Alert Quick Button */}
        {user?.role === 'admin' && (
          <Link
            href="/admin/security/alerts"
            className="relative p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            title="Alert Keamanan Server Room"
          >
            <ShieldAlert className="w-5 h-5 text-amber-400" />
            {unreviewedCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white">
                {unreviewedCount}
              </span>
            )}
          </Link>
        )}

        {/* Theme Toggle */}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
          title="Toggle Theme"
        >
          {theme === 'dark' ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-indigo-400" />}
        </button>

        {/* User Role Badge */}
        <div className="flex items-center gap-2 px-3 py-1 rounded-xl bg-slate-800 border border-slate-700/60 text-xs font-semibold text-slate-200">
          <UserCheck className="w-3.5 h-3.5 text-blue-400" />
          <span className="capitalize">{user?.role || 'Karyawan'}</span>
        </div>
      </div>
    </header>
  );
}
