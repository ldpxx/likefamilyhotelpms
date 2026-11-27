# UI/UX GEOMETRIC AUDIT REPORT — LIKE FAMILY PMS `v2.2.2`

- **Công cụ kiểm toán:** `scripts/qa_ui_ux_audit.mjs` (Playwright Core + Google Chrome trên Firebase Local Emulator Suite nạp `1,538` tài liệu từ `backups/firestore_backup_pre_v2.2.2_2026-11-27.json` — **0 thao tác lên Production**).
- **4 độ phân giải kiểm chứng:** Desktop (`1440×900`), Tablet (`768×1024`), Mobile (`390×844`), Mobile nhỏ (`360×800`).
- **Kết quả sau vá lỗi (After-Fix):** **19 / 19 tổ hợp màn hình × độ phân giải đạt 100% PASS** (`0` tràn ngang, `0` che khuất nút, `0` nút `< 40×40px`, `0` cặp nút sát `< 8px`, `0` chữ `< 12px`, `0` cắt ngoài khung, **`0` `console.error`**, **`0` `pageerror`**).

---

## 1. Bảng So Sánh Trước và Sau Vá Lỗi UI/UX (`Before-Fix` → `After-Fix`)

| Nhóm lỗi phát hiện | Trước vá (`Before-Fix`) | Nguyên nhân & Bản vá đã triển khai | Sau vá (`After-Fix`) |
| --- | --- | --- | :-: |
| **1. Tràn ngang & vỡ thẻ KPI trên `360px` (`FinanceReportsView`)** | `mobile_360_finance` tràn ngang (`overflow=true`, `scrollWidth=365px`), cụm `Từ...đến...` tràn mép phải và số `216.745.000đ` tràn khỏi thẻ 2 cột | Thêm `flex-wrap`, `w-[132px] sm:w-36` cho `DateInputVN`, đổi lưới KPI thành `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`, thêm `w-full sm:w-auto max-w-full` & `overflow-x-clip` trong `src/components/FinanceReportsView.tsx` | **`overflow=false` (`360px`)** ✅ |
| **2. Chồng chữ thanh tab `BookingDetailModal` trên `360px`** | Các nút tab trong flex ngang bị nén đè chữ lên nhau khi mở drawer trên màn hình nhỏ | Bổ sung `shrink-0` cho nút tab trong `src/components/BookingDetailModal.tsx` (dòng 579) và đổi header sang `flex-nowrap items-start justify-between` để nút đóng `X` không rớt dòng | **0 chồng chữ, vuốt ngang mượt** ✅ |
| **3. Bản in `@media print` (A4 & A5) in kèm nền ứng dụng & cắt chữ ký** | `PrintableFormModal` in kèm toàn bộ danh sách `Sơ đồ phòng` phía sau nhiều trang và bị cắt hộp chữ ký dưới chân hóa đơn | Bọc `FormPaperPreview` trong `.print-sheet-root` (`PrintableFormModal.tsx`) và thêm quy tắc `@media print` cô lập tuyệt đối `.print-sheet-root`, mở khóa overflow & căn lề `@page { margin: 8mm }` trong `src/index.css` | **A4 (`794px`) & A5 (`559px`) sạch 1 trang, `0` tràn** ✅ |
| **4. Ảnh VietQR trên hóa đơn in bị lỗi CORS & chưa ẩn khi nợ `= 0đ`** | `PrintableFormModal` gắn `crossOrigin="anonymous"` làm trình duyệt chặn ảnh `img.vietqr.io` (`2` lỗi console) và chưa chặn hiển thị khi `balance <= 0` | Gỡ `crossOrigin="anonymous"`, bổ sung điều kiện `balance > 0` trên cả `PrintableFormModal.tsx` lẫn `BookingDetailModal.tsx`, hiển thị rõ số tiền & nội dung chuyển khoản `ND: THANH TOAN <mã đơn> P<phòng>` | **Ảnh QR sắc nét, `0` lỗi console, ẩn 100% khi nợ `0đ`** ✅ |
| **5. Nút bấm Mobile/Tablet `< 40×40px` & khoảng cách `< 8px`** | `7–20` nút nhỏ (`h-6`/`h-8`/`h-9`) và `2–8` cặp nút sát nhau (`gap: 0–6px`) trên Tablet `768px` & Mobile `390px`/`360px` | Bổ sung quy tắc `@media (max-width: 768px)` đảm bảo `min-height: 40px; min-width: 40px` cho nút tương tác và `gap >= 8px` trên các thanh nhóm nút trong `src/index.css` | **`smallBtns = 0`, `crampedPairs = 0` (19/19)** ✅ |
| **6. Cỡ chữ nội dung `< 12px`** | `6–67` phần tử nhãn/chú thích dùng `text-[10px]` / `text-[11px]` | Đặt sàn kiểu chữ dễ đọc tối thiểu `12px` cho `.text-[10px]` và `.text-[11px]` trong `src/index.css` | **`smallText = 0` (19/19)** ✅ |

