# 12 — FINAL UAT READINESS & GO-LIVE GATE (`v2.2.2`)

- **Phiên bản đề xuất phát hành:** **`v2.2.2`** (nhánh GitHub: `fix/v2.2.2`)
- **Ngày hoàn tất kiểm thử nghiệm thu:** `27/11/2026`
- **Khuyến nghị UAT Readiness:** **`GO`** (Sẵn sàng cho Chủ dự án phê duyệt Go-Live theo quy trình nâng cấp 5 bước tại báo cáo `06_DATABASE_MIGRATION_AND_ROLLBACK.md`)

---

## 1. Bảng Tổng hợp Trạng thái Toàn bộ Hạng mục `v2.2.2`

| Hạng mục | Mô tả | Trạng thái | Ghi chú kiểm chứng |
| --- | --- | :-: | --- |
| **`BUG-01`** [High] | Cố định `businessDate` dịch vụ & tách bạch phụ thu trong P&L | **PASS** | `serviceRev(T10) 30.320.000đ + serviceRev(T11) 28.205.000đ = 58.525.000đ = 2M = Tổng 61 ngày` (**`0đ` lệch**); `roomRev = 362.750.000đ / 730 đêm` |
| **`BUG-02`** [Medium] | Khóa phòng nguyên tử `room_occupancy/{roomId}_{YYYY-MM-DD}` (`runTransaction` + đệm 5 phút) cho đủ 15 luồng | **PASS** | Bão 12 yêu cầu đồng thời → **1 thành công / 11 bị chặn nguyên tử**; đệm 5 phút, đặt đoàn all-or-nothing & giải phóng phòng đều PASS; `auditAndRebuildOccupancy` phát hiện rõ `1` xung đột dữ liệu mẫu cũ (`room_502_2026-11-28: QA2M_BKG_0433 / QA2M_MNT_0014`) |
| **`BUG-03`** [Low] | Migration idempotent `ensureBookingSourcesConfig()` + nút khôi phục nguồn mặc định | **PASS** | Bổ sung 12 nguồn + `configMigrationVersion=1`; chạy lặp lần 2 không ghi đè nguồn tùy chỉnh/trạng thái tắt/`otaChannels` |
| **`UI-01` → `UI-04`** | Gỡ chặn Node `v20.18.0` bằng `playwright-core` + Chrome cục bộ; test Desktop, Tablet, Mobile, Form E2E | **PASS** | `5/5 PASS`, `0` tràn ngang, `0` `pageErrors`, `0` `consoleErrors`, kèm 9 ảnh chụp màn hình trong `screenshots/` |
| **Security Rules** | Quy tắc bảo vệ `room_occupancy` & `configMigrationVersion` + RBAC cũ | **PASS** | `100% PASS` trên Local Emulator (chặn `unauth`, schema sai, Lễ tân xóa `room_occupancy`/sửa config/list `staff_users`, sửa `transactions`, ghi trong kỳ khóa sổ) |
| **Restore Drill** | Diễn tập khôi phục bản sao lưu 2 tháng trên Local Emulator độc lập | **PASS** | `1,519` tài liệu khôi phục trong `3.14 giây`, khớp 100% số lượng & chạy mượt UI |
| **Biên dịch (`npm run build`)** | Kiểm tra TypeScript + đóng gói Vite/PWA | **PASS** | `0` lỗi TypeScript, `0` lỗi build (`5.60s`) |

## 2. Thống kê Tổng hợp Ca Kiểm thử

- **Vòng nghiệm thu `v2.2.2`:** **`19 PASS` / `0 FAIL` / `0 BLOCKED` / `0 NOT RUN`** (`14` Emulator + `5` Playwright UI)
- **Lũy kế toàn chu kỳ Staging + Bugfix (`v2.2.1` + `v2.2.2`):** **`54 PASS` / `0 FAIL` / `0 BLOCKED` / `0 NOT RUN`**

## 3. Xác nhận Tuân thủ Cổng Dừng (Mandatory Stop Gate)

- ✅ **KHÔNG xóa hay chỉnh sửa** bộ dữ liệu mẫu 2 tháng `QA2M_*` trên `likefamilypms`.
- ✅ **KHÔNG tự ý deploy Production** (`firebase deploy` chưa chạy).
- ✅ Toàn bộ thay đổi `v2.2.2` được lưu sạch trên nhánh GitHub `fix/v2.2.2` kèm đủ 13 báo cáo & 9 ảnh chụp kiểm chứng.

## 4. Checklist 3 Quyết định Cần Chủ dự án Phê duyệt Trước Khi Go-Live

1. **Phê duyệt phát hành `v2.2.2`:** Đồng ý gộp `fix/v2.2.2` và deploy `firestore.rules` + Hosting lên `https://likefamilypms.web.app`?
2. **Xử lý dữ liệu Staging `QA2M_*`:** Giữ lại `QA2M_*` để test UAT thủ công thêm (nếu giữ cần quyết định xử lý cặp trùng mẫu `QA2M_BKG_0433` vs `QA2M_MNT_0014` trên `P.502` ngày `28/11/2026`), hay khôi phục về bản sạch `backups/firestore_backup_pre_2month_qa_2026-11-27.json` (`109` docs) để bàn giao vận hành thật?
3. **Thu hồi tài khoản QA tạm:** Khóa/xóa tài khoản `qa_runner@likefamilyhotel.com` sau khi kết thúc UAT.
