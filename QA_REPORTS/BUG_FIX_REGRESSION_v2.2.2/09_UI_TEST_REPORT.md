# 09 — AUTOMATED UI & RESPONSIVE TEST REPORT (`UI-01` → `UI-04`)

- **Công cụ gỡ chặn nút thắt Node `v20.18.0`:** `playwright-core` (devDependency cục bộ) + Google Chrome (`C:\Program Files\Google\Chrome\Application\chrome.exe`), giữ nguyên Node toàn cục của máy.
- **Môi trường chạy:** Ứng dụng `v2.2.2` chạy trên Vite (`http://127.0.0.1:4173`) kết nối **Firebase Local Emulator Suite** đã khôi phục đủ `1,519` tài liệu của tập dữ liệu 2 tháng `QA2M_*` — **0 thao tác ghi lên Production `likefamilypms`**.
- **Kết quả:** **`5 / 5 PASS` (`0 FAIL`, `0 pageErrors`, `0 consoleErrors`)**.

---

## 1. Bảng kết quả chi tiết từng kịch bản UI

| Test ID | Viewport / Phạm vi | Tiêu chí kiểm chứng | Kết quả thực tế | Bằng chứng ảnh chụp |
| --- | --- | --- | --- | --- |
| `UI-01` | Desktop `1440×900` | Render đầy đủ 5 màn hình lõi trên tập `500` đơn (`Sơ đồ phòng`, `Tổng quan`, `Lịch Calendar`, `Đơn, Đoàn & ASM`, `Tài chính & P&L 12 tháng`); không tràn ngang; footer bảng đơn tổng hợp đúng | `overflow=false`; footer: `Tổng đơn hoạt động (474 đơn · loại trừ 26 đơn hủy/no-show)`; bảng 12 tháng hiển thị đủ `10/2026` (`227.170.000đ`) & `11/2026` (`195.605.000đ`), tổng `422.775.000đ` / `730` đêm | `screenshots/ui01_desktop_rooms.png`, `ui01_desktop_dashboard.png`, `ui01_desktop_timeline.png`, `ui01_desktop_bookings.png`, `ui01_desktop_finance_12m.png` |
| `UI-02` | Tablet `768×1024` | Khung Sơ đồ phòng & thanh điều hướng thích ứng tốt, không tràn ngang | `horizontalOverflow=false` | `screenshots/ui02_tablet_rooms.png` |
| `UI-03` | Mobile `390×844` | Menu rút gọn dạng ngăn kéo, thẻ phòng xếp cột không tràn khung ngang | `horizontalOverflow=false` | `screenshots/ui03_mobile_rooms.png` |
| `UI-04` | Form & E2E tương tác | (1) Màn hình đổi mật khẩu lần đầu hiển thị cảnh báo đỏ inline khi nhập 2 lần lệch nhau; (2) Mở Drawer `+ Đặt phòng mới` và chuyển chế độ `Đặt phòng theo giờ`; (3) Tab `Kênh OTA & Nguồn khách` hiển thị đủ 12 nguồn sau auto-migration & nút `Khôi phục danh mục nguồn mặc định` | `pwdMismatchChecked=true` ("Mật khẩu nhập 2 lần không giống nhau"); `drawerOk=true`; `hourlyToggleOk=true`; `restoreSourcesBtn=true` | `screenshots/ui04_password_mismatch.png`, `ui04_booking_drawer_hourly.png`, `ui04_settings_sources.png` |
| `UI-CONSOLE-01` | Toàn phiên trình duyệt | Không phát sinh exception JS (`pageerror`) hay `console.error` | `pageErrors=0`, `consoleErrors=0` | Ghi nhận trong log kiểm thử Playwright |

## 2. Phát hiện thực tế đã xử lý ngay trong quá trình chạy UI QA

- Trong lượt chạy Playwright đầu tiên của `UI-04`, kiểm thử phát hiện khi hồ sơ tài khoản `owner` thiếu cờ `permissions.canManageConfig` thì nút **"Khôi phục danh mục nguồn mặc định"** bị ẩn dù vai trò là Chủ khách sạn.
- Đã khắc phục ngay tại `src/components/SettingsAndAdminView.tsx` (dòng 65–68) bằng cách bổ sung fallback `staffProfile?.role === 'owner'` cho `canManageRoomsAndSources` (đồng bộ với `canManageAccountingLock`), biên dịch lại `npm run build` sạch lỗi và xác minh lại `UI-04` đạt **PASS**.

## 3. Thư mục ảnh chụp màn hình kiểm chứng (`9` tệp PNG)

Tất cả ảnh chụp được lưu tại `QA_REPORTS/BUG_FIX_REGRESSION_v2.2.2/screenshots/`:
1. `ui04_password_mismatch.png`
2. `ui01_desktop_rooms.png`
3. `ui01_desktop_dashboard.png`
4. `ui01_desktop_timeline.png`
5. `ui01_desktop_bookings.png`
6. `ui01_desktop_finance_12m.png`
7. `ui04_booking_drawer_hourly.png`
8. `ui04_settings_sources.png`
9. `ui02_tablet_rooms.png` & `ui03_mobile_rooms.png`
