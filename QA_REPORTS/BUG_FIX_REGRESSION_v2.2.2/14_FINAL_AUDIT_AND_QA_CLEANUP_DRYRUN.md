# 14 — FINAL PRE-HANDOVER AUDIT & QA CLEANUP DRY RUN (`v2.2.2`)

- **Dự án:** Like Family Hotel PMS (`likefamilypms`)
- **Nhánh GitHub:** `fix/v2.2.2`
- **Ngày thực hiện kiểm toán:** `27/11/2026` (múi giờ `Asia/Ho_Chi_Minh`, UTC+7)
- **Ràng buộc an toàn đã tuân thủ tuyệt đối:**
  - **0đ Firebase Spark:** `0` Cloud Functions, `0` import `firebase/storage`, `0` import `GoogleAuthProvider`, không bật Billing/Blaze.
  - **Cô lập Production:** Toàn bộ kiểm thử ghi dữ liệu, diễn tập phục hồi và Playwright UI chạy 100% trên **Firebase Local Emulator Suite** (`auth:9099`, `firestore:8080`).
  - **Cổng Dừng (Mandatory Stop Gate):** Hạng mục 5 chỉ quét **chỉ đọc (`DRY RUN` — `0` lệnh xóa, `0` lệnh sửa)** trên `likefamilypms`. Chưa xóa dữ liệu QA `QA2M_*`, chưa khóa tài khoản `qa_runner@likefamilyhotel.com`, chưa deploy Production.

---

## TÓM TẮT KẾT QUẢ 5 HẠNG MỤC KIỂM TOÁN BỔ SUNG

| Hạng mục | Nội dung kiểm toán | Kết quả | Minh chứng chính |
| :-: | --- | :-: | --- |
| **1** | Xung đột lịch P.502 & kiểm toán 15/15 phòng | **PASS** | Đã xác định nguyên nhân `QA2M_BKG_0433` vs `QA2M_MNT_0014` (`room_502_2026-11-28`); sau xử lý trên Emulator đạt **`15/15` phòng = `0` xung đột**, `missing=0`, `mismatched=0` |
| **2** | Kiểm toán đường ghi `room_occupancy`, `firestore.rules` & UX lỗi Transaction | **PASS** | Quét 100% mã nguồn `src/` (`49` điểm ghi); phát hiện & bịt kín 4 lỗ hổng thực tế ngay trước Go-Live; `validOccupancyDoc()` PASS 100%; UI hiển thị toast tiếng Việt rõ, nhả nút lưu ngay, **`0` giao dịch cọc / booking / hồ sơ khách mồ côi** |
| **3** | 4 kịch bản tài chính biên trên Local Emulator | **PASS** | Hủy dịch vụ khác tháng (kỳ mở & kỳ khóa `30/11` đều lệch `0đ`), Hoàn tiền trước & sau check-out, Điều chỉnh sau check-out (`+250k`/`-100k`), Khóa sổ 2 lớp App + Rules (`<= 30/11` bị chặn, `>= 01/12` cho phép) |
| **4** | 1-Click Backup JSON UI, Restore & Phục hồi quyền quản trị | **PASS** | Tải tệp `LikeFamilyPMS_Backup_27-11-2026.json` (`1,920.2 KB`) từ UI khớp `500` đơn / `681` tx / `260` khách / `15` phòng; diễn tập SuperAdmin khôi phục quyền Chủ KS bị khóa/hạ quyền PASS & bảo toàn `audit_logs` bất biến |
| **5** | Quét `DRY RUN` dữ liệu QA cần xóa trên `likefamilypms` | **PASS (DRY RUN)** | Đề xuất xóa **`1,496` tài liệu QA** (`9` collection nghiệp vụ) + thu hồi **`1` tài khoản tạm `qa_runner`**; bảo toàn nguyên vẹn **`100%` (`45` tài liệu)** cấu hình, phòng, biểu mẫu, nhân sự thật và `audit_logs` |

- **Tổng kết kiểm thử tự động vòng kiểm toán bổ sung:** **`10 / 10 PASS` (`8` Local Emulator + `2` Playwright UI, `0 FAIL`, `0 BLOCKED`)**; `npm run build` (`tsc -b && vite build`) = **`0` lỗi** (`5.89s`).

