# Báo Cáo Chạy Thử (Dry-Run) & Đối Chiếu Chuyển Đổi Dữ Liệu GoHost 2026 → Like Family PMS `v2.2.2`

- **Thời gian thực hiện:** `2026-11-27T19:04:19.337Z`
- **Chế độ chạy:** `emulator` (**KHÔNG ghi lên Production `likefamilypms` — chờ Chủ dự án phê duyệt Cổng Dừng**)
- **Script chuyển đổi:** `scripts/migrate_gohost_2026.mjs`
- **Hạ tầng:** 0đ Firebase Spark (Firebase Local Emulator Suite, không Billing, không Cloud Functions, không Storage)

---

## 1. Bảng Ánh Xạ 15 Phòng & 4 Hạng Phòng (`rooms` & `room_types`)

- Giữ nguyên **4 hạng phòng chuẩn** trên Like Family PMS (`rt_std_single`, `rt_dbl_nobalk`, `rt_dbl_balk`, `rt_family`) và **15 phòng hoạt động (`room_201` → `room_503`)**, không thêm 4 phòng đóng Tầng 1 (`101–104`, 0 đơn phát sinh năm 2026).
- **Phát hiện cần Chủ dự án xác nhận:** Trên dữ liệu mẫu cũ, các phòng `201/301/401/501` đang gán là *Phòng Đơn*; kịch bản chuyển đổi đã hiệu chỉnh chuẩn theo thực tế GoHost: **4 Phòng đơn = `203, 303, 403, 502`** (`rt_std_single`), và **11 Phòng đôi/gia đình = `201, 202, 204, 301, 302, 304, 401, 402, 404, 501, 503`**. Xin Chủ dự án rà soát lại phân bổ 3 hạng phòng đôi (`Có Ban Công` / `Không Ban Công` / `Gia Đình`) cho 11 phòng bên dưới trước khi ghi lên Production:

| Số phòng | Tầng | Nhóm trên GoHost | Hạng phòng cũ trên PMS | Hạng phòng chuẩn sau chuyển đổi (`roomTypeId`) | Thay đổi? |
|---|---|---|---|---|---|
| **P.201** | Tầng 2 | Phòng đôi | Phòng Đơn Tiêu Chuẩn (`rt_std_single`) | **Phòng Đôi Có Ban Công** (`rt_dbl_balk`) | **ĐÃ HIỆU CHỈNH** |
| **P.202** | Tầng 2 | Phòng đôi | Phòng Đôi Không Ban Công (`rt_dbl_nobalk`) | **Phòng Đôi Không Ban Công** (`rt_dbl_nobalk`) | Giữ nguyên |
| **P.203** | Tầng 2 | Phòng đơn | Phòng Đôi Có Ban Công (`rt_dbl_balk`) | **Phòng Đơn Tiêu Chuẩn** (`rt_std_single`) | **ĐÃ HIỆU CHỈNH** |
| **P.204** | Tầng 2 | Phòng đôi | Phòng Gia Đình 2 Giường Lớn (`rt_family`) | **Phòng Gia Đình 2 Giường Lớn** (`rt_family`) | Giữ nguyên |
| **P.301** | Tầng 3 | Phòng đôi | Phòng Đơn Tiêu Chuẩn (`rt_std_single`) | **Phòng Đôi Có Ban Công** (`rt_dbl_balk`) | **ĐÃ HIỆU CHỈNH** |
| **P.302** | Tầng 3 | Phòng đôi | Phòng Đôi Không Ban Công (`rt_dbl_nobalk`) | **Phòng Đôi Không Ban Công** (`rt_dbl_nobalk`) | Giữ nguyên |
| **P.303** | Tầng 3 | Phòng đơn | Phòng Đôi Có Ban Công (`rt_dbl_balk`) | **Phòng Đơn Tiêu Chuẩn** (`rt_std_single`) | **ĐÃ HIỆU CHỈNH** |
| **P.304** | Tầng 3 | Phòng đôi | Phòng Gia Đình 2 Giường Lớn (`rt_family`) | **Phòng Gia Đình 2 Giường Lớn** (`rt_family`) | Giữ nguyên |
| **P.401** | Tầng 4 | Phòng đôi | Phòng Đơn Tiêu Chuẩn (`rt_std_single`) | **Phòng Đôi Có Ban Công** (`rt_dbl_balk`) | **ĐÃ HIỆU CHỈNH** |
| **P.402** | Tầng 4 | Phòng đôi | Phòng Đôi Không Ban Công (`rt_dbl_nobalk`) | **Phòng Đôi Không Ban Công** (`rt_dbl_nobalk`) | Giữ nguyên |
| **P.403** | Tầng 4 | Phòng đơn | Phòng Đôi Có Ban Công (`rt_dbl_balk`) | **Phòng Đơn Tiêu Chuẩn** (`rt_std_single`) | **ĐÃ HIỆU CHỈNH** |
| **P.404** | Tầng 4 | Phòng đôi | Phòng Gia Đình 2 Giường Lớn (`rt_family`) | **Phòng Gia Đình 2 Giường Lớn** (`rt_family`) | Giữ nguyên |
| **P.501** | Tầng 5 | Phòng đôi | Phòng Đơn Tiêu Chuẩn (`rt_std_single`) | **Phòng Đôi Không Ban Công** (`rt_dbl_nobalk`) | **ĐÃ HIỆU CHỈNH** |
| **P.502** | Tầng 5 | Phòng đơn | Phòng Đôi Không Ban Công (`rt_dbl_nobalk`) | **Phòng Đơn Tiêu Chuẩn** (`rt_std_single`) | **ĐÃ HIỆU CHỈNH** |
| **P.503** | Tầng 5 | Phòng đôi | Phòng Đôi Có Ban Công (`rt_dbl_balk`) | **Phòng Đôi Có Ban Công** (`rt_dbl_balk`) | Giữ nguyên |

