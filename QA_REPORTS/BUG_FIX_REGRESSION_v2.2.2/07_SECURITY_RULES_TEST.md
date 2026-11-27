# 07 — SECURITY RULES TEST REPORT (`v2.2.2`)

- **Môi trường thực thi:** Firebase Local Emulator Suite (`firestore.rules` phiên bản `v2.2.2`, Auth `:9099` + Firestore `:8080`)
- **Tài khoản kiểm thử cô lập (Emulator):**
  - `SuperAdmin`: `ducphuong84@gmail.com` (`role: superadmin`)
  - `Owner`: `owner_emu@likefamilyhotel.com` (`role: owner`)
  - `Receptionist`: `rec_emu@likefamilyhotel.com` (`role: receptionist`)
  - `Unauthenticated`: Không có phiên Firebase Auth
- **Kết quả tổng thể:** **PASS (100% — Mọi quyền mới và cũ đều được cưỡng chế ở tầng Firestore Rules)**

---

## 1. Các thay đổi trong `firestore.rules` phiên bản `v2.2.2`

1. **Bảo vệ collection khóa phòng mới `room_occupancy/{occId}`:**
   - `read`: Chỉ cho phép `isActiveStaff()` (chặn tuyệt đối truy cập chưa đăng nhập).
   - `create, update`: Chỉ cho phép `isActiveStaff()` và bắt buộc vượt qua hàm kiểm tra schema `validOccupancyDoc()`:
     - `keys().hasOnly(['roomId', 'date', 'intervals', 'updatedAt'])`
     - `roomId is string`, `date is string` (10 ký tự `YYYY-MM-DD`), `intervals is list`, `updatedAt is string`.
   - `delete`: Chỉ cho phép `isSuperAdmin()` (chặn Lễ tân và Chủ KS xóa trực tiếp chỉ mục khóa phòng).
2. **Cập nhật quyền `owner` trên `hotel_config/main`:**
   - Bổ sung `'configMigrationVersion'` vào tập trường cho phép trong `request.resource.data.diff(resource.data).affectedKeys().hasOnly(...)` để hàm migration idempotent `ensureBookingSourcesConfig()` hoạt động hợp lệ cho Chủ KS mà vẫn chặn tuyệt đối sửa `hotelName`, thông tin ngân hàng VietQR, v.v.

## 2. Bảng kết quả kiểm thử Security Rules trên Local Emulator

| Test ID | Quy tắc / Ma trận RBAC kiểm thử | Kết quả thực tế | Trạng thái |
| --- | --- | --- | --- |
| `SEC-OCC-01a` | Khách chưa đăng nhập (`Unauth`) đọc `room_occupancy` | `PERMISSION_DENIED` (`unauthDenied=true`) | **PASS** |
| `SEC-OCC-01b` | Lễ tân ghi tài liệu `room_occupancy` sai schema (thiếu `intervals`/`updatedAt`) | `PERMISSION_DENIED` @ L176 (`badSchemaDenied=true`) | **PASS** |
| `SEC-OCC-01c` | Lễ tân xóa tài liệu `room_occupancy/room_201_2026-12-10` | `PERMISSION_DENIED` @ L181 (`recDelDenied=true`) | **PASS** |
| `SEC-CFG-02a` | Lễ tân sửa `configMigrationVersion` / `bookingSources` trên `hotel_config/main` | `PERMISSION_DENIED` @ L95 (`recCfgDenied=true`) | **PASS** |
| `SEC-CFG-02b` | Chủ KS (`Owner`) sửa trái phép `hotelName` trên `hotel_config/main` | `PERMISSION_DENIED` @ L95 (`ownerNameDenied=true`) | **PASS** |
| `SEC-CFG-02c` | Chủ KS (`Owner`) chạy migration `bookingSources` + `configMigrationVersion: 1` | Cho phép (`ALLOWED`) trong `BUG03-MIGRATION` | **PASS** |
| `SEC-RBAC-01` | Lễ tân đọc danh sách (`list`) collection `staff_users` | `PERMISSION_DENIED` (`recListDenied=true`) | **PASS** |
| `SEC-RBAC-02` | Chủ KS sửa sổ quỹ bất biến `transactions` (`update amount`) | `PERMISSION_DENIED` @ L210 (`txImmutDenied=true`) | **PASS** |
| `SEC-RBAC-03` | Chủ KS tạo giao dịch `transactions` ngày `2026-10-31` khi đã khóa sổ `accountingLockDate = 2026-10-31` | `PERMISSION_DENIED` @ L209 (`lockTxDenied=true`) | **PASS** |
| `SEC-RBAC-04` | Lễ tân & Chủ KS ghi `room_occupancy` đúng schema trong `runTransaction` (12 luồng storm) | Cho phép (`ALLOWED`), kiểm soát xung đột nguyên tử | **PASS** |

> **Lưu ý Cổng Dừng:** Tệp `firestore.rules` mới mới chỉ được xác minh trên Local Emulator và lưu trong nhánh `fix/v2.2.2`; **chưa deploy lên `likefamilypms`** cho đến khi nhận lệnh Go-Live.
