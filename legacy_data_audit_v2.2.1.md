# Báo Cáo Rà Soát Dữ Liệu Cũ Trước Khi Nâng Cấp v2.2.1 (Read-Only Audit)

- Thời điểm quét: 27/11/2026
- Nguồn dữ liệu: `backups/firestore_backup_pre_v2.2.1_2026-11-27.json`
- Tổng số đơn kiểm tra: **21** | Tổng số giao dịch: **22** | Nhân viên: **2**
- Tổng phát hiện cần lưu ý: **8**

| STT | Phân loại | Mã đơn / TK | Phòng / Vai trò | Chi tiết phát hiện | Đề xuất xử lý |
|---:|---|---|---|---|---|
| 1 | Lệch đã thu giữa Booking và Transactions | `LF-261127-WLMI` | 301 | Booking ghi nhận đã thu 600.000đ, nhưng tổng giao dịch thực tế là 0đ (chênh 600.000đ). | Đối chiếu sổ quỹ thực tế và lập bút toán điều chỉnh bổ sung (không sửa/xóa phiếu gốc). |
| 2 | Lệch đã thu giữa Booking và Transactions | `LF-QA-02` | 202 | Booking ghi nhận đã thu 1.170.000đ, nhưng tổng giao dịch thực tế là 1.050.000đ (chênh 120.000đ). | Đối chiếu sổ quỹ thực tế và lập bút toán điều chỉnh bổ sung (không sửa/xóa phiếu gốc). |
| 3 | Đơn nghỉ giờ kiểu cũ (checkOut = checkIn + 1) | `LF-QA-08` | 403 | checkIn=2026-11-27, checkOut=2026-11-28 (giờ 10:00-14:00). | Chuẩn hóa checkOut = checkIn và nights = 0 trong đợt migrate v2.2.1. |
| 4 | Đơn nghỉ giờ kiểu cũ (checkOut = checkIn + 1) | `LF-QA-09` | 501 | checkIn=2026-11-26, checkOut=2026-11-27 (giờ 13:00-15:00). | Chuẩn hóa checkOut = checkIn và nights = 0 trong đợt migrate v2.2.1. |
| 5 | Đơn dùng loại phòng đã tắt (isActive=false) | `LF-QA-11G1` | 204 | Loại phòng Phòng Gia Đình 2 Giường Lớn (rt_family) đang ở trạng thái Ngừng sử dụng nhưng phòng P.204 vẫn đang hoạt động. | Kích hoạt lại rt_family hoặc gán lại loại phòng cho các phòng con P.204, P.304, P.404. |
| 6 | Đơn dùng loại phòng đã tắt (isActive=false) | `LF-QA-11G2` | 304 | Loại phòng Phòng Gia Đình 2 Giường Lớn (rt_family) đang ở trạng thái Ngừng sử dụng nhưng phòng P.304 vẫn đang hoạt động. | Kích hoạt lại rt_family hoặc gán lại loại phòng cho các phòng con P.204, P.304, P.404. |
| 7 | Đơn dùng loại phòng đã tắt (isActive=false) | `LF-QA-11G3` | 404 | Loại phòng Phòng Gia Đình 2 Giường Lớn (rt_family) đang ở trạng thái Ngừng sử dụng nhưng phòng P.404 vẫn đang hoạt động. | Kích hoạt lại rt_family hoặc gán lại loại phòng cho các phòng con P.204, P.304, P.404. |
| 8 | Tài khoản nhân viên lưu passwordHash kiểu cũ (#8) | `@likefamilyhotel` | owner | Document staff_users/staff_mwyd1zz9_2bn25f còn trường passwordHash. | Chuyển sang Firebase Auth Email/Password + mustChangePassword=true và xóa document cũ. |

> **Nguyên tắc kế toán bất biến:** Tuyệt đối không sửa/xóa bản ghi gốc trong `transactions`, `post_checkout_adjustments`, và `audit_logs`.