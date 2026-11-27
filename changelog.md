# Changelog — Like Family PMS

Tất cả các thay đổi quan trọng của dự án **Like Family PMS** đều được ghi nhận tại tệp này theo chuẩn [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) và quy ước đánh số phiên bản [Semantic Versioning](https://semver.org/).

> **QUY TẮC CẬP NHẬT BẮT BUỘC:**  
> Sau **mỗi lần** sửa lỗi, bổ sung/cải tiến tính năng, thay đổi thuật toán, cập nhật schema Firestore, quy tắc bảo mật hoặc cấu hình triển khai, **BẮT BUỘC** cập nhật đồng thời cả [`Progress.md`](./Progress.md) và thêm mục phiên bản mới vào `changelog.md` trước khi kết thúc tác vụ.

---

## [2.1.1] - 27/11/2026 (Bản vá P&L Split-Stay / v2.0.1-hotfix)

Bản vá logic tính doanh thu **Tài chính & P&L** cùng tùy chọn hủy đồng bộ **Chuỗi chuyển phòng (Split-Stay Chain)**, deploy lên **https://likefamilypms.web.app**.

### Fixed
- **Sửa triệt để lỗi Báo cáo Lãi/Lỗ (P&L) & KPI cộng nhầm doanh thu của chặng `Đã chuyển phòng` (`transferred`) khi chuỗi đơn đã hủy & hoàn tiền 100%:**
  - Bổ sung hàm lọc trung tâm `isBookingEligibleForPnLRevenue()` trong [src/lib/utils.ts](./src/lib/utils.ts) và áp dụng cho [src/components/FinanceReportsView.tsx](./src/components/FinanceReportsView.tsx).
  - Chỉ tính doanh thu phòng, lợi nhuận ròng, số đêm đã bán, Công suất phòng (`Occupancy`), `ADR` và `RevPAR` cho các đơn/chặng lưu trú thực tế hợp lệ (`in_house`, `checked_out` bao gồm trả phòng sớm, và chặng `transferred` hợp lệ).
  - Tuyệt đối loại trừ `reserved`, `cancelled`, `no_show`, `void_entry_error` và tự động loại các chặng `transferred` trước đó nếu toàn bộ chuỗi `bookingChainId` đã bị void hoặc bị hủy hoàn tiền 100% (dòng tiền giữ lại ròng của cả chuỗi `≤ 0đ`) — xử lý đúng ngay cả với các đơn đã phát sinh trước bản vá (như chuỗi `LF-261127-WLMI`).

### Added
- **Tùy chọn phạm vi hủy Chuỗi chuyển phòng (`Split-Stay Chain`):**
  - Bổ sung bộ chọn trực quan **Hủy riêng chặng hiện tại** vs. **Hủy toàn bộ chuỗi đơn (bao gồm cả chặng Đã chuyển phòng trước đó)** trên cả [CancelBookingModal.tsx](./src/components/CancelBookingModal.tsx) (khi hủy đơn đang ở/đặt trước) và [PostStayAccountingModal.tsx](./src/components/PostStayAccountingModal.tsx) (khi hủy ghi nhận đơn đã trả phòng `void_checked_out`).
  - Cập nhật [cancellationActions.ts](./src/lib/cancellationActions.ts) (`cancel_split_stay_chain`) và [postStayActions.ts](./src/lib/postStayActions.ts) (`void_checked_out_chain` với `additionalChainBookings`) để cập nhật nguyên tử trạng thái toàn chuỗi, gom đúng tổng tiền đã thu toàn chuỗi khi hoàn/đảo bút toán mà không trùng lặp giao dịch.

---

## [2.1.0] - 27/11/2026

Hoàn thiện trọn bộ **Phần C — 9 Quy tắc Hủy, Đảo trạng thái & Điều chỉnh Kế toán Sau Check-in / Check-out**, kết hợp hoàn chỉnh cùng Phần A (11 yêu cầu vận hành) và Phần B (8 quy tắc hủy đơn trước lưu trú), cập nhật `firestore.rules` và deploy lên **https://likefamilypms.web.app**.

### Added
- **Engine Kế toán Sau Check-in / Check-out (`src/lib/postStayActions.ts`) & 2 Modal nghiệp vụ (`PostStayAccountingModal.tsx`, `ReclassifyPaymentModal.tsx`):**
  1. **Đảo Check-in (`reverse_checkin`):** Chuyển đơn `in_house` về `reserved`, giữ nguyên lịch sử check-in gốc trong `audit_logs`, bắt buộc xác nhận tình trạng phòng thực tế (`clean` nếu chưa sử dụng / `dirty` nếu đã vào phòng).
  2. **Trả phòng sớm minh bạch (`early_checkout`):** Cắt giảm số đêm còn lại về ngày trả thực tế và yêu cầu chọn rõ 1 trong 3 hướng xử lý khoản tiền đã trả dư: Hoàn tiền mặt/chuyển khoản độc lập, Treo chờ xử lý (`pending_deposit_resolution`, không tính doanh thu), hoặc Chuyển sang đơn khác.
  3. **Chuyển đổi Phương thức thanh toán 2 chân (`reclassify_payment` — `ReclassifyPaymentModal.tsx`):** Cho phép Quản lý/Chủ KS/SuperAdmin lập bút toán `reclassification_out` + `reclassification_in` trên cả Chi tiết đơn lẫn Sổ Quỹ Thu–Chi để cân lại Quỹ tiền mặt bàn giao ca và Ngân hàng mà không sửa giao dịch gốc hay tạo dòng tiền thu/chi giả.
  4. **Hủy ghi nhận đơn đã Check-out (`void_checked_out`):** Chặn tự động hoàn tiền; bắt buộc cấp Quản lý trở lên chọn rõ phương án kế toán (`none`, `void_receipt_entry`, `actual_refund`, hoặc `ota_adjustment_only`) kèm lý do bắt buộc.
  5. **Mở lại đơn đã Check-out tách 2 chế độ (`reopen_checked_out`):** `billing_only` (mở sửa hóa đơn không chiếm phòng trên sơ đồ/timeline) và `reopen_stay` (mở lại lưu trú có kiểm tra chặn trùng lịch phòng).
  6. **Điều chỉnh sau Check-out (`post_checkout_adjustments`):** Collection bất biến ghi nhận đầy đủ `oldTotal`, `newTotal`, `diffAmount`, nội dung phát sinh/giảm trừ và phiếu thu/chi bổ sung liên kết.
  7. **Điều chỉnh Công nợ OTA sau đối soát (`ota_adjustments` trong `OtaReconciliationView.tsx`):** Lập bút toán âm/dương chuyển sang khấu trừ/cộng bù ở kỳ thanh toán OTA tiếp theo thay vì xóa/sửa lô đã đối soát, kèm nút đánh dấu `Đã đối trừ kỳ sau`.
  8. **Khóa sổ kế toán theo kỳ (`Accounting Period Lock` trong `SettingsAndAdminView.tsx`):** Thiết lập `hotel_config.accountingLockDate` (chuẩn `dd/mm/YYYY`); tự động chặn ghi lùi ngày trên Sổ Quỹ và chuyển hướng mọi bút toán điều chỉnh của kỳ đã khóa sang kỳ đang mở (`resolveAccountingPostingDate`) kèm tham chiếu ngày gốc.
  9. **Nhật ký kiểm toán nâng cấp (`StaffAndAuditView.tsx` & `writeAuditLog`):** Lưu và hiển thị `relatedTransactionIds[]`, `userId`, `userName`, cùng trình xem gọn `Before / After Snapshot` cho mọi thao tác nhạy cảm.

### Changed
- **Báo cáo P&L & Sổ Quỹ (`FinanceReportsView.tsx`):** Loại trừ `reclassification_in`/`reclassification_out`/`void_receipt_entry` khỏi chỉ tiêu tổng thực thu & biểu đồ ngày để tránh dòng tiền giả, trong khi vẫn cộng/trừ chuẩn xác các chân `method === 'cash'` vào **Bàn giao tiền mặt cuối ca**. Hiển thị thanh thông báo trạng thái Khóa sổ kế toán khi đang kích hoạt.
- **Chi tiết đơn (`BookingDetailModal.tsx`):** Hiển thị nhãn trạng thái `Mở lại sửa hóa đơn (không chiếm phòng)`, `Đã hủy ghi nhận sau Check-out`, lịch sử điều chỉnh `post_checkout_adjustments`, nút `Đổi PTTT` trên từng giao dịch và các nút thao tác kế toán theo đúng trạng thái đơn & phân quyền.

### Security
- Cập nhật [firestore.rules](./firestore.rules):
  - Khóa bất biến 100% collection `post_checkout_adjustments/{adjId}` (`allow update, delete: if false;`).
  - Chặn vĩnh viễn xóa cứng trên `ota_adjustments/{adjId}` (`allow delete: if false;`).
  - Cho phép cập nhật riêng trường `accountingLockDate` trên `hotel_config/main` cho Chủ khách sạn và SuperAdmin (có ghi `audit_logs`).

---

## [2.0.1] - 27/11/2026

Bản vá lỗi xác thực SuperAdmin và tách trang đăng nhập riêng `/superadmin`, deploy lên **https://likefamilypms.web.app**.

### Added
- **Trang đăng nhập riêng cho SuperAdmin gốc (`/superadmin` — `src/components/SuperAdminLoginPage.tsx`):**
  - Giao diện đăng nhập độc lập bằng Email/Password Firebase Authentication với nút ẩn/hiện mật khẩu và thông báo lỗi tiếng Việt chi tiết theo từng mã lỗi Firebase Auth (`auth/invalid-credential`, `auth/operation-not-allowed`, `auth/too-many-requests`...).
  - Trang đăng nhập chính `/` (`LoginScreen.tsx`) được tinh gọn chỉ dành cho Chủ khách sạn & Nhân viên lễ tân (Username/Password), kèm đường dẫn chuyển sang `/superadmin` ở chân trang.

### Fixed
- **Khắc phục triệt để lỗi không đăng nhập được tài khoản SuperAdmin đã tạo trên Firebase Authentication:**
  - *Nguyên nhân gốc:* Tài khoản `ducphuong84@gmail.com` trước đó đã bootstrap `system_meta/bootstrap` bằng UID cũ (`hlUiiFIAwyOK8W8Wom3vVSq2vBM2`), sau khi tạo lại tài khoản Email/Password trên Firebase Console mang UID mới (`sbcMEptbUVMpBy5V8Aabm4KxArw2`) nên bị chặn bởi điều kiện chỉ so sánh `rootUid !== user.uid`.
  - *Giải pháp:* Bổ sung đối chiếu khớp `superAdminEmail`/`ownerEmail` trong `PmsContext.tsx` và `firestore.rules`; khi đúng email SuperAdmin gốc nhưng UID đổi do tạo lại tài khoản Auth, hệ thống tự động cập nhật re-bind `superAdminUid` mới và di chuyển hồ sơ `staff_users` sang UID mới mà vẫn chặn tuyệt đối mọi email khác.

### Security
- Cập nhật [firestore.rules](./firestore.rules): `isSuperAdmin()` kiểm tra `superAdminUid`/`ownerUid` hoặc khớp chính xác `superAdminEmail`/`ownerEmail`, đồng thời chỉ cho phép `update` trên `system_meta/bootstrap` khi đúng email SuperAdmin gốc để tự động re-bind UID an toàn.

---

## [2.0.0] - 27/11/2026

Phiên bản nâng cấp lớn (**v2.0.0**) hoàn thiện đồng bộ **11 yêu cầu vận hành & phân quyền (Phần A)** cùng **Quy trình Hủy đơn đặt phòng 8 quy tắc chuẩn kế toán & chống gian lận (Phần B)**, khóa bất biến 100% sổ giao dịch tài chính trên Cloud Firestore và deploy lên **https://likefamilypms.web.app**.

### Added
- **Quy trình Hủy đơn đặt phòng 8 quy tắc chuẩn kế toán (`src/lib/cancellationActions.ts`, `CancelBookingModal.tsx`, `DepositResolutionModal.tsx`, `UndoCancelModal.tsx`):**
  - **Hủy một phần đơn Khách đoàn (Partial Cancellation):** Tích chọn hủy riêng từng phòng lẻ trong đoàn; chỉ giải phóng trống phòng bị hủy, giữ nguyên lịch các phòng còn lại, tự động tính lại tổng tiền đoàn và cho phép chuyển/xử lý riêng tiền cọc của phòng hủy.
  - **Phân biệt rõ `Khách báo hủy` (`customer_cancelled`) và `Khách không đến (No-show)` (`no_show`):** 2 trạng thái & bộ lọc riêng biệt; hoàn toàn xác nhận thủ công, không tự động chuyển sang No-show khi quá giờ Check-in.
  - **Khóa tùy chọn `Hủy do Nhập sai (Void)` khi đã phát sinh tiền:** Vô hiệu hóa ở cả UI lẫn tầng nghiệp vụ nếu `depositPaid + guestPaid > 0`.
  - **Trạng thái `Chờ xử lý tiền cọc` (`pending_deposit_resolution`):** Giải phóng phòng ngay lập tức, treo tiền cọc chờ quyết định chủ khách sạn, hiện thanh cảnh báo nhắc xử lý toàn ứng dụng và **tuyệt đối không cộng vào doanh thu P&L**.
  - **Độc lập Phương thức hoàn tiền (Tiền mặt vs. Chuyển khoản) + Đủ 3 phương án chốt cọc:** Cho phép hoàn tiền bằng phương thức độc lập với cách thu cọc ban đầu (lập Phiếu Chi hoàn cọc trừ đúng Quỹ tiền mặt hoặc Ngân hàng), giữ cọc tính vào Doanh thu phí hủy (`forfeited_fee`), hoặc chuyển cọc sang đơn đặt phòng khác (`transferred_to_booking`).
  - **Khôi phục đơn hủy chặt chẽ (`Undo Cancel`):** Kiểm tra chống trùng lịch phòng cũ trước khi khôi phục (nếu trùng chặn khôi phục vào phòng cũ và yêu cầu chọn phòng trống khác); nếu tiền cọc trước đó đã hoàn trả hoặc chuyển sang đơn khác thì tự động đặt số tiền đã thu về `0đ`.
  - **Quy trình hủy riêng cho Đơn OTA (3 trạng thái):** `ota_cancel_requested` → `ota_cancel_confirmed` → `ota_cancel_reconciled` tại mục Đối soát OTA; không tự động xóa công nợ OTA mà giữ chờ điều chỉnh về `0đ` (hủy miễn phí) hoặc giữ đúng phí phạt thực nhận.
- **Đầy đủ 11 hạng mục Phần A (tích hợp ổn định từ v1.1.0):** SuperAdmin gốc (Firebase Auth) + Nhân viên Firestore `staff_users` (Username/Password SHA-256), chuẩn ngày `dd/mm/YYYY` (`DateInputVN`), đặt phòng & tính tiền theo giờ 3 bậc lũy tiến, bỏ nút Xóa (dùng Ngừng sử dụng) cho Phòng/Loại phòng/OTA, gói giá mặc định, tự hiển thị tổng số ngày ở, đơn giản hóa giá OTA + phương thức `Công nợ OTA`, và huy hiệu `Khách hàng thân quen` (≥ 2 lượt).

### Changed
- **Chuyển hoàn tác giao dịch tài chính sang Bút toán đối ứng (`type: 'reversal'`):** Thay vì cập nhật trạng thái trực tiếp trên document giao dịch gốc, hệ thống lập một giao dịch đối ứng ngược chiều giữ nguyên 100% vết kế toán gốc.
- **Tách bạch P&L Báo cáo Tài chính (`FinanceReportsView.tsx`):** Loại bỏ doanh thu phòng của đơn `cancelled`/`no_show`, không tính `pending_deposit_resolution` vào doanh thu, và chỉ cộng khoản phí hủy đã chốt (`forfeited_fee`).

### Removed
- Gỡ bỏ hoàn toàn nút hủy đơn nhanh dạng `window.prompt` cũ, thay bằng luồng `CancelBookingModal` chuẩn 8 quy tắc kế toán.
- Gỡ bỏ hoàn toàn khả năng sửa/xóa trực tiếp giao dịch tài chính đã ghi nhận trong `transactions`.

### Security
- Nâng cấp [firestore.rules](./firestore.rules) khóa cứng `allow update, delete: if false;` trên cả `transactions` (sổ giao dịch tài chính bất biến 100%) và `audit_logs` (nhật ký chống gian lận bất biến).
- Bắt buộc nhập lý do và ghi đầy đủ `audit_logs` cho 100% thao tác: Hủy toàn bộ, Hủy một phần, Treo cọc, Hoàn cọc tiền mặt/chuyển khoản, Giữ cọc phí hủy, Chuyển cọc, Điều chỉnh hủy OTA và Khôi phục đơn (`undo_cancel`).

---

## [1.1.0] - 2026-11-27

Đợt nâng cấp & tinh chỉnh nghiệp vụ toàn diện (11 hạng mục) theo vận hành thực tế tại quầy lễ tân, đồng bộ lên Firebase Hosting (**https://likefamilypms.web.app**) và `firestore.rules`.

### Added
- **Phân cấp Tài khoản SuperAdmin gốc (Firebase Auth) & Nhân viên Firestore (`staff_users`):**
  - Bổ sung cơ chế đăng nhập **Tên đăng nhập (`username`) + Mật khẩu băm SHA-256 (`src/lib/crypto.ts`)** lưu trực tiếp trong Cloud Firestore cho Chủ khách sạn, Quản lý, Lễ tân và Buồng phòng.
  - Bổ sung giao diện CRUD nhân viên đầy đủ cho Quản lý / SuperAdmin (Thêm mới, Sửa, Đặt lại mật khẩu, Khóa/Mở khóa, Xóa tài khoản nhân viên) và chế độ tự phục vụ cách ly cho nhân viên thường (chỉ xem & chỉnh sửa hồ sơ/đổi mật khẩu của chính mình).
- **Đặt phòng & Tính tiền Theo Giờ — 3 bậc lũy tiến (`HourlyPricingConfig`):**
  - Bổ sung cấu hình giá giờ 3 bậc trong từng loại phòng: `firstHourPrice` (giờ đầu), `secondHourPrice` (giờ thứ 2), `additionalHourPrice` (đơn giá cố định cho mỗi giờ từ giờ thứ 3 trở đi).
  - Bổ sung chế độ **"Đặt phòng theo giờ"** ngay trên form đặt phòng & chi tiết đơn với tính tiền tự động theo công thức 3 bậc và cho phép sửa tay tổng tiền thỏa thuận.
- **Chuẩn hóa Date Picker & Hiển thị ngày Việt Nam `dd/mm/YYYY` (`src/components/DateInputVN.tsx`):**
  - Tạo component `DateInputVN` hiển thị nhất quán `dd/mm/YYYY` trên 100% trình duyệt/hệ điều hành (thay thế hoàn toàn hiển thị `mm/dd/yyyy` mặc định).
- **Hiển thị nổi bật Tổng số ngày / số đêm ở:** Tự động tính và hiển thị trực quan (VD: `3 đêm / 3 ngày` hoặc `3 giờ`) ngay khi chọn ngày Check-in / Check-out trên biểu mẫu đặt phòng, đặt đoàn và tìm phòng trống.
- **Phương thức thanh toán "Công nợ OTA" (`ota_debt`):** Bổ sung vào mọi danh sách phương thức thanh toán, thống kê tách biệt Công nợ OTA chưa về trên Báo cáo Tài chính & Đối soát OTA mà không làm lệch quỹ tiền mặt tại quầy / Sổ bàn giao ca.
- **Huy hiệu tự động "Khách hàng thân quen":** Tra cứu khách cũ theo thời gian thực khi gõ Tên / SĐT / CCCD-Passport, bấm chọn điền tự động toàn bộ hồ sơ, tự đếm số lượt lưu trú hoàn tất và gắn huy hiệu **"Khách hàng thân quen"** từ lần quay lại thứ 2 trở lên trên Kho khách, Sơ đồ phòng, Danh sách đơn và Chi tiết đơn.
- **Quản lý Gói giá mặc định (`isDefault`) & Trạng thái "Ngừng sử dụng / Không sử dụng":**
  - Cho phép Thêm, Sửa, Xóa tự do các gói giá trong từng loại phòng và chọn 1 mức giá làm **Giá mặc định**.
  - Bổ sung công tắc chuyển trạng thái **Ngừng sử dụng / Không sử dụng** (`isActive: false`) cho Loại phòng, Phòng, và Kênh OTA / Nguồn đặt phòng để ẩn khỏi danh sách tạo đơn mới mà vẫn bảo toàn dữ liệu lịch sử.

### Changed
- **Đơn giản hóa giá cho Đơn OTA:** Lễ tân nhập trực tiếp số tiền thực tế khách sạn thu về vào bảng giá thông thường; làm gọn Sổ Đối soát OTA và Báo cáo P&L theo số tiền thực thu.
- **Đồng bộ định dạng `dd/mm/YYYY` & `HH:mm dd/mm/YYYY`:** Áp dụng thống nhất trên Sơ đồ phòng, Lịch Timeline, Bảng đơn, Biểu mẫu in/VietQR, Sổ quỹ, Nhật ký `audit_logs`, và toàn bộ tệp Excel/JSON sao lưu & khai báo ASM.

### Removed
- **Gỡ bỏ hoàn toàn Đăng nhập bằng Google Account (`GoogleAuthProvider`):** Loại bỏ nút và luồng đăng nhập Google trên `LoginScreen.tsx` và `firebase.ts`; chỉ sử dụng Username/Password cho nhân viên và Email/Password Firebase Auth cho duy nhất 1 tài khoản SuperAdmin gốc.
- **Gỡ bỏ hoàn toàn nút Xóa** trên danh mục **Loại phòng**, **Phòng**, và **Kênh OTA / Nguồn đặt phòng** nhằm bảo toàn 100% lịch sử đơn đặt phòng và báo cáo cũ.
- **Gỡ bỏ tính toán `% hoa hồng OTA`, `Giá bán Gross`, `Tiền hoa hồng`, `Net`** trên form đặt phòng OTA và biểu mẫu in.
- **Loại bỏ gói/phân hệ "Khách thuê tháng" riêng biệt:** Hợp nhất toàn bộ khách ở dài ngày (15, 30, 60+ ngày) vào quy trình đặt phòng theo ngày chung.

### Security
- Cập nhật và deploy [firestore.rules](./firestore.rules) tương thích mô hình 1 SuperAdmin gốc (`system_meta/bootstrap`) + `staff_users` Firestore:
  - Khóa cứng quyền ghi `system_config` (Gemini API Keys), cấu hình tổng `hotel_config` và thao tác dọn/xóa ảnh Base64 `guest_documents` cho duy nhất SuperAdmin gốc.
  - Chặn vĩnh viễn xóa cứng (`allow delete: if false;`) trên `room_types`, `rooms`, `form_templates`, `transactions` và chặn sửa/xóa trên `audit_logs`.
  - Cách ly lắng nghe `staff_users` trong `PmsContext.tsx`: nhân viên thường không thể đọc danh sách tài khoản của nhân viên khác.

---

## [1.0.0] - 2026-11-27

Bản phát hành hoàn chỉnh đầu tiên (**Giai đoạn 1 — Web App & PWA**) đã được biên dịch sạch lỗi và deploy chính thức lên Firebase Hosting tại **https://likefamilypms.web.app** (project `likefamilypms`).

### Added
- **Nền tảng Web App & Hạ tầng Firebase:** React 18 + TypeScript + Vite 6 + Tailwind CSS v4 + `vite-plugin-pwa`, Firebase Auth, Cloud Firestore `persistentLocalCache` đa tab.
- **Quản lý Phòng, Tầng & Đa gói giá:** Cấu hình Tầng, Loại phòng, đa gói giá (`priceTiers`), khởi tạo nhanh 16 phòng mẫu Like Family Hotel, Sơ đồ phòng trực quan (`RoomGridView.tsx`).
- **Lịch Đặt Phòng Timeline Calendar Liên Tục (`TimelineCalendarView.tsx`):** Cuộn ngang vô tận qua các tháng, zoom `14/30/60` ngày, hàng tổng hợp phòng trống & `%` lấp đầy, kéo chọn ô trống đặt phòng, kéo thả đổi phòng, gia hạn `+1đ`.
- **Tìm Kiếm Phòng Trống Thông Minh (`AvailabilityFinder.tsx`):** Tra cứu nhiều loại phòng + số lượng, đánh giá Đủ/Thiếu, tích chọn tạo đơn lẻ/đoàn 1 chạm.
- **Nghiệp vụ Lễ tân Chuyên sâu:** Bộ chỉnh giá 4 công cụ đồng bộ (`PricingEditor.tsx`), Đặt phòng Lẻ/Đoàn lệch ngày/Check-in hàng loạt, Split-Stay Chain, Ghép phòng (gộp hóa đơn & dồn khách), Trả phòng sớm, Dịch vụ & Phụ thu giờ.
- **Đa Khách Lưu Trú, AI OCR 3 Ảnh & Khai Báo ASM:** Lưu không giới hạn khách/phòng, 2 ảnh CCCD / 3 ảnh khách nước ngoài (Hộ chiếu, Visa, Dấu nhập cảnh ưu tiên lấy hạn), Gemini Vision 4-Layer Model Resolver + xoay vòng key + Zero Mock, cảnh báo quá hạn lưu trú & xuất Excel ASM.
- **Biểu Mẫu Giao Dịch, VietQR & Form Customizer (Web App):** 3 mẫu phiếu song ngữ Việt–Anh kèm VietQR động, xuất PNG/PDF, trình tùy chỉnh trường trên Web desktop.
- **Universal Undo, Tài Chính P&L, Bảo Trì, Nhân Viên & Sao Lưu:** Hoàn tác 15 giây + lý do ghi `audit_logs`, Báo cáo P&L đa chiều (Occupancy, ADR, RevPAR), Sổ Thu-Chi, Bàn giao ca, Nhật ký bảo trì phòng, Dọn ảnh Base64 cũ & 1-Click Full Backup Excel/JSON.

### Changed
- **Hạ tầng lưu trữ 0đ (không dùng Firebase Cloud Storage):** Chuyển toàn bộ lưu trữ ảnh giấy tờ sang nén HTML5 Canvas (`<= 800px`, JPEG `0.65`, ~40–80KB/ảnh) lưu Base64 tách riêng trong collection `guest_documents`.
- **Chuẩn hóa mốc ngày lưu trú:** Sử dụng chuỗi ISO `YYYY-MM-DD` cho `checkIn`, `checkOut`, `dailyRates`.
- **Gemini Model Resolver 4 lớp:** Tự động dò model khả dụng qua `/v1beta/models` chống lỗi 404.

### Security
- Deploy `firestore.rules` thay thế quy tắc khóa mặc định, áp dụng bảo vệ `transactions` không xóa cứng và `audit_logs` bất biến.

### Fixed
- Sửa lỗi TypeScript `TS2322` kiểu `LucideIcon` trong `src/App.tsx`, `TS2345` `UpdateData<DocumentData>` trong `src/lib/pmsActions.ts`, và bổ sung `src/vite-env.d.ts`.