---

## 2. Tổng Hợp Đối Chiếu Số Liệu GoHost 2026 vs Like Family PMS (Local Emulator)

| Hạng mục đối chiếu | Số liệu gốc GoHost (`data_gohost/*.xlsx`) | Kết quả nhập Like Family PMS (Emulator) | Chênh lệch | Trạng thái |
|---|---:|---:|---:|---|
| Đơn đặt phòng gốc (`ds-bookings.xlsx`) | `807` dòng (`92` đơn đoàn, `80` nghỉ giờ) | `962` bookings + `92` booking_groups | `0` mất đơn | **KHỚP 100%** |
| Tổng tiền phòng đơn không hủy (`grossRoomTotal`) | **877.921.238đ** | **877.921.238đ** | **0đ** | **KHỚP 100%** |
| Doanh thu phòng P&L dồn tích năm 2026 (`01/01–31/12/2026`) | — | **857.908.189đ** (`3052` đêm + `84` nghỉ giờ) | Trừ `17.849.125đ` (2 đơn `reserved`) & `2.163.924đ` (12 đêm T01/2027 của `LIK00830`) | **0đ LỆCH** |
| Tổng 12 tháng lẻ T01–T12/2026 vs Kỳ gộp cả năm 2026 | — | Phòng: **857.908.189đ** · DV: **19.203.200đ** | Phòng: **0đ** · DV: **0đ** | **BUG-01 0đ LỆCH** |
| Tổng dịch vụ (`ds-booking-services.xlsx` — `207` dòng) | **19.203.200đ** (`207` dòng) | **19.203.200đ** (`207` dòng gắn đơn) | **0đ** | **KHỚP 100%** |
| • Nhóm Đồ uống (`drink`) | — | **3.033.000đ** (`120` dòng) | — | Chuẩn phân loại |
| • Nhóm Dịch vụ (`service`) | — | **6.640.000đ** (`27` dòng) | — | Chuẩn phân loại |
| • Nhóm Phụ thu (`surcharge`) | — | **9.530.200đ** (`60` dòng) | — | Chuẩn phân loại |
| Hồ sơ khách hàng (`ds-customers.xlsx` — `706` dòng) | `706` dòng gốc | `663` hồ sơ `guests` (khử trùng `106` dòng + gộp khách từ đơn) | `0` lỗi | **HOÀN TẤT** |
| Phiếu thu thực tế (`ds-payments.xlsx` — `920` dòng, bỏ `TỔNG CỘNG` & bỏ cột `Công nợ`) | Tiền mặt **313.587.973đ** + CK **391.570.208đ** + Wechat **5.500.000đ** = **710.658.181đ** | **710.658.181đ** (`827` phiếu thu; loại trừ **97.955.332đ** cột Công nợ) | **0đ** | **KHỚP 100%** |
| Chi phí vận hành (`export-13-transactions.xlsx` — `14` dòng) | **66.442.512đ** (`14` phiếu chi) | **66.442.512đ** (`14` phiếu chi) | **0đ** | **KHỚP 100%** |
| Công nợ OTA `Chưa thu` (`export-11-receivables.xlsx` — `67` dòng) | **61.001.610đ** (`67` khoản) | `75` đơn đánh dấu `pending_ota` (tổng tiền phòng: **62.661.610đ**) | 1 mã không có trong `ds-bookings.xlsx` | **XEM MỤC 5** |
| Công nợ OTA `Hoàn thành` (`export-11-receivables.xlsx` — `26` dòng) | **37.603.722đ** (`26` khoản) | `4` lô lịch sử `ota_payout_batches` = **37.603.722đ** | **0đ** | **KHỚP 100%** |