---

## HẠNG MỤC 1 — XỬ LÝ XUNG ĐỘT LỊCH P.502 & KIỂM TOÁN TOÀN BỘ 15/15 PHÒNG

### 1.1. Truy vết chi tiết cặp xung đột lịch sử tại `room_502_2026-11-28`
- **Đơn đặt phòng `QA2M_BKG_0433` (`S2M-0433`):** Khách `Nguyễn Hữu Hà` (`QA2M_GST_0137`), nhận phòng `25/11/2026`, trả phòng `28/11/2026` (`12:00` + 5 phút đệm dọn phòng = `12:05`), trạng thái `in_house`.
- **Phiếu bảo trì `QA2M_MNT_0014`:** Tiêu đề *"Sửa khóa từ cửa phòng"*, khoảng ngày `28/11/2026 → 29/11/2026` (chiếm trọn khung `28/11 00:00 → 30/11 00:00`), trạng thái `in_progress`.
- **Nguyên nhân:** Bộ script nạp dữ liệu mẫu `QA2M_*` trước `v2.2.2` tạo phiếu bảo trì bắt đầu từ `00:00` ngày `28/11` trong khi khách `QA2M_BKG_0433` chỉ trả phòng lúc `12:00` ngày `28/11` (và P.502 cũng có đơn tiếp nối giai đoạn `29–30/11`).
- **Xử lý kiểm chứng trên Local Emulator:** Đánh dấu hoàn tất phiếu bảo trì `QA2M_MNT_0014` (`status: 'completed'`, `completedAt: '2026-11-28T13:00:00.000Z'`) rồi chạy `auditAndRebuildOccupancy(..., false)` và hậu kiểm `auditAndRebuildOccupancy(..., true)` (lưu ý: trên thực tế, khi Chủ dự án duyệt xóa bộ dữ liệu QA `QA2M_*` ở Hạng mục 5, cả 2 bản ghi mẫu này đều được dọn sạch).

### 1.2. Bảng kết quả kiểm toán toàn bộ 15/15 phòng sau xử lý (Local Emulator)

| # | Mã phòng | Số phòng | Tầng | Đơn đang giữ/ở | Bảo trì đang mở | Số xung đột (`room_occupancy`) | Trạng thái |
| :-: | --- | :-: | --- | :-: | :-: | :-: | :-: |
| 1 | `room_201` | `201` | Tầng 2 | 3 | 0 | **0** | ✅ Sạch |
| 2 | `room_202` | `202` | Tầng 2 | 3 | 0 | **0** | ✅ Sạch |
| 3 | `room_203` | `203` | Tầng 2 | 2 | 0 | **0** | ✅ Sạch |
| 4 | `room_204` | `204` | Tầng 2 | 3 | 0 | **0** | ✅ Sạch |
| 5 | `room_301` | `301` | Tầng 3 | 3 | 0 | **0** | ✅ Sạch |
| 6 | `room_302` | `302` | Tầng 3 | 2 | 0 | **0** | ✅ Sạch |
| 7 | `room_303` | `303` | Tầng 3 | 3 | 0 | **0** | ✅ Sạch |
| 8 | `room_304` | `304` | Tầng 3 | 3 | 0 | **0** | ✅ Sạch |
| 9 | `room_401` | `401` | Tầng 4 | 3 | 0 | **0** | ✅ Sạch |
| 10 | `room_402` | `402` | Tầng 4 | 3 | 0 | **0** | ✅ Sạch |
| 11 | `room_403` | `403` | Tầng 4 | 2 | 0 | **0** | ✅ Sạch |
| 12 | `room_404` | `404` | Tầng 4 | 3 | 0 | **0** | ✅ Sạch |
| 13 | `room_501` | `501` | Tầng 5 | 2 | 1 | **0** | ✅ Sạch |
| 14 | `room_502` | `502` | Tầng 5 | 2 | 0 | **0** | ✅ Sạch |
| 15 | `room_503` | `503` | Tầng 5 | 2 | 0 | **0** | ✅ Sạch |

