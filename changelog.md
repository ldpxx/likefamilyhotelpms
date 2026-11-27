# Changelog — Like Family PMS

Tất cả các thay đổi quan trọng của dự án **Like Family PMS** đều được ghi nhận tại tệp này theo chuẩn [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) và quy ước đánh số phiên bản [Semantic Versioning](https://semver.org/).

> **QUY TẮC CẬP NHẬT BẮT BUỘC:**  
> Sau **mỗi lần** sửa lỗi, bổ sung/cải tiến tính năng, thay đổi thuật toán, cập nhật schema Firestore, quy tắc bảo mật hoặc cấu hình triển khai, **BẮT BUỘC** cập nhật đồng thời cả [`Progress.md`](./Progress.md) và thêm mục phiên bản mới vào `changelog.md` trước khi kết thúc tác vụ.

---

## [2.2.2] - 27/11/2026

Bản vá kỹ thuật, kiểm toán bảo mật/kế toán, kiểm toán UI/UX hình học DOM & triển khai Live UAT lên **https://likefamilypms.web.app** (nhánh GitHub `fix/v2.2.2`; **giữ nguyên bộ dữ liệu mẫu 2 tháng `QA2M_*` và tài khoản `qa_runner` theo quyết định của Chủ dự án để trải nghiệm thực tế trên máy tính & điện thoại**). Duy trì 100% ràng buộc 0đ Firebase Spark (không Cloud Functions, không Storage, không Google Sign-In).

### UI/UX & Print Hardening (`QA_REPORTS/UI_UX_AUDIT_v2.2.2/`)
- **Quét hình học DOM 4 độ phân giải (`1440×900`, `768×1024`, `390×844`, `360×800`) qua [`scripts/qa_ui_ux_audit.mjs`](./scripts/qa_ui_ux_audit.mjs):** Đạt **19/19 tổ hợp sạch lỗi** (`0` overflow, `0` occluded, `0` nút `< 40×40px`, `0` cặp nút `< 8px`, `0` chữ `< 12px`, `0` console error).
- **VietQR & Hóa đơn in A4/A5 ([PrintableFormModal.tsx](./src/components/PrintableFormModal.tsx), [BookingDetailModal.tsx](./src/components/BookingDetailModal.tsx), [src/index.css](./src/index.css)):** Gỡ `crossOrigin="anonymous"` gây lỗi CORS trên ảnh `img.vietqr.io`, khóa ẩn tuyệt đối VietQR khi công nợ `<= 0đ`, hiển thị rõ số tiền & nội dung chuyển khoản, cô lập `.print-sheet-root` trong `@media print` cho khổ A4/A5 không lẫn nền ứng dụng và không cắt chữ ký.
- **Responsive Mobile `360px` & Touch Accessibility ([FinanceReportsView.tsx](./src/components/FinanceReportsView.tsx), [BookingDetailModal.tsx](./src/components/BookingDetailModal.tsx), [src/index.css](./src/index.css)):** Chống tràn ngang cụm lọc ngày & vỡ thẻ KPI trên `360px`, thêm `shrink-0` chống chồng chữ tab drawer & ghim nút đóng `X`, nâng sàn vùng chạm `>= 40×40px` / khoảng cách `>= 8px` trên Mobile/Tablet và sàn cỡ chữ `>= 12px`.
- **Chống chồng lấn cuộn ngang trên Lịch Calendar ([TimelineCalendarView.tsx](./src/components/TimelineCalendarView.tsx)):** Cô lập tầng xếp chồng (`isolate`) và phân lớp `z-index` chuẩn (`z-[5]` thanh đơn + `overflow-hidden`, `z-[8]` vạch giờ hiện tại, `z-20` cột phòng/tầng ghim trái kèm bóng tách cạnh, `z-30` hàng ngày ghim trên, `z-40` góc trên-trái) cho cả chế độ Ngày (Giờ) lẫn 14/30/60 ngày — xác minh `15/15` phòng `0` chồng lấn khi cuộn.
- **Vá lỗi `"Missing or insufficient permissions"` trên thiết bị thứ 2 ([firebase.json](./firebase.json), [vite.config.ts](./vite.config.ts), [firestore.rules](./firestore.rules), [PmsContext.tsx](./src/context/PmsContext.tsx)):** Sửa header `Cache-Control` để `/sw.js`, `/registerSW.js`, `/index.html` luôn `no-cache, no-store, must-revalidate` (chỉ cache `immutable` cho `/assets/**`), bật Workbox `cleanupOutdatedCaches`/`skipWaiting`/`clientsClaim`, ưu tiên short-circuit tự đọc `staff_users/{uid}` trong Rules và đồng bộ ID token khi đăng nhập di động.
- **Vá 3 lỗi UAT cảm ứng Mobile trên Lịch Calendar & Modal ([TimelineCalendarView.tsx](./src/components/TimelineCalendarView.tsx), [BookingDetailModal.tsx](./src/components/BookingDetailModal.tsx), [BookingCreateModal.tsx](./src/components/BookingCreateModal.tsx), [src/index.css](./src/index.css)):** Gỡ bỏ hoàn toàn nút `+1đ` tự gia hạn ngày, kéo thả đổi phòng và chạm ô trống bật form đặt phòng; thêm ngưỡng chống chạm nhầm khi vuốt (`touchmove > 10px`); khóa `max-w-[100vw]` chống đẩy lệch phải Modal trên điện thoại (xác minh Playwright `390×844` hiển thị trọn `0–390px`).
- **Cải tiến Bộ lọc & Menu "Hiển thị" trên Lịch Calendar ([TimelineCalendarView.tsx](./src/components/TimelineCalendarView.tsx)):**
  - Chuyển menu **Hiển thị** sang dạng **Bottom Sheet / Modal căn giữa** trên Mobile/Tablet (`< lg`) kèm nền mờ, nút đóng `X` và nút **Xong** (không còn bị cắt lề trái), giữ dạng Popover neo góc phải `w-72` trên Desktop (`lg:`).
  - Bổ sung bộ lọc **Loại phòng (`roomTypeFilter`)** hoạt động song song với lọc **Tầng (`floorFilter`)** và ô tìm kiếm, sắp xếp cụm lọc Mobile theo lưới `grid-cols-2` (`min-h-[40px]`, `0px` tràn ngang).
  - Bổ sung chọn nhanh chế độ gom nhóm (**Theo Tầng / Theo Loại phòng / Xem tất cả 15 phòng**) kèm **hàng tổng hợp trống / đang dùng theo từng ngày** ngay trên tiêu đề mỗi nhóm Loại phòng (căn khớp 1:1 theo cột ngày) giúp lễ tân báo phòng trống theo hạng phòng tức thì (xác minh Playwright Mobile `390×844` & Desktop `1440×900` đạt 100%, `0` lỗi console).
- **Quản lý tập trung Logo khách sạn & Checkbox Hiển thị Logo trên Biểu mẫu ([src/types/pms.ts](./src/types/pms.ts), [firestore.rules](./firestore.rules), [imageCompression.ts](./src/lib/imageCompression.ts), [SettingsAndAdminView.tsx](./src/components/SettingsAndAdminView.tsx), [FormCustomizerView.tsx](./src/components/FormCustomizerView.tsx), [PrintableFormModal.tsx](./src/components/PrintableFormModal.tsx)):**
  - Bổ sung `hotelLogoBase64?: string` vào `HotelConfig` và `showLogo?: boolean` (mặc định `true`) vào `FormTemplate`; cập nhật `firestore.rules` thêm hàm `validHotelLogo()` kiểm tra kiểu `string` và giới hạn `< 150.000` ký tự (cho phép `SuperAdmin` & `Owner` lưu `hotelLogoBase64`).
  - Thêm khối **Logo khách sạn** trong **Cài đặt & Sao lưu → Thông tin khách sạn** gồm khung xem trước/giữ chỗ, nút **Tải logo lên** (tự nén Canvas tối đa `320px`, giữ nền trong suốt PNG/WebP, `< 60 KB` Base64) và nút **Gỡ logo** lưu trực tiếp vào `hotel_config/main`.
  - Gỡ nút Upload/Gỡ logo riêng lẻ trên 3 mẫu phiếu trong **Tùy chỉnh biểu mẫu**, thay bằng ô tick **Hiển thị Logo khách sạn** đặt cạnh **Hiển thị mã VietQR** (hiện chú thích *"Chưa có logo — tải lên tại Cài đặt & Sao lưu"* khi chưa tải logo), đồng bộ tức thì Live Preview và bản in `@media print` (ưu tiên `hotelConfig.hotelLogoBase64`, tương thích ngược `template.logoBase64`) trên cả Desktop `1440×900` lẫn Mobile `390×844`.
- **Quản lý Danh mục Dịch vụ & Bảng giá bán + Báo cáo Doanh thu Dịch vụ P&L đa chiều ([src/types/pms.ts](./src/types/pms.ts), [firestore.rules](./firestore.rules), [seedData.ts](./src/lib/seedData.ts), [pmsActions.ts](./src/lib/pmsActions.ts), [SettingsAndAdminView.tsx](./src/components/SettingsAndAdminView.tsx), [BookingDetailModal.tsx](./src/components/BookingDetailModal.tsx), [revenueMetrics.ts](./src/lib/revenueMetrics.ts), [FinanceReportsView.tsx](./src/components/FinanceReportsView.tsx)):**
  - Bổ sung `ServiceItemGroup` (`food` | `drink` | `service`), `ServiceCatalogItem` trong `hotel_config/main.serviceCatalog` (mặc định 12 mục mẫu khởi tạo idempotent, không quản lý tồn kho) và cập nhật `firestore.rules` cho phép `Owner`/`SuperAdmin` quản lý `serviceCatalog` (chặn Lễ tân).
  - Thêm tab **Dịch vụ & Bảng giá** trong **Cài đặt & Sao lưu** (phân nhóm Thức ăn / Đồ uống / Dịch vụ, lọc/tìm kiếm, thêm/sửa/bật-tắt `isActive`).
  - Nâng cấp mục **Dịch vụ phát sinh** trong **Chi tiết đơn** với bộ chọn nhanh từ bảng giá (chỉ hiện `isActive === true`, tự điền Tên / Phân loại / Đơn giá và vẫn cho phép chỉnh sửa) kèm tùy chọn **Nhập dịch vụ ngoài danh mục**, lưu đủ `businessDate` bất biến `YYYY-MM-DD`, `catalogItemId` và `category`.
  - Mở rộng `getRoomRevenueInRange()` thêm `serviceBreakdownByGroup` (Thức ăn, Đồ uống, Dịch vụ, Phụ thu giờ — tương thích ngược dữ liệu cũ `minibar`/`laundry`/`damage`/`other`, bảo toàn `0đ` lệch `BUG-01`) & `serviceDetailRows`; hiển thị 4 thẻ cơ cấu doanh thu dịch vụ (tổng tiền, lượt bán, tỷ trọng `%`) cùng bảng kê chi tiết có lọc đa chiều (Phân loại / Phòng / Tìm kiếm) và xuất Excel trong **Tài chính & P&L**.

### Fixed
- **`BUG-01` [High] — Cố định `businessDate` dịch vụ & tách bạch phụ thu trong P&L:**
  - Chuẩn hóa `BookingServiceItem` (`businessDate`, `occurredAt`, `category`, `status`) trong [src/types/pms.ts](./src/types/pms.ts), [src/lib/pmsActions.ts](./src/lib/pmsActions.ts) và [src/lib/postStayActions.ts](./src/lib/postStayActions.ts).
  - Cập nhật `getRoomRevenueInRange()` trong [src/lib/revenueMetrics.ts](./src/lib/revenueMetrics.ts) phân bổ từng dòng dịch vụ và phụ thu theo ngày hạch toán bất biến `YYYY-MM-DD` (múi giờ `Asia/Ho_Chi_Minh`) và bổ sung hàm đối soát chỉ đọc `auditLegacyServiceDates()` (`LEGACY_DATE_REVIEW_REQUIRED`).
  - Xác minh trên 500 đơn Staging: `serviceRev(T10) 30.320.000đ + serviceRev(T11) 28.205.000đ === 58.525.000đ === Kỳ gộp 2 tháng === Tổng 61 ngày lẻ` (**`0đ` lệch**), giữ nguyên `roomRev = 362.750.000đ / 730 đêm`.
- **`BUG-02` [Medium] — Khóa phòng nguyên tử `room_occupancy/{roomId}_{YYYY-MM-DD}` chống đặt trùng đồng thời:**
  - Xây dựng [src/lib/occupancyService.ts](./src/lib/occupancyService.ts) (Phương án A — 0đ Spark) với `runTransaction()` của Client SDK, kiểm tra giao cắt dấu thời gian kèm **đệm dọn phòng 5 phút** `[startAt, endAt + bufferMs)`, và hàm kiểm toán/dựng chỉ mục `auditAndRebuildOccupancy(dryRun)`.
  - Đồng bộ hóa nguyên tử toàn bộ **15 luồng thay đổi lịch phòng** trong [src/lib/pmsActions.ts](./src/lib/pmsActions.ts), [src/lib/cancellationActions.ts](./src/lib/cancellationActions.ts) và [src/lib/postStayActions.ts](./src/lib/postStayActions.ts) (tạo đơn lẻ, đặt đoàn all-or-nothing, đổi phòng, split-stay, sửa ngày/giờ, check-out, trả phòng sớm, hủy đơn, no-show, khôi phục đơn hủy, đảo check-in, mở lại đơn, gộp phòng, bảo trì).
  - Cập nhật [firestore.rules](./firestore.rules) bảo vệ `room_occupancy` (chặn `unauth`, kiểm tra schema bắt buộc, chỉ `superadmin` được xóa).
  - Kiểm chứng bão 12 yêu cầu đồng thời trên Local Emulator: **duy nhất `1` thành công / `11` bị từ chối nguyên tử** (`OCCUPANCY_CONFLICT`); `auditAndRebuildOccupancy` dựng đủ `78/78` docs và phát hiện chính xác 1 xung đột dữ liệu mẫu cũ (`room_502_2026-11-28: QA2M_BKG_0433 / QA2M_MNT_0014`).
- **`BUG-03` [Low] — Migration idempotent `bookingSources` & khôi phục nguồn mặc định không phá hủy:**
  - Triển khai `ensureBookingSourcesConfig()` (`configMigrationVersion: 1`, chạy trong `runTransaction` tối đa 1 lần/phiên cho `owner`/`superadmin` tại [src/context/PmsContext.tsx](./src/context/PmsContext.tsx)) và nút **"Khôi phục danh mục nguồn mặc định"** (chỉ bổ sung phần thiếu, không ghi đè nguồn tùy chỉnh hay `otaChannels`) tại [src/components/SettingsAndAdminView.tsx](./src/components/SettingsAndAdminView.tsx), bổ sung fallback `staffProfile?.role === 'owner'` cho `canManageRoomsAndSources`.
  - Cập nhật [firestore.rules](./firestore.rules) cho phép `owner` cập nhật `configMigrationVersion` trên `hotel_config/main`.

### QA & Tooling
- **Gỡ chặn kiểm thử UI (`UI-01` → `UI-04`) trên Node `v20.18.0`:** Tích hợp `playwright-core` điều khiển Chrome cục bộ kết hợp cấu hình Firebase Local Emulator Suite trong [firebase.json](./firebase.json) và opt-in `VITE_USE_FIREBASE_EMULATOR` trong [src/lib/firebase.ts](./src/lib/firebase.ts).
- **Nghiệm thu & Tài liệu:** Đạt **19/19 PASS** (`14` Local Emulator gồm Restore Drill `1,519` docs trong `3.14s` + `5` Playwright UI trên Desktop/Tablet/Mobile/Form E2E với `0` console error), xuất đủ **13 báo cáo nghiệm thu chuẩn** vào [`QA_REPORTS/BUG_FIX_REGRESSION_v2.2.2/`](./QA_REPORTS/BUG_FIX_REGRESSION_v2.2.2/).

---

## [2.2.1] - 27/11/2026

Bản vá **Bảo mật, Kế toán lõi & Đồng bộ Vận hành** toàn diện 4 đợt (`Đợt 0 → Đợt 1 P0 → Đợt 2 P1 → Đợt 3 P2`) theo tài liệu kỹ thuật [`Phuong_An_Khac_Phuc_Loi_Like_Family_PMS_v2_2_1_rev3.md`](./Phuong_An_Khac_Phuc_Loi_Like_Family_PMS_v2_2_1_rev3.md) (duy trì 0đ Firebase: không Cloud Functions, không Storage, không Google Sign-In), kèm báo cáo rà soát dữ liệu cũ [`legacy_data_audit_v2.2.1.md`](./legacy_data_audit_v2.2.1.md), deploy lên **https://likefamilypms.web.app**.

### Security (P0)
- **#8 — Chuyển xác thực Nhân viên sang Firebase Auth Email/Password & khóa triệt để `staff_users`:**
  - Chuyển toàn bộ tài khoản Chủ KS & Nhân viên sang Firebase Auth với email nội bộ `<username>@likefamilyhotel.com` (không cần hộp thư thật), dùng **Secondary Firebase App (`StaffCreator`)** trong [src/lib/firebase.ts](./src/lib/firebase.ts) để Chủ KS/Quản lý tạo tài khoản mới mà không bị văng phiên đăng nhập.
  - Bổ sung cờ `mustChangePassword: true`, màn hình bắt buộc đổi mật khẩu lần đầu đăng nhập trong [src/App.tsx](./src/App.tsx) và ô **Nhập lại mật khẩu mới** kèm cảnh báo đỏ trực tiếp ngay khi 2 lần nhập không giống nhau trên cả màn hình đổi mật khẩu lần đầu lẫn mục tự đổi mật khẩu trong [src/components/StaffAndAuditView.tsx](./src/components/StaffAndAuditView.tsx) (cùng luồng **Khóa & Cấp lại tài khoản mới** `replaceForgottenStaffAccount` và `reauthenticateWithCredential` + `updatePassword`).
  - Xóa hoàn toàn trường `passwordHash`, migrate tài khoản Chủ KS `@likefamilyhotel` sang UID Firebase Auth mới và siết chặt [firestore.rules](./firestore.rules) chặn 100% truy cập `unauthenticated` trên toàn bộ collection (`staff_users`, `bookings`, `transactions`...).
- **#3 — Sửa quyền Chủ khách sạn trên `hotel_config/main`:**
  - Sửa [firestore.rules](./firestore.rules) dùng `request.resource.data.diff(resource.data).affectedKeys().hasOnly(['accountingLockDate', 'bookingSources', 'otaChannels', 'hourlyCleaningBufferMinutes', 'updatedAt'])` cho vai trò `owner` (đã xác minh trực tiếp: cập nhật `accountingLockDate` thành công, ghi `hotelName` bị chặn `permission-denied`).

### Fixed (P0 & P1 Accounting / Operations)
- **#1 — Sửa sai lệch doanh thu P&L & KPI (Single Source of Truth):**
  - Tạo [src/lib/revenueMetrics.ts](./src/lib/revenueMetrics.ts) với hàm `getRoomRevenueInRange()` phân bổ chính xác từng đêm `dailyRates` nằm trong `[from, to]`, cộng doanh thu nghỉ giờ vào ngày `checkIn` nhưng không cộng vào `soldNights`, áp dụng đồng nhất cho [DashboardView.tsx](./src/components/DashboardView.tsx), [FinanceReportsView.tsx](./src/components/FinanceReportsView.tsx) (P&L, Công suất theo loại phòng và Báo cáo 12 tháng).
  - Khớp tuyệt đối dữ liệu nghiệm thu: ngày `27/11/2026` = **`2.260.000đ / 5 đêm / 33,3%`**, tuần `21–27/11/2026` = **`11.410.000đ / 29 đêm`**.
- **#2 — Chống trùng doanh thu khi ghép phòng (`consolidateRoomIntoTarget`):**
  - Tách khoản kết chuyển nợ từ Phòng A sang Phòng B sang trường riêng `transferredBalance` (cộng vào công nợ thu khách của Phòng B trong `getBookingGuestBalance()`, loại khỏi doanh thu P&L); Phòng A lưu `consolidatedInto` và `balanceTransferredOut` để công nợ về `0đ`.
- **#4 & #5 — Đồng bộ `depositPaid`/`guestPaid` cho Hoàn tiền & Trả phòng sớm:**
  - Tạo hàm duy nhất `applyPaymentDelta()` trong [src/lib/pmsActions.ts](./src/lib/pmsActions.ts) và áp dụng nguyên tử trong cùng `writeBatch` cho `recordTransaction()` (`deposit`, `payment`, `refund`, chặn hoàn vượt đã thu) và `executeEarlyCheckOut()` ([src/lib/postStayActions.ts](./src/lib/postStayActions.ts): `refunded`, `transferred_to_booking`, `pending_deposit_resolution`).
- **#6 — Gỡ bỏ Undo 15 giây cho Check-in & Check-out:**
  - Loại bỏ `triggerUndoBanner` và khóa `undoBookingAction()` cho `check_in`/`check_out`/`early_checkout` trên [BookingDetailModal.tsx](./src/components/BookingDetailModal.tsx) và [RoomGridView.tsx](./src/components/RoomGridView.tsx), bắt buộc dùng luồng **Đảo Check-in nhầm** (`clean`/`dirty`) và **Mở lại đơn đã Check-out**.
- **#7 — Hỗ trợ nhiều lượt nghỉ giờ trong ngày kèm đệm dọn phòng 5 phút:**
  - Chuẩn hóa đơn nghỉ giờ lưu `checkIn == checkOut`, `nights = 0`; kiểm tra trùng lịch bằng dấu thời gian `[startMs, endMs + buffer)` (`getBookingInterval` / `doBookingIntervalsOverlap`, mặc định `hourlyCleaningBufferMinutes = 5`) xử lý chuẩn cả va chạm giờ-với-giờ và giờ-với-qua-đêm trên [BookingCreateModal.tsx](./src/components/BookingCreateModal.tsx), [TimelineCalendarView.tsx](./src/components/TimelineCalendarView.tsx) và [AvailabilityFinder.tsx](./src/components/AvailabilityFinder.tsx).
- **#9 — Loại đơn hủy/no-show khỏi chân bảng Tổng công nợ:**
  - Cập nhật `<tfoot>` trong [BookingsAndGroupsView.tsx](./src/components/BookingsAndGroupsView.tsx) chỉ cộng đơn hoạt động (khớp **`3.710.000đ`**) và hiển thị tách bạch pill **Phí giữ cọc** (`200.000đ`).
- **#11a — Khóa sổ kế toán 2 lớp (App + Firestore Rules):**
  - Chặn mọi giao dịch `date <= accountingLockDate` tại `assertPeriodOpen()` trong [pmsActions.ts](./src/lib/pmsActions.ts)/[postStayActions.ts](./src/lib/postStayActions.ts) và `isPeriodOpenForDate()` trong [firestore.rules](./firestore.rules).

### Improved (P2)
- **#10 — Loại phòng ngừng sử dụng:** Tra cứu tên & giá từ toàn bộ `roomTypes` (gắn nhãn `(Ngừng SD)` nếu đã tắt), bổ sung cảnh báo xác nhận trong [SettingsAndAdminView.tsx](./src/components/SettingsAndAdminView.tsx) khi tắt loại phòng còn phòng con đang hoạt động, và khôi phục `rt_family` (`isActive: true`) cho P.204, P.304, P.404.
- **#11b — Đối soát lô OTA cấn trừ tự động `ota_adjustments`:** [OtaReconciliationView.tsx](./src/components/OtaReconciliationView.tsx) tự động gợi ý các bút toán điều chỉnh `pending_next_payout` cùng kênh và gạch trừ nguyên tử trong cùng `writeBatch` của `createOtaPayoutBatch()`.
- **#12a & #12b — Bảo trì phòng dùng chung & Nguồn đặt đoàn:** Bổ sung ngày `maintenanceFrom` / `maintenanceTo` trong [RoomMaintenanceModal.tsx](./src/components/RoomMaintenanceModal.tsx) và dùng chung `isRoomBlockedByMaintenance()` trên cả 3 màn hình; bổ sung chọn **Nguồn đặt phòng** và đồng bộ màu `#0F5132` trong [GroupBookingModal.tsx](./src/components/GroupBookingModal.tsx).

---

## [2.2.0] - 27/11/2026

Phiên bản nâng cấp toàn diện **UI/UX 3 đợt** theo báo cáo tham chiếu [`gohost_ui_reference.md`](./gohost_ui_reference.md) kết hợp bản sắc thương hiệu ấm áp **Like Family Hotel** (**Xanh Rừng Sâu `#0F5132` – `#1B5E20`**, **Vàng Cát `#FAF9F6`**, **Vàng Hổ Phách `#D97706`**), bảo toàn 100% 28 quy tắc nghiệp vụ & kế toán bất biến, deploy lên **https://likefamilypms.web.app**.

### Added
- **Trang Tổng Quan Vận Hành (`src/components/DashboardView.tsx`):**
  - 4 thẻ KPI chính (`Doanh thu thực tế`, `Tỷ lệ lấp đầy`, `ADR`, `RevPAR`) kèm `%` so sánh kỳ trước và 5 chỉ số vận hành phụ theo chu kỳ chọn nhanh (`Hôm nay`, `Hôm qua`, `7 ngày`, `30 ngày`, `Tháng này`).
  - Biểu đồ Doanh thu phòng 14 ngày + Thanh tỷ trọng Theo kênh đặt phòng + **Dải dự báo công suất 30 ngày tới** (30 ô nhiệt độ Forest Emerald).
  - Bảng tác vụ hôm nay với 5 tab đếm (`Sắp nhận phòng`, `Sắp trả phòng`, `Đang lưu trú`, `Cọc treo`, `Cảnh báo ASM`) và dòng `Tổng còn phải thu`.
- **Sơ đồ phòng Pro (`src/components/RoomGridView.tsx`):**
  - Dải 7 ô đếm vận hành + tổng `Còn phải thu hôm nay` + thanh tìm kiếm tức thì hỗ trợ phím tắt `/`.
  - 4 chế độ gom nhóm (`Trạng thái` | `Loại phòng` | `Tầng` | `Tất cả`), thẻ phòng dùng **vạch màu 3px ở cạnh trên**, icon chổi cho phòng bẩn, hiển thị trực tiếp **`Hạn lưu trú dd/mm/YYYY`** lấy từ OCR/hồ sơ khách nước ngoài và nút thao tác **1-click `Nhận phòng` / `Đánh dấu sạch`**.
- **Lịch Timeline Pro (`src/components/TimelineCalendarView.tsx`):**
  - Bổ sung chế độ xem **`Ngày (Giờ)`** theo trục 24 giờ (`00:00 – 22:00`) kèm vạch giờ hiện tại trực quan cho đơn Nghỉ giờ 3 bậc & giao ca trong ngày.
  - Bổ sung **Hover Popover xem nhanh** khi rê chuột vào thanh đơn, **Popover `Hiển thị`** (Mật độ Đầy đủ/Thu gọn, Nhóm theo Tầng/Loại phòng/Chỉ phòng, Tô màu theo Trạng thái/Nguồn đặt phòng), thanh tìm kiếm phím tắt `/`, và micro-badge `✓✓` / `[G]` / chổi phòng bẩn.
- **Right Slide-Over Drawers & Thanh toán nhanh (`BookingCreateModal.tsx`, `BookingDetailModal.tsx`):**
  - Chuyển Tạo đơn & Chi tiết đơn sang ngăn kéo trượt phải giữ ngữ cảnh lịch bên trái; bổ sung ô gõ trực tiếp **`Số đêm`** tự cập nhật ngày trả phòng.
  - Chi tiết đơn bổ sung Avatar chữ cái đầu, **Copy 1-click** Mã ĐP & SĐT, nút **`Nhập nhanh [50%] [100%]`** + bật nhanh VietQR ngay trong form thu tiền, và **Sticky Footer 4 nút (`Sửa giá / DV` | `Nhận/Trả phòng` | `Thanh toán` | `... Khác`)** gom gọn toàn bộ thao tác kế toán & in biểu mẫu.
- **Báo cáo 12 tháng, Công suất theo Loại phòng & Nhật ký theo Nhân viên:**
  - [FinanceReportsView.tsx](./src/components/FinanceReportsView.tsx): Thêm Preset chọn kỳ nhanh, sub-tab **`Báo cáo 12 tháng`** xuất Excel 1-click, và bảng **Công suất theo Loại phòng & Nghỉ giờ** (đều lọc qua `isBookingEligibleForPnLRevenue()`).
  - [StaffAndAuditView.tsx](./src/components/StaffAndAuditView.tsx): Bổ sung 4 thẻ thống kê chống gian lận (`Tổng thao tác`, `Đụng giá / Điều chỉnh`, `Hủy / Void`, `Hoàn tác / Đổi PTTT`) và tab **`Theo nhân viên`** bấm vào để lọc thẳng dòng thời gian kiểm toán kèm `Before/After Snapshot`.
  - [BookingsAndGroupsView.tsx](./src/components/BookingsAndGroupsView.tsx): Bổ sung chân bảng tổng cộng (`Tổng tiền`, `Đã thu`, `Còn lại`) cho danh sách đơn đang lọc.

### Changed
- Đồng bộ toàn bộ design tokens ([src/index.css](./src/index.css), [src/App.tsx](./src/App.tsx)) sang bộ màu thương hiệu **Like Family Hotel** (`#0F5132` Forest Emerald, `#FAF9F6` Warm Cream, `#D97706` Amber, `#E7E3DA` Warm Sand Hairline).

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