### Khử trùng chuỗi số phòng lỗi trên `ds-bookings.xlsx` (`3` đơn)
- `LIK00770`: chuỗi gốc `"404, 304, 404, 303"` → làm sạch thành `[404, 304, 303]`
- `LIK00589`: chuỗi gốc `"202, 204, , 202, 204"` → làm sạch thành `[202, 204]`
- `LIK00416`: chuỗi gốc `", 302, 304"` → làm sạch thành `[302, 304]`

---

## 3. Báo Cáo P&L Từng Tháng Năm 2026 (Local Emulator Verification)

| Tháng | Đêm bán | Nghỉ giờ | Doanh thu phòng | Doanh thu dịch vụ | Chi phí vận hành | Lợi nhuận ròng |
|---|---:|---:|---:|---:|---:|---:|
| 01/2026 | 23 | 3 | 6.732.800đ | 145.000đ | 4.000.000đ | 2.877.800đ |
| 02/2026 | 157 | 6 | 82.365.522đ | 1.023.000đ | 7.500.000đ | 75.888.522đ |
| 03/2026 | 222 | 20 | 65.292.710đ | 2.931.200đ | 8.174.699đ | 60.049.211đ |
| 04/2026 | 211 | 6 | 52.525.132đ | 1.080.000đ | 0đ | 53.605.132đ |
| 05/2026 | 260 | 9 | 65.894.956đ | 630.000đ | 0đ | 66.524.956đ |
| 06/2026 | 345 | 8 | 111.807.272đ | 2.466.000đ | 13.655.813đ | 100.617.459đ |
| 07/2026 | 298 | 10 | 135.624.070đ | 3.542.000đ | 6.000.000đ | 133.166.070đ |
| 08/2026 | 297 | 8 | 96.836.512đ | 3.172.000đ | 9.112.000đ | 90.896.512đ |
| 09/2026 | 228 | 5 | 58.101.251đ | 1.136.000đ | 6.000.000đ | 53.237.251đ |
| 10/2026 | 388 | 7 | 81.124.492đ | 856.000đ | 6.000.000đ | 75.980.492đ |
| 11/2026 | 498 | 2 | 83.646.052đ | 2.222.000đ | 6.000.000đ | 79.868.052đ |
| 12/2026 | 125 | 0 | 17.957.420đ | 0đ | 0đ | 17.957.420đ |
| **CẢ NĂM 2026** | **3052** | **84** | **857.908.189đ** | **19.203.200đ** | **66.442.512đ** | **810.668.877đ** |

---

## 4. Danh Sách Đơn Đang Hoạt Động (`in_house` & `reserved`) & Xử Lý Đơn Quá Hạn

- **Tổng số đơn `Hoàn thành` → `checked_out`:** `716` đơn
- **Tổng số đơn `Đã hủy` → `cancelled`:** `55` đơn (trong đó `3` đơn có ghi nhận tiền thu trên GoHost: `LIK00681` `250.000đ`, `LIK00425` `200.000đ`, `LIK00081` `700.000đ` — tạm đánh dấu cọc treo chờ Chủ KS xác nhận)
- **Từ `33` đơn `Đang lưu trú`:** giữ `in_house` cho **`14` đơn có `checkOut >= 28/11/2026`** (gồm **11 đơn lưu trú dài hạn `co >= 30/11/2026`** + **3 đơn trả phòng hôm nay `28/11/2026`**: `LIK00847`, `LIK00850`, `LIK00851`), tự động chuyển **`19` đơn quá hạn (`co < 28/11/2026`)** sang `checked_out`.
- **Từ `3` đơn `Mới`:** giữ `reserved` cho **`2` đơn** (`LIK00848` `29/11–12/12/2026`, `LIK00685` `12/01–17/01/2027`), tự động chuyển `LIK00231` (`30/03–30/04/2026`) sang `checked_out`.