- **Tổng hợp chỉ mục sau rebuild (`AUDIT-1-P502-ALL15`):** `expectedDocCount = 77`, `missingDocs = 0`, `mismatchedDocs = 0`, `staleDocs = 0`, **`conflictsDetected = 0` trên toàn bộ `15/15` phòng** (`P.201` đến `P.503` — toàn bộ danh mục 15 phòng thực tế của khách sạn).

---

## HẠNG MỤC 2 — KIỂM TOÁN ĐƯỜNG GHI `room_occupancy`, FIRESTORE RULES & UX LỖI TRANSACTION

### 2.1. Kết quả quét tĩnh 100% mã nguồn `src/` (`49` điểm ghi Firestore vào `bookings` & `room_maintenances`)
- Toàn bộ **15/15 luồng thay đổi lịch chiếm dụng phòng** (`createBooking`, `createGroupBooking`, `checkOutBooking`, `cancelBooking`, `updateBookingPricing`, `transferBookingRoom` simple & split-stay, `consolidateRoomIntoTarget`, `createRoomMaintenance`, `completeRoomMaintenance`, `updateRoomMaintenanceSchedule`, `executeAccountingCancellation`, `restoreCancelledBooking`, `reverseCheckInBooking`, `executeEarlyCheckOut`, `reopenCheckedOutBooking` chế độ `reopen_stay`) đều chạy trong `runTransaction()` qua `occupancyService.ts`.
- Các điểm ghi còn lại (`checkInBooking` giữ nguyên phòng/ngày, `resolvePendingDeposit`, `updateOtaCancelWorkflow`, `addBookingService`, `removeBookingService`, `voidBookingService`, `updateHourlySurcharge`, `saveBookingOccupants`, `markOccupantAsmDeclared`, `mergeBookingsIntoGroup`, `recordTransaction`, `voidTransactionWithUndo`, `createOtaPayoutBatch`, `voidCheckedOutBooking`, `reopenCheckedOutBooking` chế độ `billing_only`, `recordPostCheckoutAdjustment`) chỉ cập nhật trường tài chính/dịch vụ/khách/OTA, không thay đổi lịch phòng.

### 2.2. 4 lỗ hổng thực tế được phát hiện & khắc phục triệt để ngay trong phiên kiểm toán
1. **Bịt kín đường ghi vòng `undoBookingAction()` (`src/lib/pmsActions.ts`):** Trước kiểm toán vẫn dùng `writeBatch()` trực tiếp; đã chuyển hoàn toàn sang `runTransaction()` kết hợp `prepareOccupancyPlanInTransaction()` + `applyOccupancyPlanInTransaction()`.
2. **Mở rộng `updateBookingPricing()` (`src/lib/pmsActions.ts`):** Bổ sung điều kiện `hourlyHours` thay đổi trên đơn nghỉ giờ cũng chạy qua `runTransaction()` để cập nhật khóa `room_occupancy`.
3. **Sửa lỗi `undefined` field trên `tx.set()` (`stripUndefined()` trong `src/lib/pmsActions.ts`):** Bắt gặp trực tiếp khi chạy `createBooking()` thật với đơn ngày/đêm (`hourlyHours: undefined` khiến Firestore SDK ném `invalid-argument`). Đã thêm `stripUndefined()` cho `createBooking`, `createGroupBooking`, `transferBookingRoom` (split-stay) và `createRoomMaintenance`.
4. **Chống sinh hồ sơ khách mồ côi khi `OCCUPANCY_CONFLICT` (`src/lib/pmsActions.ts`):** Dời `upsertGuestProfile()` chạy **sau** khi `runTransaction()` thành công — đảm bảo khi tranh chấp phòng xảy ra, **`0` booking, `0` giao dịch cọc và `0` hồ sơ `guests` mồ côi** được ghi xuống DB.

### 2.3. Kiểm toán chéo `firestore.rules` (`validOccupancyDoc()`)
Đã định nghĩa hàm chuẩn `validOccupancyDoc()` kiểm tra chặt `keys().hasOnly(['roomId', 'date', 'intervals', 'updatedAt'])`, `roomId.size() > 0`, `date.size() == 10`, `intervals is list`, `updatedAt is string`:
- **`AUDIT-2-RULES-VALIDOCC` (PASS):**
  - Khách chưa đăng nhập đọc `room_occupancy` → `PERMISSION_DENIED` ✅
  - Ghi trường thừa (`rogueField`) → `PERMISSION_DENIED` ✅
  - Ghi sai định dạng ngày (`2026/12/2`) → `PERMISSION_DENIED` ✅
  - Lễ tân xóa `room_occupancy` → `PERMISSION_DENIED` ✅
  - Chủ KS (`owner`) xóa `room_occupancy` → `PERMISSION_DENIED` ✅
  - SuperAdmin gốc xóa `room_occupancy` → `ALLOWED` ✅

