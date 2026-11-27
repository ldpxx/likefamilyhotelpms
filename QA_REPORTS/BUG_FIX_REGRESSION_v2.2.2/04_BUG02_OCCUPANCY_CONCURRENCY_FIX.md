# 04 — BUG-02 FIX REPORT: ATOMIC ROOM OCCUPANCY & CONCURRENCY (`v2.2.2`)

- **Mã lỗi:** `BUG-02` (Mức độ: **Medium**)
- **Trạng thái sau bản vá:** **PASS (100% Chống đặt trùng nguyên tử — 0đ Spark)**
- **Tệp thay đổi:** `src/types/pms.ts`, `src/lib/occupancyService.ts` (mới), `src/lib/pmsActions.ts`, `src/lib/cancellationActions.ts`, `src/lib/postStayActions.ts`, `firestore.rules`

---

## 1. Kiến trúc Phương án A (`room_occupancy/{roomId}_{YYYY-MM-DD}`)

- **Thiết kế tài liệu chỉ mục:** Mỗi tài liệu `room_occupancy/{roomId}_{YYYY-MM-DD}` lưu danh sách các khoảng thời gian chiếm dụng `intervals: OccupancyInterval[]` (`id`, `kind: 'booking' | 'maintenance'`, `bookingMode`, `startAt`, `endAt`, `cleaningBufferMinutes: 5`, `updatedAt`, `testRunId?`).
- **Quy tắc chống giao cắt có đệm dọn phòng 5 phút (`doOccupancyIntervalsConflict`):**
  - Khoảng hiệu dụng của mỗi đơn/bảo trì là `[startAt, endAt + bufferMs)` với `bufferMs = 5 * 60 * 1000` (5 phút).
  - Hai khoảng giao nhau khi và chỉ khi `startA < endB + bufferB && startB < endA + bufferA`.
  - Áp dụng đồng nhất cho cả cặp `hourly ↔ hourly`, `hourly ↔ overnight`, và `booking ↔ maintenance`.
- **Cơ chế nguyên tử hóa (`runTransaction`):**
  - `prepareOccupancyPlanInTransaction(tx, db, { release, reserve })`: Đọc toàn bộ tài liệu `room_occupancy` bị ảnh hưởng qua `tx.get()` **trước mọi lệnh ghi**, kiểm tra trùng trên toàn tập; nếu có bất kỳ xung đột nào → ném lỗi `OCCUPANCY_CONFLICT` và hủy toàn bộ transaction (all-or-nothing).
  - `applyOccupancyPlanInTransaction(tx, db, plan)`: Ghi đồng bộ các tài liệu `room_occupancy` cùng lúc với tài liệu `bookings`/`room_maintenances` trong cùng 1 transaction.

## 2. Danh sách đầy đủ 15 Luồng Thay Đổi Lịch Phòng Đã Nối Đồng Bộ

| # | Luồng nghiệp vụ | Hàm thực thi | Hành động lên `room_occupancy` |
| :-: | --- | --- | --- |
| 1 | Tạo đơn lẻ (ngày/đêm & nghỉ giờ) | `createBooking()` | `reserve` (atomic `runTransaction`) |
| 2 | Tạo đơn đoàn nhiều phòng | `createGroupBooking()` | `reserve` tất cả phòng trong 1 transaction (all-or-nothing) |
| 3 | Đổi phòng đơn giản | `transferBookingRoom()` (simple) | `release` phòng cũ + `reserve` phòng mới cùng transaction |
| 4 | Đổi phòng cắt chặng (Split-Stay) | `transferBookingRoom()` (split) | `release` phần sau phòng cũ + `reserve` chặng mới cùng transaction |
| 5 | Gia hạn / Sửa ngày / Đổi khung giờ | `updateBookingPricing()` | `release` khung cũ + `reserve` khung mới cùng transaction |
| 6 | Check-out đúng hạn | `checkOutBooking()` | `release` khoảng chiếm dụng phòng |
| 7 | Trả phòng sớm (Early Check-out) | `executeEarlyCheckOut()` | `release` các đêm/khung chưa ở |
| 8 | Hủy đơn nhanh | `cancelBooking()` | `release` toàn bộ ngày chiếm dụng |
| 9 | Hủy đơn có kế toán cọc (`cancel`) | `executeAccountingCancellation()` | `release` toàn bộ ngày chiếm dụng |
| 10 | Đánh dấu không đến (`no_show`) | `executeAccountingCancellation()` | `release` toàn bộ ngày chiếm dụng |
| 11 | Khôi phục đơn đã hủy | `restoreCancelledBooking()` | `reserve` lại phòng (chặn nếu phòng đã có khách mới) |
| 12 | Đảo Check-in nhầm | `reverseCheckInBooking()` | Giữ nguyên/đồng bộ `reserve` trạng thái `reserved` |
| 13 | Mở lại đơn đã Check-out (`reopen_stay`) | `reopenCheckedOutBooking()` | `reserve` lại phòng (chặn nếu phòng đã có khách/bảo trì mới) |
| 14 | Gộp công nợ & đóng phòng nguồn | `consolidateRoomIntoTarget()` | `release` phòng nguồn khi chuyển sang `checked_out` |
| 15 | Tạo / Đổi lịch / Hoàn tất bảo trì phòng | `createRoomMaintenance()`, `updateRoomMaintenanceSchedule()`, `completeRoomMaintenance()` | `reserve` / cập nhật / `release` lịch bảo trì nguyên tử |

## 3. Kết quả Kiểm thử Bão Đồng Thời & Chỉ mục (`qa_v222_emulator_suite.mjs`)

| Test ID | Kịch bản kiểm thử | Kết quả đo được | Trạng thái |
| --- | --- | --- | --- |
| `BUG02-REBUILD` | `auditAndRebuildOccupancy(dryRun → rebuild → verify)` trên `500` đơn + `14` bảo trì | Xây dựng đủ `78/78` tài liệu `room_occupancy` (`missing=0, mismatched=0, stale=0`) và **phát hiện chính xác 1 xung đột lịch sử sẵn có** trong dữ liệu seed cũ (`room_502_2026-11-28`: `QA2M_BKG_0433` vs `QA2M_MNT_0014`) mà không tự ý xóa dữ liệu gốc | **PASS** |
| `BUG02-CONC-STORM-12` | **Bão 12 yêu cầu `runTransaction` bắn đồng thời** vào P.201 (`10–11/12/2026`) từ 2 tài khoản (`Owner` + `Receptionist`) | **DUY NHẤT `1` yêu cầu thành công**, **`11` yêu cầu bị từ chối nguyên tử** với mã lỗi `OCCUPANCY_CONFLICT` | **PASS** |
| `BUG02-HOURLY-5M` | Đệm dọn phòng 5 phút: Đơn `10:00–14:00` trên P.202 | Chặn `14:04–16:04` (`+4 phút`), chặn đơn qua đêm `14:00`, **cho phép `14:05–16:05` (`+5 phút`)** | **PASS** |
| `BUG02-GROUP-ATOMIC` | Đặt đoàn 3 phòng (`P.203`, `P.204` trống + `P.201` đã có khách) | Hủy nguyên tử toàn bộ đoàn; xác minh `room_203_2026-12-10` hoàn toàn không bị giữ chỗ dở dang | **PASS** |
| `BUG02-RELEASE-REBOOK` | Hủy đơn thắng cuộc trên P.201 rồi đặt lại ngay cùng ngày | Giải phóng sạch chỉ mục và đặt lại thành công 100% | **PASS** |