### 4.1. Danh sách đơn đang ở (`in_house` — `checkOut >= 28/11/2026`)

| Mã GoHost | Khách hàng | Phòng | Nhận phòng | Trả phòng | Tiền phòng | Đã thanh toán | Ghi chú |
|---|---|---|---|---|---:|---:|---|
| `LIK00830` | Vagazov | P.402 | 13/11/2026 | 13/01/2027 | 11.000.000đ | 11.000.000đ | Đang lưu trú dài hạn |
| `LIK00783` | SOLGALOVA VERONIKA | P.502, P.404, P.403 | 17/10/2026 | 17/12/2026 | 10.000.000đ | 10.000.000đ | Đang lưu trú dài hạn |
| `LIK00782` | SOLGALOVA VERONIKA | P.303 | 17/10/2026 | 17/12/2026 | 10.000.000đ | 10.000.000đ | Đang lưu trú dài hạn |
| `LIK00835` | GRIGOREV SEMEN | P.301 | 12/11/2026 | 12/12/2026 | 6.000.000đ | 6.000.000đ | Đang lưu trú dài hạn |
| `LIK00843` | DUBENCHUK ANNA | P.203 | 19/11/2026 | 11/12/2026 | 4.400.000đ | 3.000.000đ | Đang lưu trú dài hạn |
| `LIK00829` | Viktoria | P.503 | 05/11/2026 | 05/12/2026 | 6.000.000đ | 6.000.000đ | Đang lưu trú dài hạn |
| `LIK00827` | Ấn Độ Monty | P.501 | 04/11/2026 | 04/12/2026 | 5.500.000đ | 5.500.000đ | Đang lưu trú dài hạn |
| `LIK00849` | khách nga  Irina | P.401 | 26/11/2026 | 03/12/2026 | 5.500.000đ | 5.500.000đ | Đang lưu trú dài hạn |
| `LIK00822` | lishuang | P.201 | 01/11/2026 | 01/12/2026 | 5.500.000đ | 5.500.000đ | Đang lưu trú dài hạn |
| `LIK00842` | Daria Shvetsova | P.502 | 23/11/2026 | 30/11/2026 | 1.927.800đ | 1.947.800đ | Đang lưu trú dài hạn |
| `LIK00820` | DZHAMALUDINOV MAGOMEDSULTAN | P.204 | 31/10/2026 | 30/11/2026 | 6.000.000đ | 6.000.000đ | Đang lưu trú dài hạn |
| `LIK00851` | Lan hướng dẫn | P.304 | 27/11/2026 | 28/11/2026 | 250.000đ | 0đ | Trả phòng hôm nay 28/11 |
| `LIK00850` | lishuang | P.302 | 26/11/2026 | 28/11/2026 | 600.000đ | 600.000đ | Trả phòng hôm nay 28/11 |
| `LIK00847` | QIU TINGGEN K K | P.404 | 25/11/2026 | 28/11/2026 | 900.000đ | 900.000đ | Trả phòng hôm nay 28/11 |

### 4.2. Danh sách đơn đặt trước (`reserved`)

| Mã GoHost | Khách hàng | Phòng | Nhận phòng | Trả phòng | Tiền phòng | Đã thanh toán |
|---|---|---|---|---|---:|---:|
| `LIK00848` | Trương Thúy Vy | P.502, P.202, P.302, P.304 | 29/11/2026 | 12/12/2026 | 16.300.000đ | 1.000.000đ |
| `LIK00685` | Nguyen Thi anh thu | P.302 | 12/01/2027 | 17/01/2027 | 1.549.125đ | 0đ |

---

## 5. CẢNH BÁO XUNG ĐỘT LỊCH PHÒNG & ĐIỂM CẦN CHỦ DỰ ÁN XÁC NHẬN TRƯỚC KHI GO-LIVE

> [!WARNING]
> Quá trình kiểm toán chỉ mục khóa phòng `room_occupancy` phát hiện **4 cặp xung đột lịch phòng** trên các đơn đang hoạt động (tập trung tại **P.502** và **P.404**):

