# 00 — ENVIRONMENT GATE & ARCHITECTURE INVARIANTS (`v2.2.2`)

- **Dự án:** Like Family Hotel PMS (`likefamilypms`)
- **Phiên bản vá lỗi:** `v2.2.2` (nhánh Git `fix/v2.2.2` tách từ `release/v2.2.1` commit `538e13687bee1feae82e293bd2bc04ba921795c4`)
- **Thời điểm kiểm tra:** `27/11/2026` (múi giờ `Asia/Ho_Chi_Minh`, UTC+7)
- **Trạng thái cổng môi trường:** **PASS (100% Đạt chuẩn 0đ Spark & Cô lập Production)**

---

## 1. Kiểm tra 4 Điểm chốt & Ràng buộc Hạ tầng 0đ (Firebase Spark)

| Hạng mục | Yêu cầu bắt buộc | Kết quả kiểm chứng | Trạng thái |
| --- | --- | --- | --- |
| Firebase Billing / Blaze | Tuyệt đối không bật Billing (gói Spark 0đ) | Không sử dụng dịch vụ trả phí; toàn bộ giao dịch chạy trên Client SDK `runTransaction` | **PASS** |
| Cloud Functions | Không triển khai Cloud Functions | Thư mục `functions/` không tồn tại; `0` lệnh gọi Cloud Functions | **PASS** |
| Firebase Storage | Không import `firebase/storage` | Quét toàn mã nguồn `src/`: `0` kết quả import | **PASS** |
| Google Sign-In | Không import `GoogleAuthProvider` | Quét toàn mã nguồn `src/`: `0` kết quả import (100% Email/Password `@likefamilyhotel.com`) | **PASS** |
| Chuẩn ngày & Đệm 5 phút | Lưu ISO `YYYY-MM-DD`, hiển thị `dd/mm/YYYY`, đệm `5` phút nghỉ giờ | `DEFAULT_CLEANING_BUFFER_MINUTES = 5`, `[startAt, endAt + bufferMs)` | **PASS** |

## 2. Hạ tầng kiểm thử cô lập (Local Emulator + Playwright Core)

- **Firebase Local Emulator Suite:** Đã cấu hình trong `firebase.json` (`auth: 127.0.0.1:9099`, `firestore: 127.0.0.1:8080`, `singleProjectMode: true`) kèm JDK 21 cục bộ (`C:\Users\LDP\.jdks\ms-21.0.12.1`).
- **Gỡ chặn UI trên Node `v20.18.0`:** Cài đặt `playwright-core` (devDependency) điều khiển Google Chrome cục bộ (`C:\Program Files\Google\Chrome\Application\chrome.exe`), không thay đổi phiên bản Node toàn cục của máy chủ phát triển.
- **Cờ kết nối Emulator an toàn (`src/lib/firebase.ts`):** Hỗ trợ biến môi trường tùy chọn `VITE_USE_FIREBASE_EMULATOR=true` cho phiên kiểm thử UI cục bộ; ở bản dựng Production (`npm run build`), biến không được đặt nên ứng dụng chỉ kết nối dự án Firebase chính thức.

## 3. Kết quả Cổng Dừng (Stop Gate — Bảo vệ Production)

- **Dữ liệu Staging 2 tháng `QA2M_*` trên `likefamilypms`:** Giữ nguyên 100% (`500` đơn, `681` giao dịch, `260` khách — **0** lệnh ghi/xóa lên `likefamilypms` trong toàn bộ phiên QA `v2.2.2`).
- **Trạng thái Deploy Production:** **CHƯA DEPLOY** (`firebase deploy` chưa được gọi) theo đúng Cổng Dừng chờ Chủ dự án phê duyệt phát hành.
- **Biên dịch sản phẩm (`npm run build`):** `tsc -b && vite build` kết thúc với **0 lỗi TypeScript, 0 lỗi Vite**, sinh gói PWA `dist/` (9 precache entries) trong `5.60s`.
