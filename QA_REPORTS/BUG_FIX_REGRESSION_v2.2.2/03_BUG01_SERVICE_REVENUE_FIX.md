# 03 — BUG-01 FIX REPORT: SERVICE REVENUE & P&L BOUNDARY (`v2.2.2`)

- **Mã lỗi:** `BUG-01` (Mức độ: **High**)
- **Trạng thái sau bản vá:** **PASS (Đã sửa triệt để — Lệch `0đ`)**
- **Tệp thay đổi:** `src/types/pms.ts`, `src/lib/revenueMetrics.ts`, `src/lib/pmsActions.ts`, `src/lib/postStayActions.ts`

---

## 1. Giải pháp kỹ thuật đã triển khai

1. **Chuẩn hóa schema dòng dịch vụ (`src/types/pms.ts`):**
   - Bổ sung các trường `businessDate?: string` (`YYYY-MM-DD`, múi giờ `Asia/Ho_Chi_Minh`), `category?: 'minibar' | 'laundry' | 'surcharge' | 'damage' | 'other'`, `occurredAt?: string`, `status?: 'active' | 'voided'` trên `BookingServiceItem`.
2. **Gán `businessDate` bất biến tại thời điểm tạo (`pmsActions.ts` & `postStayActions.ts`):**
   - `addBookingService()` và `recordPostCheckoutAdjustment()` luôn lưu đồng thời `occurredAt` (ISO timestamp) và `businessDate = toVietnamISODate(now)` (ngày Việt Nam chuẩn `YYYY-MM-DD`), tuyệt đối không thay đổi theo bộ lọc báo cáo.
3. **Phân bổ chính xác từng dòng trong `getRoomRevenueInRange()` (`src/lib/revenueMetrics.ts`):**
   - Duyệt toàn bộ đơn đủ điều kiện P&L (loại trừ `cancelled` và `no_show`):
     - Với từng dòng `BookingServiceItem` (`status !== 'voided'`): xác định **duy nhất 1 ngày hạch toán** qua `resolveServiceBusinessDate(item, booking)` theo thứ tự ưu tiên: `item.businessDate` → ngày VN từ `item.occurredAt` → ngày VN từ `item.addedAt` → fallback `booking.checkIn`. Chỉ cộng vào `serviceRev` khi `businessDate` nằm trong `[from, to]`.
     - Với `booking.hourlySurcharge > 0`: phân bổ theo `resolveSurchargeBusinessDate(booking)` — phụ thu trả muộn (`muộn`/`late`) vào `checkOut`, còn lại (`sớm`/`early`/nghỉ giờ) vào `checkIn`.
   - Bổ sung hàm đối soát chỉ đọc `auditLegacyServiceDates()` gom mọi khoản thiếu căn cứ ngày phát sinh vào hàng đợi `LEGACY_DATE_REVIEW_REQUIRED` (không tự ý sửa dữ liệu lịch sử).

## 2. Kết quả kiểm thử thực tế trên Local Emulator (`qa_v222_emulator_suite.mjs`)

| Test ID | Kịch bản kiểm thử | Kết quả đo được | Trạng thái |
| --- | --- | --- | --- |
| `BUG01-FIN-SVC-01` | Đối chiếu tổng dịch vụ trên toàn bộ tập 2 tháng (`500` đơn) | `T10 = 30.320.000đ`, `T11 = 28.205.000đ`, `T10 + T11 = 58.525.000đ`, `2M = 58.525.000đ`, `Tổng 61 ngày lẻ = 58.525.000đ`, **Chênh lệch = `0đ`** | **PASS** |
| `BUG01-ROOM-REV` | Xác nhận doanh thu phòng & đêm bán không hồi quy | `roomRev = 362.750.000đ` (`T10: 195.850.000đ` + `T11: 166.900.000đ`), `730` đêm bán (`387 + 343`), **Chênh lệch = `0đ`** | **PASS** |
| `BUG01-BOUNDARY` | Đơn ranh giới tháng `31/10 → 01/11`: Minibar `30.000đ` (`businessDate 31/10`) + Trả muộn `100.000đ` | `T10 = 30.000đ`, `T11 = 100.000đ`, `2M = 130.000đ`, `legacyQueue = 0` | **PASS** |

## 3. Giải trình chi tiết đến từng đồng cho tổng `58.525.000đ`

- `499` đơn `QA2M_*` trong kỳ `01/10–30/11/2026` có tổng dịch vụ gốc = **`58.465.000đ`**.
- `1` đơn E2E `QA2M_E2E_LIFECYCLE_01` (nhận phòng `05/12/2026`) có 1 dòng dịch vụ trị giá **`60.000đ`** được thêm vào ngày **`27/11/2026`** (`addedAt` ngày `27/11/2026`). Theo nguyên tắc kế toán `businessDate` mới, khoản `60.000đ` phát sinh thực tế trong Tháng 11 được hạch toán đúng vào Tháng 11 (thay vì bị bỏ sót ở Tháng 11 như logic cũ lọc theo `checkIn`).
- Tổng hợp chính xác tuyệt đối: `58.465.000đ + 60.000đ = 58.525.000đ` = `T10 (30.320.000đ) + T11 (28.205.000đ)` = `Tổng 61 ngày lẻ (58.525.000đ)` (**0đ sai lệch**).
- Hàng đợi `LEGACY_DATE_REVIEW_REQUIRED` trên toàn bộ tập dữ liệu hiện có: **`0` mục** (100% dòng dịch vụ đều có `addedAt`/`businessDate` hợp lệ).
