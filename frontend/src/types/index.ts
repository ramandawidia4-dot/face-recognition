export type UserRole = "admin" | "employee";

export interface User {
  id: string;
  email: string;
  username: string | null;
  full_name: string;
  role: UserRole;
  avatar_url: string | null;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export type AttendanceStatus = "present" | "late" | "absent" | "half_day";

export interface Attendance {
  id: string;
  user_id: string;
  date: string;
  check_in: string | null;
  check_out: string | null;
  status: AttendanceStatus;
  check_in_method?: "camera" | "manual";
  check_out_method?: "camera" | "manual";
  notes?: string;
  created_at: string;
  updated_at: string;
  user?: User;
}

export type LeaveType = "sick" | "personal" | "annual" | "other";
export type LeaveStatus = "pending" | "approved" | "rejected";

export interface Leave {
  id: string;
  user_id: string;
  type: LeaveType;
  start_date: string;
  end_date: string;
  reason: string;
  status: LeaveStatus;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  user?: User;
}

export type CameraSource = "rtsp" | "onvif" | "usb";
export type CameraState =
  | "RUNNING"
  | "STOPPED"
  | "CONNECTING"
  | "STOPPING"
  | "RECONNECTING"
  | "ERROR";

export interface Camera {
  id: string;
  name: string;
  source: CameraSource;
  rtsp_url: string | null;
  usb_device_path: string | null;
  onvif_host: string | null;
  onvif_port: number | null;
  onvif_username: string | null;
  onvif_password: string | null;
  is_active: boolean;
  location: string | null;
  last_frame_at: string | null;
  created_at: string;
  updated_at: string;
  state?: CameraState;
}

export interface CameraStateResponse {
  camera_id: string;
  state: CameraState;
  error: string | null;
  last_frame_at: string | null;
}

export type AlertSeverity = "info" | "warning" | "critical";

export interface SecurityCamera {
  id: string;
  name: string;
  source: CameraSource;
  rtsp_url: string | null;
  onvif_host: string | null;
  onvif_port: number | null;
  onvif_username: string | null;
  onvif_password: string | null;
  location: string | null;
  is_active: boolean;
  last_frame_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SecurityAlert {
  id: string;
  camera_id: string;
  camera_name: string;
  face_known: boolean;
  matched_user_id: string | null;
  matched_user_name: string | null;
  confidence: number;
  bounding_box: { x: number; y: number; w: number; h: number } | null;
  snapshot_jpeg: string | null;
  severity: AlertSeverity;
  reviewed: boolean;
  reviewed_by: string | null;
  reviewed_at: string | null;
  notes: string | null;
  captured_at: string;
  created_at: string;
}

export interface WsAttendanceCreated {
  user_id: string;
  full_name: string;
  status: AttendanceStatus;
  timestamp: string;
  attendance_id: string;
}

export interface WsAttendanceUpdated {
  attendance_id: string;
  user_id: string;
  check_out: string;
  timestamp: string;
}

export interface WsCameraStatus {
  camera_id: string;
  state: CameraState;
  error: string | null;
}

export interface WsCameraFrame {
  camera_id: string;
  frame_base64: string;
  captured_at: string;
}

export interface WsSecurityAlertEvent {
  alert_id: string;
  camera_id: string;
  camera_name: string;
  type: "known_access" | "partial_match" | "stranger";
  severity: AlertSeverity;
  face_known: boolean;
  matched_user_id: string | null;
  matched_user_name: string | null;
  confidence: number;
  bounding_box: { x: number; y: number; w: number; h: number } | null;
  snapshot_jpeg: string;
  captured_at: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: { page: number; limit: number; total: number };
}

export interface ApiError {
  success: false;
  error: { code: string; message: string };
}
