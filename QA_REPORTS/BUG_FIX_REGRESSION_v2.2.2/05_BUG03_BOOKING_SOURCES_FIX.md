# 05 — BUG-03 FIX REPORT: BOOKING SOURCES IDEMPOTENT MIGRATION (`v2.2.2`)

- **Mã lỗi:** `BUG-03` (Mức độ: **Low**)
- **Trạng thái sau bản vá:** **PASS (Idempotent 100% & Bảo toàn cấu hình tùy chỉnh)**
- **Tệp thay đổi:** `src/types/pms.ts`, `src/lib/pmsActions.ts`, `src/context/PmsContext.tsx`, `src/components/SettingsAndAdminView.tsx`, `firestore.rules`

---

## 1. Giải pháp kỹ thuật đã triển khai

1. **Hàm migration idempotent `ensureBookingSourcesConfig()` (`src/lib/pmsActions.ts`):**
   - Chạy bên trong `runTransaction()` trên tài liệu `hotel_config/main`.
   - Kiểm tra điều kiện: nếu `Array.isArray(data.bookingSources) && data.bookingSources.length > 0` → **thoát ngay (`migrated: false`)**, tuyệt đối không ghi đè bất kỳ cấu hình tùy chỉnh nào.
   - Khi thiếu `bookingSources`: giữ nguyên toàn bộ `data.otaChannels` hiện có để ánh xạ thành các mục `kind: 'ota'`, hợp nhất với 6 nguồn trực tiếp mặc định (`direct`), gán `order` tuần tự và đánh dấu `configMigrationVersion: 1`.
2. **Kích hoạt tự động an toàn (`src/context/PmsContext.tsx`):**
   - Dùng `configMigrationCheckedRef` đảm bảo chạy tối đa **1 lần mỗi phiên đăng nhập** cho vai trò `owner` hoặc `superadmin` ngay khi dữ liệu `hotel_config/main` tải xong.
3. **Nút khôi phục không phá hủy (`src/components/SettingsAndAdminView.tsx`):**
   - Bổ sung nút **"Khôi phục danh mục nguồn mặc định"** tại tab *Cài đặt & Sao lưu → Kênh OTA & Nguồn khách* (hiển thị cho `SuperAdmin`, `Owner` và nhân sự có quyền `canManageConfig`).
   - Gọi `restoreMissingDefaultBookingSources()` với hộp thoại xác nhận: chỉ bổ sung các nguồn mặc định đang thiếu (`merge-only`), tuyệt đối không xóa hay ghi đè tên/trạng thái `isActive` của các nguồn hiện có.
4. **Cập nhật Security Rules (`firestore.rules`):**
   - Bổ sung trường `'configMigrationVersion'` vào danh sách `hasOnly([...])` của vai trò `owner` trên `hotel_config/main`; giữ nguyên chặn tuyệt đối Lễ tân sửa cấu hình và chặn Chủ KS sửa thông số định danh (`hotelName`, VietQR).

## 2. Kết quả kiểm thử trên Local Emulator & Trình duyệt Playwright

| Test ID | Kịch bản kiểm thử | Kết quả đo được | Trạng thái |
| --- | --- | --- | --- |
| `BUG03-MIGRATION` | Khởi chạy trên bản sao lưu thực tế `hotel_config/main` (thiếu `bookingSources`, có 6 `otaChannels`) → chạy migration lần 1 → thêm nguồn tùy chỉnh `Đối tác Du lịch VIP` & tắt 1 nguồn → chạy migration lần 2 | Lần 1 bổ sung `12` nguồn (`configMigrationVersion=1`); Lần 2 no-op (`migrated=false`); `src_custom_vip` còn nguyên; trạng thái `isActive=false` còn nguyên; `otaChannels` giữ nguyên 100% | **PASS** |
| `UI-04` (Playwright) | Đăng nhập Chủ KS (`qa_runner`) trên giao diện `v2.2.2` → mở tab *Kênh OTA & Nguồn khách* | `PmsContext` tự động migration ra đủ `12` nguồn (`6 Nguồn trực tiếp + 6 Kênh OTA`) hiển thị rõ trên UI; nút **"Khôi phục danh mục nguồn mặc định"** hiển thị đúng quyền (`restoreSourcesBtn=true`) | **PASS** |
