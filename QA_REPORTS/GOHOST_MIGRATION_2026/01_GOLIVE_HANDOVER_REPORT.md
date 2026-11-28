# Biên Bản Bàn Giao Go-Live Chính Thức — Like Family PMS `v2.2.2` (Production `likefamilypms`)

- **Thời điểm bàn giao Go-Live:** `2026-11-28 08:58 (UTC+7)`
- **Hệ thống Production:** https://likefamilypms.web.app (Nhân viên: `/` · SuperAdmin gốc: `/superadmin`)
- **Firebase Project ID:** `likefamilypms` (Gói **0đ Firebase Spark** — không Billing/Blaze, không Cloud Functions, không Storage, không Google Sign-In)
- **Nhánh mã nguồn:** `fix/v2.2.2`
- **Bản sao lưu nóng trước Go-Live:** `backups/firestore_backup_pre_golive_2026-11-28.json` (`2,442.6 KB`)
- **Bút toán nhật ký kiểm toán Go-Live:** `audit_logs/aud_golive_2026_11_28` (bất biến)

---

## 1. Xác Nhận Làm Sạch Dữ Liệu QA & Thu Hồi Tài Khoản Test

| Hạng mục | Kết quả thực thi trên Production `likefamilypms` | Trạng thái |
|---|---|:-:|
| Sao lưu nóng trước Go-Live | Xuất trọn vẹn `backups/firestore_backup_pre_golive_2026-11-28.json` (`2,442.6 KB`) | **DONE** |
| Dọn sạch dữ liệu mẫu `QA2M_*` & UAT | Đã xóa sạch 100% trên 10 collection nghiệp vụ (`bookings`, `transactions`, `guests`, `booking_groups`, `room_maintenances`, `ota_payout_batches`, `ota_adjustments`, `post_checkout_adjustments`, `shift_handovers`, `room_occupancy`) | **DONE** |
| Bảo toàn cấu hình & nhân sự thật | Giữ nguyên 100% `system_meta`, `hotel_config/main`, `room_types`, `form_templates`, `audit_logs` (`37` bản ghi lịch sử + `1` bản ghi Go-Live = `38`) và 2 tài khoản quản trị thật (`ducphuong84`, `likefamilyhotel`) | **VERIFIED** |
| Thu hồi tài khoản `qa_runner@likefamilyhotel.com` | Đã xóa hồ sơ `staff_users/POtrN1IKzHVHBoULChYpINezSQ32` và xóa vĩnh viễn UID `POtrN1IKzHVHBoULChYpINezSQ32` khỏi Firebase Authentication (đăng nhập thử bị chặn hoàn toàn) | **REVOKED** |

---

## 2. Kết Quả Nạp Dữ Liệu GoHost 2026 & Kiểm Toán Khóa Phòng (`0` Xung Đột)

| Collection trên Production `likefamilypms` | Số tài liệu xác minh đọc ngược | Ghi chú kiểm toán |
|---|---:|---|
| `rooms` | **`15`** | 4 Phòng đơn (`203, 303, 403, 502` → `rt_std_single`) · 4 Đôi Có Ban Công (`201, 301, 401, 503` → `rt_dbl_balk`) · 4 Đôi Không Ban Công (`202, 302, 402, 501` → `rt_dbl_nobalk`) · 3 Gia Đình (`204, 304, 404` → `rt_family`); không tạo 4 phòng đóng Tầng 1 (`101–104`) |
| `bookings` | **`962`** | Chuyển đổi từ `807` dòng `ds-bookings.xlsx` (`91` đơn đoàn + `1` chuỗi split-stay `LIK00783` 3 chặng + `80` đơn nghỉ giờ) |
| `booking_groups` | **`91`** | Bao gồm đoàn `LIK00848` (`Trương Thúy Vy`, 4 phòng, cọc `1.000.000đ`) |
| `guests` | **`663`** | Khử trùng từ `706` dòng `ds-customers.xlsx` và đồng bộ khách từ đơn |
| `transactions` | **`841`** | `827` phiếu thu thực tế (**`710.658.181đ`** — Tiền mặt `313.587.973đ`, CK `391.570.208đ`, Wechat Pay `5.500.000đ`; không tạo thu tiền mặt giả cho cột `Công nợ`) + `14` phiếu chi vận hành (**`66.442.512đ`**) |
| `ota_payout_batches` | **`4`** | `26` khoản OTA đã hoàn tất = **`37.603.722đ`** |
| `room_occupancy` | **`432`** | **`conflictsDetected = 0` trên toàn bộ `15/15` phòng (`P.201` → `P.503`)** |
| `hotel_config/main.accountingLockDate` | **`2026-10-31`** | Khóa sổ toàn bộ kỳ lịch sử `01/01/2026 → 31/10/2026`; giữ mở tháng `11/2026` cho lễ tân vận hành |

