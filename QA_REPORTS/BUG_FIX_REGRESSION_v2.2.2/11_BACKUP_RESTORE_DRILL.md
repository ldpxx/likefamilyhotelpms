# 11 — BACKUP & RESTORE DRILL REPORT (`v2.2.2`)

- **Môi trường diễn tập:** **Firebase Local Emulator Suite** (Firestore `:8080` + Auth `:9099`, độc lập hoàn toàn với Production `likefamilypms`).
- **Tệp nguồn diễn tập:** `backups/firestore_backup_pre_v2.2.2_2026-11-27.json` (`2,077.2 KB`) & kiểm định tính hợp lệ tệp `backups/firestore_backup_pre_2month_qa_2026-11-27.json` (`123.1 KB`).
- **Trạng thái diễn tập:** **PASS (`DRILL-01` & `DRILL-02` đạt 100%)**

---

## 1. Diễn biến & Thời gian khôi phục (RTO / RPO)

| Chỉ số | Kết quả đo được |
| --- | --- |
| Tổng số tài liệu nghiệp vụ khôi phục (`13` collections) | **`1,519` tài liệu** |
| Số batch ghi (`writeBatch` 350 docs/batch) | `5` batch liên tiếp |
| Thời gian khôi phục hoàn tất (`restoreElapsedMs`) | **`3,136 ms` (~3.14 giây)** |
| Tỷ lệ mất mát dữ liệu (RPO sau sao lưu) | **`0` tài liệu (0%)** |
| Ảnh hưởng lên Production `likefamilypms` | **`0` lệnh ghi / xóa (cô lập 100%)** |

## 2. Đối chiếu Toàn vẹn Số lượng & Khóa ngoại Sau Khôi phục

| Collection | Số lượng trong tệp Backup | Số lượng đọc lại từ Emulator | Khớp 100% |
| --- | ---: | ---: | :-: |
| `bookings` | `500` | `500` | ✅ |
| `transactions` | `681` | `681` | ✅ |
| `guests` | `260` | `260` | ✅ |
| `rooms` / `room_types` | `15` / `4` | `15` / `4` | ✅ |
| `booking_groups` | `14` | `14` | ✅ |
| `room_maintenances` | `14` | `14` | ✅ |
| `ota_payout_batches` / `ota_adjustments` | `5` / `4` | `5` / `4` | ✅ |
| `post_checkout_adjustments` | `8` | `8` | ✅ |
| `shift_handovers` | `10` | `10` | ✅ |
| `hotel_config` / `form_templates` | `1` / `3` | `1` / `3` | ✅ |

## 3. Kiểm chứng Vận hành Thực tế trên Dữ liệu Đã Khôi phục

1. **Tính lại P&L 2 tháng:** Khớp chính xác `362.750.000đ` tiền phòng, `58.525.000đ` dịch vụ (`0đ` lệch), `1.500.000đ` phí hủy.
2. **Dựng lại chỉ mục `room_occupancy`:** `auditAndRebuildOccupancy()` tái tạo đủ `78/78` tài liệu chỉ mục từ dữ liệu đã khôi phục (`missing=0, mismatch=0`).
3. **Khởi chạy ứng dụng web `v2.2.2` trên bản khôi phục (Playwright):** Đăng nhập, tải đủ `474` đơn hoạt động + `26` đơn hủy/no-show, hiển thị Sơ đồ phòng, Timeline, Bảng đơn và Báo cáo 12 tháng không phát sinh bất kỳ lỗi console nào (`0 pageErrors, 0 consoleErrors`).
4. **Tệp nền gốc `pre_2month_qa` (`DRILL-02`):** Đã kiểm định cấu trúc JSON hợp lệ (`109` tài liệu kèm `hotel_config/main`), sẵn sàng dùng nếu Chủ dự án muốn đưa database về trạng thái sạch trước QA.
