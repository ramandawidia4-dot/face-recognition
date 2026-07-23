# 00 — System Overview

> Greenfield design. Sistem ini BELUM diimplementasi. Dokumen ini adalah blueprint.

---

## Apa yang akan dibangun

Sistem absensi karyawan berbasis **face recognition** yang berjalan di jaringan lokal kantor.

**User persona**:
- **Karyawan** — ingin absen masuk/keluar tanpa antri, tanpa sidik jari
- **Admin HR** — ingin lihat rekap absensi real-time, manage karyawan, manage device kamera
- **Admin IT** — ingin deploy mudah (Docker), monitor system health

**Kebutuhan fungsional**:

| ID | Kebutuhan | Priority |
|---|---|---|
| F1 | Karyawan absen otomatis saat wajah terdeteksi di kamera | P0 |
| F2 | Karyawan absen manual via web (jika kamera down) | P0 |
| F3 | Karyawan request cuti/izin | P0 |
| F4 | Admin approve/reject cuti | P0 |
| F5 | Admin tambah/hapus/edit karyawan | P0 |
| F6 | Admin tambah/hapus/edit kamera | P0 |
| F7 | Live preview kamera di admin panel | P0 |
| F8 | Rekap absensi per periode dengan filter | P1 |
| F9 | Notifikasi event absensi ke admin | P1 |
| F10 | Register wajah karyawan baru (capture foto) | P0 |

**Kebutuhan non-fungsional**:

| ID | Kebutuhan |
|---|---|
| NF1 | Single binary deployment via Docker Compose |
| NF2 | Run di NUC/komputer lokal kantor (no cloud dependency) |
| NF3 | Real-time preview max 1 FPS (bandwidth hemat) |
| NF4 | Face recognition latency < 2 detik per detection |
| NF5 | Up time > 99% (allow camera downtime) |
| NF6 | Audit log semua aksi admin |
| NF7 | Backup database harian |

---

## Masalah yang dipecahkan

**Existing system (kertas / fingerprint)**:
- ❌ Buddy punching (teman absen buat temen)
- ❌ Antri pagi (50 orang, 1 mesin fingerprint, 30 menit)
- ❌ Mesin fingerprint cepat rusak (sensor kotor, aus)
- ❌ Tidak ada data real-time untuk HR
- ❌ Rekap bulanan harus dihitung manual di Excel

**New system (face recognition)**:
- ✅ Wajah unik, tidak bisa di-titipkan
- ✅ Detection otomatis, tidak perlu antri (multi-camera)
- ✅ Tidak ada sensor fisik yang aus
- ✅ Event real-time via WebSocket
- ✅ Rekap otomatis dari database

---

## Batasan (Constraints)

| Constraint | Reason |
|---|---|
| **Tidak pakai cloud** | Data absensi sensitif, harus on-premise |
| **Run di hardware minimal** | Target deployment: NUC/mini PC di kantor |
| **Multi-camera** | Kantor bisa punya 4-8 kamera (entrance, lobby, per-departemen) |
| **Heterogeneous cameras** | Mixed vendor: Hikvision, Dahua, TP-Link, USB webcam |
| **Offline-tolerant** | Camera bisa offline, sistem harus tetap jalan (degraded mode) |
| **Bahasa** | UI bilingual-ready (English + Indonesian) |

---

## Success criteria

Sistem dianggap **siap produksi** jika:
1. ✅ 5+ kamera berjalan bersamaan tanpa CPU > 80%
2. ✅ Face recognition accuracy > 95% (confidence > 0.6)
3. ✅ False positive rate < 1%
4. ✅ Rekap absensi tersedia dalam < 5 detik setelah event
5. ✅ Deploy di NUC baru < 30 menit (dari `git clone` sampai running)
6. ✅ Update kamera config tanpa restart service
7. ✅ Recovery otomatis saat kamera reconnect

---

## Apa yang TIDAK dibangun di v1

- ❌ Shift management (jam kerja kompleks)
- ❌ Lembur (overtime calculation)
- ❌ Geo-fencing (absen harus di lokasi)
- ❌ Integrasi payroll
- ❌ Mobile app native
- ❌ SSO/LDAP integration
- ❌ Multi-tenant (multi-perusahaan)
- ❌ Analytics dashboard (chart, trend)

Ini di-defer ke v2+.

---

## Dokumen di folder ini

| File | Untuk apa |
|---|---|
| `01-overview.md` | File ini. High level + scope + constraints |
| `02-architecture.md` | Topology, data flow, sequence diagrams |
| `03-tech-stack.md` | Pilihan teknologi + alasan + alternatif |
| `04-principles.md` | 8 prinsip arsitektur yang LOCKED (tidak boleh dilanggar) |
| `services/` | Per-service design (frontend, backend, ai, nginx, db) |
| `api/` | API contracts (HTTP + WebSocket) |
| `deployment/` | Docker, env, nginx production, backup |
| `08-roadmap.md` | Phased delivery plan |
| `09-risks.md` | Risk register + mitigations |
| `planning/` | Meeting notes, ADRs (Architecture Decision Records) |
| `00-readme.md` | Index navigasi |

---

## Next step

→ Baca [`02-architecture.md`](02-architecture.md) untuk topology & data flow.