### 2.4. Kiểm thử hành vi UI/UX khi Transaction thất bại (`AUDIT-2-UI-CONFLICT-UX` & `AUDIT-2-ZERO-ORPHAN-TX`)
- **Kịch bản Playwright thực tế trên Local Emulator:** Mở Drawer `+ Đặt phòng mới` trên P.201 ngày `20–21/12/2026` (đang trống trên UI), nhập tên khách và tiền cọc `250.000đ`, tiêm khóa `room_occupancy/room_201_2026-12-20` ngay trước khi bấm nút lưu (mô phỏng lễ tân khác giữ chỗ trước 1ms).
- **Kết quả xác minh trực tiếp trên DOM (ảnh `screenshots/audit2_occupancy_conflict_ux.png`):**
  - Hiển thị toast đỏ tiếng Việt rõ ràng: *"OCCUPANCY_CONFLICT: P.201 ngày 2026-12-20 bị trùng với đơn đặt phòng khác (CONCURRENT_WINNER_999, gồm đệm dọn phòng 5 phút). Vui lòng chọn phòng hoặc khung giờ khác."*
  - Khối `try / catch / finally { setSubmitting(false) }` nhả trạng thái nút lưu ngay lập tức (`btnDisabled = false`, nhãn quay lại `"Tạo đơn & Check-in"`, không treo `"Đang lưu..."`).
  - Đối chiếu Firestore trước/sau khi bấm lưu: `bookings = 500 → 500`, `transactions = 681 → 681` (**0 giao dịch cọc mồ côi**), `guests = 260 → 260` (**0 hồ sơ khách mồ côi**).

---

## HẠNG MỤC 3 — 4 KỊCH BẢN TÀI CHÍNH BIÊN TRÊN LOCAL EMULATOR

| Mã test | Kịch bản tài chính biên | Kết quả thực tế đo được | Trạng thái |
| --- | --- | --- | :-: |
| `AUDIT-3A-VOID-SERVICE` | **Hủy dịch vụ khác tháng (`T11 → T12`)** trên dịch vụ `150.000đ` ngày `19/11`: (a) Kỳ mở (`voidBookingService` đánh dấu `status: 'voided'`, không rò rỉ vào fallback `serviceTotal`); (b) Kỳ đã khóa `30/11/2026` | (a) Kỳ mở: `mode=marked_voided`, `T11=0đ, T12=0đ, 2M=0đ` (lệch `0đ`). (b) Kỳ khóa `30/11`: thử hủy lùi `28/11` bị chặn (`lockedRetroBlocked=true`); hủy ngày `03/12` giữ nguyên T11 đã khóa (`+150.000đ`) và ghi dòng đối ứng T12 (`-150.000đ`), tổng `T11 + T12 = 0đ === 2M` (**lệch `0đ`**) | **PASS** |
| `AUDIT-3B-REFUND` | **Hoàn tiền trước & sau check-out:** Cọc `500k` → hoàn `200k` trước check-in → khách trả dư `900k` khi check-out (tổng bill `1.000k`) → hoàn `200k` sau check-out | Trước CO: `depositPaid=300.000đ, guestPaid=0đ`. Sau CO: `depositPaid=300.000đ, guestPaid=700.000đ, công nợ còn lại = 0đ`. Tổng phiếu chi hoàn tiền sổ quỹ = `400.000đ` (cân 100%) | **PASS** |
| `AUDIT-3C-POSTCO-ADJ` | **Điều chỉnh sau Check-out (`post_checkout_adjustments`):** Đơn check-out `20/11` (kỳ đã khóa `20/11`), ghi nhận tăng `+250.000đ` (thu tiền mặt) và giảm `-100.000đ` (hoàn chuyển khoản) vào ngày mở `27/11` | Cả 2 bút toán ghi đúng kỳ mở `postingDate=2026-11-27`; `serviceTotal=150.000đ`, `guestPaid=850.000đ`, `công nợ còn lại=0đ`; P&L kỳ khóa `01–20/11` giữ nguyên `0đ`, kỳ mở `21–30/11` ghi `+150.000đ` | **PASS** |
| `AUDIT-3D-LOCK-2LAYER` | **Khóa sổ kế toán `accountingLockDate = 2026-11-30`:** Thử hoàn tiền, thêm dịch vụ, tạo `transactions` và `post_checkout_adjustments` ngày `30/11/2026`, sau đó thử lại ngày `01/12/2026` | Chặn 2 lớp độc lập: App (`assertPeriodOpen`) chặn refund & addBookingService `30/11`; Firestore Rules (`isPeriodOpenForDate`) chặn `transactions` & `post_checkout_adjustments` `30/11` (`PERMISSION_DENIED`); ghi ngày `01/12/2026` thành công 100% | **PASS** |

