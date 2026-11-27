# 01 — BASELINE & PRE-FIX BACKUP (`v2.2.2`)

- **Thời điểm xuất bản sao lưu:** `27/11/2026` (trước khi chạy bất kỳ thao tác kiểm thử nào của `v2.2.2`)
- **Chế độ xuất:** Chỉ đọc (`getDocs` read-only) qua tài khoản QA tạm `qa_runner@likefamilyhotel.com` (không ghi, không xóa trên `likefamilypms`).

---

## 1. Danh mục tệp sao lưu đang lưu giữ

| Tệp sao lưu | Dung lượng | Tổng tài liệu | Mục đích |
| --- | ---: | ---: | --- |
| `backups/firestore_backup_pre_2month_qa_2026-11-27.json` | `123.1 KB` | `109` | Ảnh chụp nền sạch trước khi nạp 2 tháng dữ liệu mẫu `QA2M_*` (dùng khi cần dọn sạch về trạng thái trước QA) |
| `backups/firestore_backup_pre_v2.2.2_2026-11-27.json` | `2,077.2 KB` | `1,541` | Ảnh chụp đầy đủ hiện trạng `likefamilypms` gồm 2 tháng dữ liệu `QA2M_*` (`01/10–30/11/2026`) + 1 đơn E2E T12 (dùng để nạp lên Local Emulator & đối chiếu hồi quy `v2.2.2`) |

## 2. Phân bổ tài liệu trong ảnh chụp nền `pre_v2.2.2`

| Collection | Số tài liệu | Ghi chú |
| --- | ---: | --- |
| `bookings` | `500` | `499` đơn `QA2M_*` (T10–T11/2026) + `1` đơn E2E `QA2M_E2E_LIFECYCLE_01` (T12/2026) |
| `transactions` | `681` | `679` giao dịch `QA2M_*` + `2` giao dịch E2E |
| `guests` | `260` | Hồ sơ khách lưu trú |
| `rooms` / `room_types` | `15` / `4` | `15` phòng hoạt động thuộc `4` hạng phòng |
| `booking_groups` | `14` | Đơn đoàn |
| `room_maintenances` | `14` | Lịch bảo trì phòng |
| `ota_payout_batches` / `ota_adjustments` | `5` / `4` | Đợt quyết toán & điều chỉnh OTA |
| `post_checkout_adjustments` | `8` | Điều chỉnh sau trả phòng |
| `shift_handovers` | `10` | Biên bản bàn giao ca |
| `hotel_config` / `form_templates` | `1` / `3` | `hotel_config/main` đang thiếu mảng `bookingSources` (chỉ có `6` kênh `otaChannels`) |
| `staff_users` / `audit_logs` | `3` / `19` | Tài khoản nhân sự & nhật ký thao tác |

## 3. Chỉ số Tài chính Nền (Pre-Fix `v2.2.1` trên tập `QA2M_*`)

| Chỉ số | Tháng 10/2026 | Tháng 11/2026 | T10 + T11 | Kỳ gộp 2 tháng (01/10–30/11) | Chênh lệch Pre-Fix |
| --- | ---: | ---: | ---: | ---: | ---: |
| Doanh thu phòng (`roomRev`) | `195.850.000đ` | `166.900.000đ` | `362.750.000đ` | `362.750.000đ` | `0đ` |
| Đêm bán (`soldNights`) | `387` | `343` | `730` | `730` | `0` |
| Doanh thu dịch vụ (`serviceRev` cũ) | `31.170.000đ` | `27.325.000đ` | `58.495.000đ` | `58.465.000đ` | **`+30.000đ` (`BUG-01`)** |
| Phí hủy giữ cọc (`forfeitedCancelFees`) | `1.000.000đ` | `500.000đ` | `1.500.000đ` | `1.500.000đ` | `0đ` |