---

## 3. Xác Nhận Xử Lý Các Điểm Chốt Từ Chủ Dự Án

1. **Đoàn `LIK00848` (`Trương Thúy Vy` — `16.300.000đ`, đã cọc `1.000.000đ`, `reserved`):**
   - `LIK00848-202` (`room_202`): `29/11/2026 → 12/12/2026` (`13` đêm)
   - `LIK00848-302` (`room_302`): `29/11/2026 → 12/12/2026` (`13` đêm)
   - `LIK00848-502` (`room_502`): `30/11/2026 → 12/12/2026` (`12` đêm — nối tiếp ngay sau `LIK00842` trả `P.502` ngày `30/11/2026`, `0` xung đột)
   - `LIK00848-304` (`room_304`): `30/11/2026 → 12/12/2026` (`12` đêm)
2. **Khách chuyển phòng dài hạn `LIK00783` (`SOLGALOVA VERONIKA` — `61` đêm, `10.000.000đ`, đã TT đủ, chuỗi `chain_gh_LIK00783`):**
   - Chặng 1 `LIK00783-502` (`room_502`): `17/10/2026 → 27/10/2026` (`10` đêm, `1.612.900đ`, `checked_out`)
   - Chặng 2 `LIK00783-404` (`room_404`): `27/10/2026 → 02/11/2026` (`6` đêm, `967.740đ`, `checked_out`)
   - Chặng 3 `LIK00783-403` (`room_403`): `02/11/2026 → 17/12/2026` (`45` đêm, `7.419.360đ`, `in_house`)
   - Giữ nguyên đơn `LIK00782` tại `room_303` (`17/10/2026 → 17/12/2026`, `10.000.000đ`, `in_house`).
3. **Đơn quá hạn, Cọc hủy & Công nợ đặc biệt:**
   - `LIK00813` (`MUKHAMETSHIN BULAT`, `P.301, P.304`) cùng `18` đơn quá hạn khác (`checkOut < 28/11/2026`) và `LIK00231` (`30/03/2026`) đã chuyển `checked_out`.
   - `3` đơn hủy có tiền thu (`LIK00681` `250.000đ`, `LIK00425` `200.000đ`, `LIK00081` `700.000đ` = **`1.150.000đ`**) đã ghi nhận `depositResolutionStatus: 'forfeited_fee'`, `depositDisposition: 'forfeited'` (0 cảnh báo cọc treo).
   - Bỏ qua hoàn toàn `LIK00001` (`Expedia`, `650.000đ`, T08/2025); giữ lại `LIK00422` (`EVgeniia Novikova`, `1.147.500đ`) trong công nợ chờ thu (`66` khoản 2026 = **`60.351.610đ`**).

---

## 4. Đối Chiếu Tổng Kết Tài Chính P&L Năm 2026 (Trên Production)

| Chỉ tiêu P&L năm 2026 (`01/01/2026 → 31/12/2026`) | Giá trị | Ghi chú kiểm toán |
|---|---:|---|
| Tổng tiền phòng đơn không hủy (GoHost gốc) | **`877.921.238đ`** | Khớp `0đ` lệch với `ds-bookings.xlsx` |
| Doanh thu phòng P&L dồn tích năm 2026 | **`857.908.189đ`** | `2.930` đêm + `84` nghỉ giờ (trừ `17.849.125đ` của 2 đơn `reserved` & `2.163.924đ` phần 12 đêm T01/2027 của `LIK00830`) |
| Doanh thu dịch vụ (`207/207` dòng `businessDate` bất biến) | **`19.203.200đ`** | Đồ uống `3.033.000đ` (`120`) · Dịch vụ `6.640.000đ` (`27`) · Phụ thu `9.530.200đ` (`60`) — `0đ` lệch `BUG-01` |
| Doanh thu phí phạt hủy giữ cọc (`3` đơn hủy) | **`1.150.000đ`** | `LIK00681` + `LIK00425` + `LIK00081` |
| **Tổng doanh thu P&L năm 2026** | **`878.261.389đ`** | Tổng 12 tháng lẻ T01–T12 = Cả năm 2026 (**`0đ` lệch**) |
| Tổng chi phí vận hành (`14` phiếu chi) | **`66.442.512đ`** | Khớp `0đ` lệch với `export-13-transactions.xlsx` |
| **Lợi nhuận ròng P&L năm 2026** | **`811.818.877đ`** | — |
| Công nợ OTA/khách chờ thu năm 2026 (`66` khoản) | **`60.351.610đ`** | Đã loại `LIK00001` (2025), giữ `LIK00422` (`1.147.500đ`) |