---

## HẠNG MỤC 4 — 1-CLICK BACKUP JSON UI, RESTORE & PHỤC HỒI QUYỀN QUẢN TRỊ

### 4.1. Kiểm thử tính năng 1-Click Backup JSON trên giao diện (`AUDIT-4-1CLICK-BACKUP-UI`)
- Đăng nhập tài khoản SuperAdmin gốc (`ducphuong84@gmail.com`) tại `/superadmin` → vào **Cài đặt & Sao lưu → Dọn ảnh cũ & Sao lưu (SuperAdmin)** → bấm **"Xuất dữ liệu gốc (.json)"** (ảnh `screenshots/audit4_1click_backup_ui.png`).
- **Kết quả xác thực tệp tải về:**
  - Tên tệp: `LikeFamilyPMS_Backup_27-11-2026.json` (`1,920.2 KB`, cú pháp JSON hợp lệ 100%).
  - Đếm trực tiếp dữ liệu trong tệp tải về khớp tuyệt đối trạng thái Emulator: `bookings = 500`, `transactions = 681`, `guests = 260`, `rooms = 15`, `hotelConfig = có đầy đủ`.
  - Kết hợp bài diễn tập khôi phục toàn vẹn đã chứng minh tại báo cáo `11_BACKUP_RESTORE_DRILL.md` (`1,519` tài liệu khôi phục trong `3.14 giây`, khớp `100%` số lượng & P&L).

### 4.2. Diễn tập phục hồi quyền truy cập quản trị (`AUDIT-4-ADMIN-RECOVERY`)
1. **Mô phỏng sự cố:** Vô hiệu hóa tài khoản Chủ KS (`owner_emu@likefamilyhotel.com`: `isActive: false`) và hạ nhầm vai trò xuống `receptionist`.
2. **Xác minh khóa tức thì bởi Firestore Rules:** Tài khoản Chủ KS lập tức nhận `PERMISSION_DENIED` khi đọc `bookings` (`disabledBlocked.read = true`) và khi cập nhật `hotel_config/main` (`disabledBlocked.cfg = true`).
3. **Phục hồi bởi SuperAdmin gốc (`ducphuong84@gmail.com`):** Khôi phục `isActive: true`, `role: 'owner'` và bộ quyền đầy đủ của Chủ KS trên `staff_users`, ghi nhận vết kiểm toán `restore_owner_access` vào `audit_logs`.
4. **Xác minh sau phục hồi:** Chủ KS đọc lại bình thường toàn bộ `15/15` phòng và cập nhật thành công `accountingLockDate` trên `hotel_config/main`. Sổ `audit_logs` tăng từ `26 → 27` bản ghi và tiếp tục chặn tuyệt đối hành vi xóa (`auditImmutable = true`).

---

## HẠNG MỤC 5 — QUÉT DRY RUN DỮ LIỆU QA CẦN XÓA TRÊN `likefamilypms` (CHỜ CHỦ DỰ ÁN DUYỆT)

> **CỔNG DỪNG BẮT BUỘC:** Quét thực hiện 100% ở chế độ **CHỈ ĐỌC (`getDocs`)** trên `likefamilypms` lúc `2026-11-27 20:31 (UTC+7)`. **KHÔNG có bất kỳ lệnh xóa hay sửa nào được thực thi.**

