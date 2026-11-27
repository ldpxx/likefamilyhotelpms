# 06 — DATABASE MIGRATION & ROLLBACK PLAN (`v2.2.2`)

Tài liệu quy định trình tự nâng cấp cơ sở dữ liệu an toàn (zero-downtime, 0đ Spark) khi Chủ dự án phê duyệt Go-Live `v2.2.2`, kèm phương án Rollback đầy đủ.

---

## 1. Thay đổi Schema & Collection trong `v2.2.2`

| Đối tượng | Loại thay đổi | Tương thích ngược |
| --- | --- | --- |
| `room_occupancy/{roomId}_{YYYY-MM-DD}` | Collection chỉ mục mới (`roomId`, `date`, `intervals`, `updatedAt`) | 100% — Không phá vỡ collection cũ |
| `bookings[*].services[*]` | Bổ sung tùy chọn `businessDate`, `occurredAt`, `category`, `status` | 100% — Dữ liệu cũ fallback `addedAt` → `checkIn` |
| `hotel_config/main` | Bổ sung tùy chọn `bookingSources`, `configMigrationVersion: 1` | 100% — Giữ nguyên `otaChannels` hiện có |
| `firestore.rules` | Thêm rule cho `room_occupancy` và cho phép Owner cập nhật `configMigrationVersion` | 100% — Không làm suy giảm bất kỳ ràng buộc RBAC cũ nào |

## 2. Trình tự triển khai Go-Live (CHỈ THỰC HIỆN SAU KHI CHỦ DỰ ÁN PHÊ DUYỆT)

1. **Bước 1 — Sao lưu nóng:** Xuất bản sao lưu Firestore mới nhất trước giờ triển khai (xác nhận dung lượng & số lượng tài liệu).
2. **Bước 2 — Triển khai `firestore.rules` trước:** Chạy `firebase deploy --only firestore:rules` để mở quyền cho `room_occupancy` và `configMigrationVersion` trước khi Client `v2.2.2` hoạt động.
3. **Bước 3 — Kiểm toán & Khởi tạo chỉ mục `room_occupancy`:**
   - Chạy `auditAndRebuildOccupancy(..., dryRun=true)` kiểm tra xung đột lịch sử (trên tập Staging hiện tại đã phát hiện 1 xung đột dữ liệu mẫu `room_502_2026-11-28: QA2M_BKG_0433 / QA2M_MNT_0014` cần quyết định xử lý hoặc dọn bộ dữ liệu `QA2M_*` trước Go-Live thật).
   - Chạy `auditAndRebuildOccupancy(..., dryRun=false)` xây dựng đầy đủ tài liệu chỉ mục (`78` docs trên bộ Staging).
4. **Bước 4 — Triển khai Hosting (`v2.2.2`):** Chạy `npm run build` và `firebase deploy --only hosting`.
5. **Bước 5 — Hậu kiểm:** Đăng nhập Chủ KS → xác nhận `ensureBookingSourcesConfig()` tự động ghi `bookingSources` (12 nguồn, `configMigrationVersion: 1`) và kiểm tra P&L `T10 + T11 = 2M` (`0đ` lệch).

## 3. Quy trình Rollback khẩn cấp (RTO < 5 phút)

1. **Hoàn nguyên giao diện Hosting:** Checkout nhánh ổn định `release/v2.2.1` (commit `538e13687bee1feae82e293bd2bc04ba921795c4`), chạy `npm run build` và `firebase deploy --only hosting`.
2. **Hoàn nguyên Security Rules:** Triển khai lại `firestore.rules` của `release/v2.2.1` (`firebase deploy --only firestore:rules`).
3. **Dữ liệu Firestore:** Toàn bộ dữ liệu `bookings`, `transactions`, `guests`, `otaChannels` hoàn toàn tương thích ngược với `v2.2.1`, không cần khôi phục ngược dữ liệu (collection `room_occupancy` có thể để yên hoặc xóa bởi SuperAdmin). Trường hợp khẩn cấp cần phục hồi nguyên trạng, dùng bản sao lưu JSON đã diễn tập thành công ở báo cáo `11_BACKUP_RESTORE_DRILL.md` (thời gian khôi phục `1,519` tài liệu chỉ `3.14 giây`).
