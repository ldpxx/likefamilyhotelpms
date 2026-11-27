# 10 — FINANCIAL RECONCILIATION REPORT (`v2.2.2` POST-FIX)

- **Nguồn dữ liệu đối chiếu:** Toàn bộ tập dữ liệu 2 tháng `QA2M_*` + 1 đơn E2E (`500` đơn, `681` giao dịch) khôi phục trên Firebase Local Emulator, tính toán bằng hàm Single Source of Truth `getRoomRevenueInRange()` trong `src/lib/revenueMetrics.ts` phiên bản `v2.2.2`.
- **Kết luận kế toán:** **KHỚP TUYỆT ĐỐI `0đ` SAI LỆCH** giữa tổng từng ngày lẻ (`61` ngày), tổng hai tháng tách rời (`T10 + T11`), kỳ gộp 2 tháng (`01/10–30/11/2026`), và bảng báo cáo 12 tháng hiển thị trên giao diện UI.

---

## 1. Bảng Đối chiếu P&L Trước và Sau Bản vá `v2.2.2`

| Chỉ tiêu P&L | Tháng 10/2026 (`01/10–31/10`) | Tháng 11/2026 (`01/11–30/11`) | Tổng `T10 + T11` | Kỳ gộp 2 tháng (`01/10–30/11`) | Tổng 61 ngày lẻ | Chênh lệch (`T10+T11` − `2M`) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **Doanh thu phòng (`roomRev`)** | `195.850.000đ` | `166.900.000đ` | `362.750.000đ` | `362.750.000đ` | `362.750.000đ` | **`0đ`** |
| **Số đêm bán (`soldNights`)** | `387` | `343` | `730` | `730` | `730` | **`0`** |
| **Công suất phòng (`occupancyPct`)** | `83.2%` | `76.2%` | — | `79.8%` | — | **Khớp UI** |
| **Doanh thu dịch vụ (`serviceRev` — Pre-fix `v2.2.1`)** | `31.170.000đ` | `27.325.000đ` | `58.495.000đ` | `58.465.000đ` | — | `+30.000đ` ❌ |
| **Doanh thu dịch vụ (`serviceRev` — Post-fix `v2.2.2`)** | **`30.320.000đ`** | **`28.205.000đ`** | **`58.525.000đ`** | **`58.525.000đ`** | **`58.525.000đ`** | **`0đ` ✅** |
| **Phí hủy giữ cọc (`forfeitedCancelFees`)** | `1.000.000đ` | `500.000đ` | `1.500.000đ` | `1.500.000đ` | `1.500.000đ` | **`0đ`** |
| **DV & Phí hủy (cột UI 12 tháng)** | `31.320.000đ` | `28.705.000đ` | `60.025.000đ` | `60.025.000đ` | `60.025.000đ` | **`0đ`** |
| **Tổng doanh thu (`totalRevenue`)** | **`227.170.000đ`** | **`195.605.000đ`** | **`422.775.000đ`** | **`422.775.000đ`** | **`422.775.000đ`** | **`0đ` ✅** |
| **Tổng chi phí vận hành (`expenses`)** | `33.190.000đ` | `32.990.000đ` | `66.180.000đ` | `66.180.000đ` | — | **`0đ`** |

## 2. Truy vết minh bạch mọi biến động số học (`v2.2.1` → `v2.2.2`)

1. **Triệt tiêu hoàn toàn khoản cộng trùng `+30.000đ` (`BUG-01`):** Mỗi dòng dịch vụ chỉ thuộc duy nhất 1 ngày `businessDate` (`Asia/Ho_Chi_Minh`), không còn hiện tượng đơn `31/10 → 01/11` bị cộng dịch vụ ở cả Tháng 10 và Tháng 11.
2. **Giải trình chính xác mức `+60.000đ` tổng dịch vụ 2 tháng (`58.465.000đ` → `58.525.000đ`):**
   - `499` đơn `QA2M_*` trong kỳ T10–T11 có tổng dịch vụ chính xác `58.465.000đ`.
   - Đơn E2E `QA2M_E2E_LIFECYCLE_01` (nhận phòng `05/12/2026`) có 1 khoản dịch vụ `60.000đ` được tạo vào ngày **`27/11/2026`**. Với cơ chế `businessDate` chuẩn kế toán, khoản `60.000đ` này được ghi nhận đúng vào ngày phát sinh trong Tháng 11/2026 (`58.465.000 + 60.000 = 58.525.000đ`).
3. **Hàng đợi kiểm toán dữ liệu thiếu ngày (`LEGACY_DATE_REVIEW_REQUIRED`):** `0` mục trên toàn bộ 500 đơn.
4. **Đối chiếu trực tiếp giao diện UI (`ui01_desktop_finance_12m.png`):** Các con số hiển thị trên bảng Báo cáo 12 tháng (`T10: 227.170.000đ`, `T11: 195.605.000đ`, `Tổng 12T: 422.775.000đ`, `Tiền phòng: 362.750.000đ`, `DV & Phí hủy: 60.025.000đ`, `Số đêm: 730`, `Chi phí: 66.180.000đ`) trùng khớp **100%** với kết quả tính toán tự động.