### 5.1. Bảng thống kê DRY RUN theo từng Collection trên `likefamilypms`

| Collection | Tổng đang có | **Đề xuất XÓA (Dữ liệu QA)** | **GIỮ NGUYÊN 100% (Hệ thống)** | Mẫu dải ID đề xuất xóa / Ghi chú bảo vệ |
| --- | ---: | ---: | ---: | --- |
| `bookings` | `500` | **`500`** | `0` | `QA2M_BKG_0001` → `QA2M_BKG_0499` + `QA2M_E2E_LIFECYCLE_01` |
| `transactions` | `681` | **`681`** | `0` | `QA2M_TX_0001` → `QA2M_TX_0679` + `QA2M_E2E_TX_DEP`, `QA2M_E2E_TX_PAY` *(lưu ý: `transactions` có rule `allow delete: if false` phía Client → cần xóa bằng Firebase Admin SDK / Console hoặc rule cửa sổ bảo trì ngắn của SuperAdmin)* |
| `guests` | `260` | **`260`** | `0` | `QA2M_GST_0001` → `QA2M_GST_0260` |
| `booking_groups` | `14` | **`14`** | `0` | `QA2M_GRP_0001` → `QA2M_GRP_0014` |
| `room_maintenances` | `14` | **`14`** | `0` | `QA2M_MNT_0001` → `QA2M_MNT_0014` |
| `ota_payout_batches` | `5` | **`5`** | `0` | `QA2M_OTABATCH_001` → `QA2M_OTABATCH_005` |
| `ota_adjustments` | `4` | **`4`** | `0` | `QA2M_OTAADJ_001` → `QA2M_OTAADJ_004` *(rule chặn client delete — xử lý đồng bộ theo quy trình bảo trì SuperAdmin)* |
| `post_checkout_adjustments` | `8` | **`8`** | `0` | `QA2M_PCADJ_001` → `QA2M_PCADJ_008` *(rule bất biến — xử lý đồng bộ theo quy trình bảo trì SuperAdmin)* |
| `shift_handovers` | `10` | **`10`** | `0` | `QA2M_SHIFT_001` → `QA2M_SHIFT_010` |
| `room_occupancy` | `0` | `0` | `0` | Chưa phát sinh trên live `likefamilypms` (vì chưa deploy `v2.2.2`); sau khi dọn QA sẽ sạch hoàn toàn |
| `guest_documents` | `0` | `0` | `0` | Rỗng (`0` ảnh giấy tờ) |
| **`hotel_config`** | `1` | **`0`** | **`1`** | 🔒 **GIỮ NGUYÊN:** `main` (sẽ tự bổ sung `bookingSources` 12 nguồn + `configMigrationVersion: 1` khi deploy `v2.2.2`) |
| **`room_types`** | `4` | **`0`** | **`4`** | 🔒 **GIỮ NGUYÊN:** `rt_dbl_balk`, `rt_dbl_nobalk`, `rt_family`, `rt_std_single` |
| **`rooms`** | `15` | **`0`** | **`15`** | 🔒 **GIỮ NGUYÊN:** `room_201` → `room_503` (`15` phòng) |
| **`form_templates`** | `3` | **`0`** | **`3`** | 🔒 **GIỮ NGUYÊN:** `booking_confirmation`, `payment_receipt`, `registration_card` |
| **`system_meta`** | `1` | **`0`** | **`1`** | 🔒 **GIỮ NGUYÊN:** `bootstrap` (SuperAdmin UID gốc `ducphuong84@gmail.com`) |
| **`audit_logs`** | `20` | **`0`** | **`20`** | 🔒 **GIỮ NGUYÊN 100%** (sổ nhật ký bất biến, không xóa) |
| **`staff_users`** | `3` | **`1` (Thu hồi riêng)** | **`2`** | 🔒 **GIỮ NGUYÊN:** `ducphuong84` (SuperAdmin), `likefamilyhotel` (Chủ KS). **Đề xuất thu hồi:** `POtrN1IKzHVHBoULChYpINezSQ32` (`qa_runner@likefamilyhotel.com`) |
| **TỔNG CỘNG** | **`1,542`** | **`1,496` docs QA + `1` tài khoản QA** | **`45` docs hệ thống** | **0 bản ghi cấu hình / nhân sự thật bị ảnh hưởng** |