| Phòng | Đơn A | Thời gian A | Đơn B | Thời gian B | Khuyến nghị xử lý |
|---|---|---|---|---|---|
| **P.502** | `LIK00848-502` (Trương Thúy Vy, `reserved`) | 29/11/2026 → 12/12/2026 | `LIK00842` (Daria Shvetsova, `in_house`) | 23/11/2026 → 30/11/2026 | Xác nhận khách thực tế đang ở P.502 và đổi phòng hoặc rút ngày trả cho đơn còn lại trước khi ghi Production |
| **P.502** | `LIK00848-502` (Trương Thúy Vy, `reserved`) | 29/11/2026 → 12/12/2026 | `LIK00783-502` (SOLGALOVA VERONIKA, `in_house`) | 17/10/2026 → 17/12/2026 | Xác nhận khách thực tế đang ở P.502 và đổi phòng hoặc rút ngày trả cho đơn còn lại trước khi ghi Production |
| **P.404** | `LIK00847` (QIU TINGGEN, `in_house`) | 25/11/2026 → 28/11/2026 | `LIK00783-404` (SOLGALOVA VERONIKA, `in_house`) | 17/10/2026 → 17/12/2026 | Xác nhận khách thực tế đang ở P.404 và đổi phòng hoặc rút ngày trả cho đơn còn lại trước khi ghi Production |
| **P.502** | `LIK00842` (Daria Shvetsova, `in_house`) | 23/11/2026 → 30/11/2026 | `LIK00783-502` (SOLGALOVA VERONIKA, `in_house`) | 17/10/2026 → 17/12/2026 | Xác nhận khách thực tế đang ở P.502 và đổi phòng hoặc rút ngày trả cho đơn còn lại trước khi ghi Production |

### Lưu ý bổ sung về Công nợ OTA (`export-11-receivables.xlsx`)
- Phát hiện **1 dòng công nợ** có mã đặt phòng không tồn tại trong `ds-bookings.xlsx`: `LIK00001` (expedia, HAK JIN KIM, 650.000đ, Chưa thu).
- Có 1 khoản `Chưa thu` thuộc nguồn `walk-in` (`LIK00422` — `EVgeniia Novikova`, `1.147.500đ`), đã gắn `paymentMethod: ota_debt` & `otaSettlementStatus: pending_ota` để hiển thị theo dõi công nợ.

---

## 6. Kết Quả Kiểm Chứng Trên Firebase Local Emulator Suite

- **Thời gian ghi toàn bộ dữ liệu vào Local Emulator:** `4741 ms` (tổng `3134` tài liệu)
- **Số lượng tài liệu xác minh đọc ngược từ Firestore Emulator:**
  - `rooms`: **15** (15/15 phòng chuẩn GoHost)
  - `bookings`: **962** (từ `807` dòng GoHost, tách `92` đơn đoàn)
  - `booking_groups`: **92**
  - `guests`: **663**
  - `transactions`: **841** (`827` phiếu thu thực tế + `14` phiếu chi vận hành)
  - `ota_payout_batches`: **4**
  - `room_occupancy`: **549** tài liệu chỉ mục ngày-phòng (phát hiện **28** ngày-phòng giao cắt tại: `room_404, room_502`)

---

## 7. Cổng Dừng Phê Duyệt Go-Live (Chờ Lệnh Chủ Dự Án)

Production `likefamilypms` hiện **vẫn nguyên vẹn 100%** (chưa xóa `QA2M_*` và chưa ghi dữ liệu GoHost). Để thực hiện chuyển đổi chính thức lên Production, xin Chủ dự án xác nhận 3 điểm:
1. **Phương án xử lý xung đột P.502 & P.404** giữa `LIK00783` (`SOLGALOVA VERONIKA`), `LIK00842` (`Daria Shvetsova`), `LIK00847` (`QIU TINGGEN K K`) và `LIK00848` (`Trương Thúy Vy`).
2. **Xác nhận bảng ánh xạ 15 phòng** ở Mục 1 (đặc biệt 3 nhóm phòng đôi `Có Ban Công` / `Không Ban Công` / `Gia Đình`).
3. **Phê duyệt lệnh Go-Live chính thức:** Sao lưu nóng → Dọn sạch `1,496` bản ghi `QA2M_*` + khóa `qa_runner` → Ghi dữ liệu GoHost 2026 lên `likefamilypms` → Dựng `room_occupancy` → Khóa sổ lịch sử (`accountingLockDate`).