---

## 5. Trạng Thái 15 Phòng Thực Tế Tại Thời Điểm Bàn Giao (`28/11/2026`)

### 5.1. Danh sách 14 phòng đang có khách (`in_house`: 11 phòng dài hạn + 3 phòng trả hôm nay `28/11`) & 1 phòng trống (`P.202`)

| Phòng | Hạng phòng chuẩn | Trạng thái | Mã đơn `currentBookingId` | Khách hàng | Thời gian lưu trú |
|---|---|---|---|---|---|
| **P.201** | Phòng Đôi Có Ban Công | Đang ở (`in_house`) | `LIK00822` | lishuang | 01/11/2026 → 01/12/2026 |
| **P.202** | Phòng Đôi Không Ban Công | **Trống sạch (`clean`)** | — *(đón `LIK00848-202` ngày 29/11)* | — | — |
| **P.203** | Phòng Đơn Tiêu Chuẩn | Đang ở (`in_house`) | `LIK00843` | DUBENCHUK ANNA | 19/11/2026 → 11/12/2026 |
| **P.204** | Phòng Gia Đình 2 Giường Lớn | Đang ở (`in_house`) | `LIK00820` | DZHAMALUDINOV MAGOMEDSULTAN | 31/10/2026 → 30/11/2026 |
| **P.301** | Phòng Đôi Có Ban Công | Đang ở (`in_house`) | `LIK00835` | GRIGOREV SEMEN | 12/11/2026 → 12/12/2026 |
| **P.302** | Phòng Đôi Không Ban Công | Đang ở *(trả hôm nay 28/11)* | `LIK00850` | lishuang | 26/11/2026 → 28/11/2026 |
| **P.303** | Phòng Đơn Tiêu Chuẩn | Đang ở (`in_house`) | `LIK00782` | SOLGALOVA VERONIKA | 17/10/2026 → 17/12/2026 |
| **P.304** | Phòng Gia Đình 2 Giường Lớn | Đang ở *(trả hôm nay 28/11)* | `LIK00851` | Lan hướng dẫn | 27/11/2026 → 28/11/2026 |
| **P.401** | Phòng Đôi Có Ban Công | Đang ở (`in_house`) | `LIK00849` | khách nga Irina | 26/11/2026 → 03/12/2026 |
| **P.402** | Phòng Đôi Không Ban Công | Đang ở (`in_house`) | `LIK00830` | Vagazov | 13/11/2026 → 13/01/2027 |
| **P.403** | Phòng Đơn Tiêu Chuẩn | Đang ở (`in_house`) | `LIK00783-403` | SOLGALOVA VERONIKA | 02/11/2026 → 17/12/2026 |
| **P.404** | Phòng Gia Đình 2 Giường Lớn | Đang ở *(trả hôm nay 28/11)* | `LIK00847` | QIU TINGGEN | 25/11/2026 → 28/11/2026 |
| **P.501** | Phòng Đôi Không Ban Công | Đang ở (`in_house`) | `LIK00827` | Ấn Độ Monty | 04/11/2026 → 04/12/2026 |
| **P.502** | Phòng Đơn Tiêu Chuẩn | Đang ở (`in_house`) | `LIK00842` | Daria Shvetsova | 23/11/2026 → 30/11/2026 |
| **P.503** | Phòng Đôi Có Ban Công | Đang ở (`in_house`) | `LIK00829` | Viktoria | 05/11/2026 → 05/12/2026 |

### 5.2. Danh sách 2 đơn đặt trước (`reserved` — `5` phòng con)
1. **Đoàn `LIK00848` (`Trương Thúy Vy`, `16.300.000đ`, đã cọc `1.000.000đ`):** `P.202` (`29/11→12/12`), `P.302` (`29/11→12/12`), `P.502` (`30/11→12/12`), `P.304` (`30/11→12/12`).
2. **Đơn lẻ `LIK00685` (`Nguyen Thi anh thu`, `1.549.125đ`):** `P.302` (`12/01/2027 → 17/01/2027`).

---

## 6. Kết Luận Bàn Giao

Hệ thống **Like Family PMS `v2.2.2`** đã chính thức **GO-LIVE** trên `https://likefamilypms.web.app` với dữ liệu vận hành thực tế năm 2026 từ GoHost, **`0` xung đột trên toàn bộ `15/15` phòng**, khóa sổ lịch sử đến hết **`31/10/2026`**, và thu hồi hoàn toàn dữ liệu/tài khoản QA. Chủ khách sạn (`likefamilyhotel`) và SuperAdmin (`ducphuong84`) có thể đăng nhập và vận hành chính thức ngay từ bây giờ.