### 5.2. Kiểm tra tham chiếu chéo bảo vệ cấu hình hệ thống
- Toàn bộ `500/500` đơn đặt phòng, `681/681` giao dịch, `260/260` khách, `14/14` đoàn, `14/14` bảo trì, `5/5` lô OTA, `4/4` điều chỉnh OTA, `8/8` điều chỉnh sau check-out, `10/10` bàn giao ca trên `likefamilypms` **100% đều mang tiền tố `QA2M_*`** (không có đơn khách thật nào bị lẫn, `legacyPre2mSample = 0`).
- **0 bản ghi** trong `system_meta`, `hotel_config/main`, `room_types`, `rooms`, `form_templates`, `audit_logs` và `2` tài khoản nhân sự thật (`ducphuong84`, `likefamilyhotel`) nằm trong danh sách xóa.

### 5.3. Phương án Reset trạng thái 15 phòng sau khi dọn dữ liệu QA (chờ duyệt)
Hiện tại trên `likefamilypms`, `14/15` phòng đang có `hkStatus = "clean"`, riêng **`room_501`** đang giữ `hkStatus = "maintenance"` (do phiếu bảo trì mẫu `QA2M_*`) và một số phòng có thể còn trường `currentBookingId` trỏ tới đơn `QA2M_*`.
Sau khi Chủ dự án duyệt xóa dữ liệu QA, sẽ chạy 1 batch chuẩn hóa duy nhất cho toàn bộ **15/15 phòng** (`room_201` → `room_503`):
- `hkStatus: 'clean'`
- `currentBookingId: null`
- `isActive: true` (bảo toàn 100% `roomNumber`, `floor`, `roomTypeId`, `roomTypeName`).

### 5.4. Quy trình thu hồi tài khoản tạm `qa_runner@likefamilyhotel.com` (chờ duyệt)
1. **Bước 1 — Khóa hồ sơ Firestore:** Đặt `isActive: false` (hoặc xóa document `staff_users/POtrN1IKzHVHBoULChYpINezSQ32` bằng quyền SuperAdmin gốc) để chặn ngay lập tức mọi quyền truy cập Firestore Rules.
2. **Bước 2 — Thu hồi tài khoản Firebase Auth:** Xóa hoặc vô hiệu hóa UID `POtrN1IKzHVHBoULChYpINezSQ32` (`qa_runner@likefamilyhotel.com`) trên Firebase Authentication Console / CLI.
3. **Bước 3 — Ghi nhật ký bàn giao:** Ghi 1 bản ghi bất biến vào `audit_logs` xác nhận hoàn tất dọn dữ liệu QA & thu hồi tài khoản `qa_runner` (tuyệt đối giữ nguyên toàn bộ 20 bản ghi `audit_logs` trước đó).

---

## KHUYẾN NGHỊ CHỐT BÀN GIAO CHO CHỦ DỰ ÁN

Hệ thống **Like Family PMS `v2.2.2`** trên nhánh `fix/v2.2.2` đã vượt qua toàn bộ 5 hạng mục kiểm toán bổ sung với **100% PASS** và đã loại bỏ triệt để 4 lỗ hổng tiềm ẩn ngay trước Go-Live. Đề xuất Chủ dự án phê duyệt theo trình tự chuẩn:
1. **Duyệt Deploy `v2.2.2`:** Deploy `firestore.rules` (có `validOccupancyDoc()`) + Hosting `v2.2.2` lên `https://likefamilypms.web.app`.
2. **Duyệt Dọn sạch `1,496` bản ghi QA `QA2M_*` & Reset 15 phòng về `clean` / `currentBookingId: null`.**
3. **Duyệt Thu hồi tài khoản `qa_runner@likefamilyhotel.com` (`UID: POtrN1IKzHVHBoULChYpINezSQ32`).**
4. Đăng nhập tài khoản Chủ KS chính thức (`likefamilyhotel`) để tự động hoàn tất migration `bookingSources` (12 nguồn, `configMigrationVersion: 1`) và bắt đầu vận hành chính thức!