---

## 2. Kết quả Kiểm chứng Chi tiết 3 Cụm Nghiệp vụ Thực tế

### 2.1. Cụm Mã VietQR Thanh Toán
- **Đơn còn công nợ (`P.201` — `S2M-0440`, nợ `1.080.000đ`):**
  - Hiển thị ảnh VietQR rõ nét (`176×205px`) với URL chính xác: `https://img.vietqr.io/image/MB-0901234567-compact2.png?amount=1080000&addInfo=THANH+TOAN+S2M-0440+P201&accountName=LE+DUC+PHUONG`.
  - Hiển thị đầy đủ trên cả Desktop (`1440×900`), Mobile (`360×800`) và Hóa đơn in A4/A5.
- **Đơn đã thanh toán đủ (`balance === 0đ`):**
  - `vietQrHiddenWhenZeroBalance = true` (ẩn trên `BookingDetailModal`) và `printModalQrShownWhenPaid = false` (ẩn trên `PrintableFormModal`).

### 2.2. Cụm Form Đăng Ký Tạm Trú & Ảnh Giấy Tờ Base64 (`OccupantOcrPanel`)
- Tải ảnh thử nghiệm vào ô **1. Mặt trước CCCD** trên Mobile `360×800` & `390×844`: `uploadedBase64Preview = true`, xem trước ảnh sắc nét bên trong khung, `ocrMobile360Overflow = false`, `ocrMobile390Overflow = false`, `occluded = 0`.

### 2.3. Cụm Bản In Hóa Đơn & Phiếu Xác Nhận (`@media print` A4 & A5)
- **Khổ A4 (`794×1123`):** `noPrintHidden = true`, `overflowX = false` (`scrollWidth = 794`), ảnh VietQR hiển thị rõ nét, không lẫn nền ứng dụng.
- **Khổ A5 (`559×794`):** `noPrintHidden = true`, `overflowX = false` (`scrollWidth = 559`), đầy đủ tiêu đề, bảng giá, VietQR và khu vực chữ ký Khách hàng / Lễ tân.

---

## 3. Kết quả Quét Hình học 19 Tổ hợp Màn hình (After-Fix)

| Tổ hợp màn hình & Viewport | Overflow | Occluded | Nút `< 40px` | Cặp `< 8px` | Chữ `< 12px` | Clipped |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| `desktop_1440` (`rooms`, `dashboard`, `bookings`, `finance`) | `false` | `0` | `0` | `0` | `0` | `0` |
| `tablet_768` (`rooms`, `dashboard`, `bookings`, `finance`) | `false` | `0` | `0` | `0` | `0` | `0` |
| `mobile_390` (`rooms`, `dashboard`, `bookings`, `finance`) | `false` | `0` | `0` | `0` | `0` | `0` |
| `mobile_360` (`rooms`, `dashboard`, `bookings`, `finance`) | `false` | `0` | `0` | `0` | `0` | `0` |
| `mobile_360_booking_detail_vietqr` (`360×800`) | `false` | `0` | `0` | `0` | `0` | `0` |
| `mobile_360_guest_ocr_base64` (`360×800`) | `false` | `0` | `0` | `0` | `0` | `0` |
| `mobile_390_guest_ocr_base64` (`390×844`) | `false` | `0` | `0` | `0` | `0` | `0` |

**Thư mục ảnh chụp kiểm chứng:** `QA_REPORTS/UI_UX_AUDIT_v2.2.2/screenshots/` (`desktop_1440_rooms.png`, `tablet_768_rooms.png`, `mobile_390_rooms.png`, `mobile_360_rooms.png`, `mobile_360_finance.png`, `special_vietqr_desktop.png`, `special_vietqr_mobile360.png`, `special_ocr_mobile360.png`, `special_print_modal_screen.png`, `special_print_A4.png`, `special_print_A5.png`).
