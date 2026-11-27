# 08 — REGRESSION TEST RESULTS (`v2.2.2`)

- **Phạm vi:** Toàn bộ các hạng mục sửa lỗi `v2.2.2` (`BUG-01`, `BUG-02`, `BUG-03`, `UI-01..UI-04`, Security Rules mới, Restore Drill) kết hợp kiểm chứng hồi quy trên tập dữ liệu 2 tháng `QA2M_*` (`500` đơn, `681` giao dịch, `260` khách).
- **Tổng kết kết quả vòng kiểm thử `v2.2.2`:**
  - **Tổng số ca kiểm thử mới chạy tự động (`v2.2.2`):** **`19`** (`14` Firebase Local Emulator + `5` Playwright UI trên Chrome)
  - **PASS:** **`19 / 19` (100%)**
  - **FAIL:** **`0`**
  - **BLOCKED:** **`0`** (toàn bộ 4 ca UI bị chặn ở `v2.2.1` đã được gỡ chặn hoàn toàn)
  - **NOT RUN:** **`0`**
- **Tổng hợp lũy kế kèm 35 ca hồi quy nền từ đợt Staging 2 tháng (`v2.2.1`):** **`54 / 54 PASS` (`0 FAIL`, `0 BLOCKED`, `0 NOT RUN`)**.

---

## Bảng Chi tiết 19 Ca Kiểm thử Tự động `v2.2.2`

| # | Mã ca test | Nhóm | Mô tả kiểm chứng | Kết quả |
| :-: | --- | --- | --- | :-: |
| 1 | `DRILL-01` | Restore Drill | Khôi phục 100% bản sao lưu 2 tháng (`1,519` docs trong `3,136ms`) lên Emulator độc lập, khớp `500/500` bookings, `681/681` tx, `260/260` guests | **PASS** |
| 2 | `DRILL-02` | Restore Drill | Kiểm chứng tính toàn vẹn tệp sao lưu nền sạch `pre_2month_qa` (`109` docs) | **PASS** |
| 3 | `BUG01-FIN-SVC-01` | BUG-01 (P&L) | `serviceRev(T10) + serviceRev(T11) === serviceRev(2M) === Tổng 61 ngày` (`58.525.000đ`, lệch `0đ`) | **PASS** |
| 4 | `BUG01-ROOM-REV` | BUG-01 (P&L) | Hồi quy `roomRev` = `362.750.000đ` / `730` đêm (`T10 195.850.000đ + T11 166.900.000đ`), lệch `0đ` | **PASS** |
| 5 | `BUG01-BOUNDARY` | BUG-01 (P&L) | Đơn vắt tháng `31/10 → 01/11`: Minibar `30.000đ` vào T10, trả muộn `100.000đ` vào T11, tổng `130.000đ` | **PASS** |
| 6 | `BUG02-REBUILD` | BUG-02 (Occupancy) | `auditAndRebuildOccupancy`: dựng đủ `78/78` docs (`missing=0, mismatch=0`) & phát hiện đúng `1` xung đột dữ liệu mẫu cũ (`QA2M_BKG_0433` / `QA2M_MNT_0014`) | **PASS** |
| 7 | `BUG02-CONC-STORM-12` | BUG-02 (Concurrency) | Bão `12` yêu cầu đặt đồng thời P.201 (`10–11/12`): duy nhất `1` thành công, `11` bị chặn nguyên tử (`OCCUPANCY_CONFLICT`) | **PASS** |
| 8 | `BUG02-HOURLY-5M` | BUG-02 (Đệm 5 phút) | Đơn `10:00–14:00`: chặn `14:04`, chặn qua đêm `14:00`, cho phép `14:05–16:05` | **PASS** |
| 9 | `BUG02-GROUP-ATOMIC` | BUG-02 (Đoàn) | Đặt đoàn 3 phòng có 1 phòng trùng → rollback nguyên tử toàn bộ, phòng trống không bị kẹt khóa | **PASS** |
| 10 | `BUG02-RELEASE-REBOOK` | BUG-02 (Giải phóng) | Hủy đơn giải phóng `room_occupancy` → đặt lại ngay phòng P.201 thành công | **PASS** |
| 11 | `BUG03-MIGRATION` | BUG-03 (Config) | Migration idempotent bổ sung `12` `bookingSources` + `configMigrationVersion=1`; chạy lần 2 giữ nguyên nguồn VIP tùy chỉnh, trạng thái tắt & `otaChannels` | **PASS** |
| 12 | `SEC-OCC-01` | Security Rules | Chặn `unauth` đọc `room_occupancy`, chặn schema sai & chặn Lễ tân xóa `room_occupancy` | **PASS** |
| 13 | `SEC-CFG-02` | Security Rules | Chặn Lễ tân sửa `configMigrationVersion`/`bookingSources`; chặn Chủ KS sửa `hotelName` | **PASS** |
| 14 | `SEC-RBAC-EMU` | Security Rules | Chặn Lễ tân list `staff_users`; chặn sửa `transactions`; chặn ghi `transactions` trong kỳ khóa sổ | **PASS** |
| 15 | `UI-01` | Playwright UI | Desktop `1440×900`: Sơ đồ phòng, Tổng quan, Timeline, Đơn/Đoàn (`474` hoạt động + `26` hủy), Tài chính 12 tháng (`0` tràn ngang) | **PASS** |
| 16 | `UI-02` | Playwright UI | Tablet `768×1024`: Sơ đồ phòng & thanh điều hướng hiển thị gọn (`horizontalOverflow=false`) | **PASS** |
| 17 | `UI-03` | Playwright UI | Mobile `390×844`: Co gọn menu & lưới phòng (`horizontalOverflow=false`) | **PASS** |
| 18 | `UI-04` | Playwright UI | Cảnh báo đỏ inline khi nhập mật khẩu lệch 2 lần + Drawer đặt phòng theo giờ + Nút "Khôi phục danh mục nguồn mặc định" | **PASS** |
| 19 | `UI-CONSOLE-01` | Playwright UI | Kiểm soát lỗi runtime trình duyệt suốt toàn phiên: `pageErrors = 0`, `consoleErrors = 0` | **PASS** |
