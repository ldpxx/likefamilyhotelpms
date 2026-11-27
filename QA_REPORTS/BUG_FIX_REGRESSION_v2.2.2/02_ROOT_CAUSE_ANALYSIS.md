# 02 — ROOT CAUSE ANALYSIS (`BUG-01`, `BUG-02`, `BUG-03`, `UI-01..UI-04`)

Tài liệu phân tích nguyên nhân gốc rễ của 3 lỗi kỹ thuật và 1 nút thắt môi trường UI phát hiện sau đợt kiểm thử Staging 2 tháng (`v2.2.1`), làm cơ sở thiết kế bản vá `v2.2.2`.

---

## 1. `BUG-01` [High] — Cộng trùng `serviceRev` (`+30.000đ`) trên đơn vắt qua ranh giới tháng

- **Vị trí mã nguồn cũ:** `src/lib/revenueMetrics.ts` (hàm `getRoomRevenueInRange`).
- **Nguyên nhân gốc rễ:**
  - Logic cũ chỉ lọc tập đơn có đêm lưu trú giao với khoảng `[from, to]`, sau đó cộng **toàn bộ** `booking.serviceTotal + booking.hourlySurcharge` vào bất kỳ kỳ nào có giao cắt với đơn đó.
  - Khi một đơn nhận phòng `31/10/2026` và trả phòng `01/11/2026` có dịch vụ `30.000đ`, cả báo cáo Tháng 10 và Tháng 11 đều giao cắt hoặc bám vào đơn này theo ranh giới `checkIn`/`checkOut`, dẫn tới khoản `30.000đ` bị ghi nhận ở cả 2 tháng (`T10 + T11 = 58.495.000đ` > kỳ gộp `2 tháng = 58.465.000đ`).
- **Hướng khắc phục triệt để:** Gắn ngày hạch toán bất biến `businessDate` (`YYYY-MM-DD`, múi giờ `Asia/Ho_Chi_Minh`) cho từng dòng `BookingServiceItem` và tách bạch phụ thu (`early` → `checkIn`, `late` → `checkOut`, `hourly` → `checkIn`). Không bao giờ đổi ngày dịch vụ theo bộ lọc kỳ báo cáo.

## 2. `BUG-02` [Medium] — Race Condition khi nhiều yêu cầu đặt trùng 1 phòng cùng thời điểm

- **Vị trí mã nguồn cũ:** `src/lib/pmsActions.ts`, `src/lib/cancellationActions.ts`, `src/lib/postStayActions.ts`, `firestore.rules`.
- **Nguyên nhân gốc rễ:**
  - Trước `v2.2.2`, kiểm tra trùng phòng chỉ thực hiện phía Client trên mảng `bookings` trong bộ nhớ (hoặc `getDocs` ngoài transaction) rồi mới gọi `writeBatch()`.
  - Firestore Client SDK chỉ khóa nguyên tử các **tài liệu đã được đọc qua `tx.get()`** bên trong `runTransaction()`, không hỗ trợ khóa theo truy vấn `query`. Do đó, khi 2–12 nhân viên bấm đặt cùng 1 phòng tại cùng một mili-giây, cả hai đều thấy phòng trống và đều ghi thành công (double-booking).
- **Hướng khắc phục triệt để (Phương án A — 0đ Spark):**
  - Tạo collection chỉ mục khóa phòng theo ngày `room_occupancy/{roomId}_{YYYY-MM-DD}` (`src/lib/occupancyService.ts`).
  - Mọi thao tác giữ/đổi/trả/hủy/bảo trì phòng (đủ 15 luồng) đều chạy trong `runTransaction()`: đọc toàn bộ tài liệu ngày liên quan bằng `tx.get()`, kiểm tra giao cắt dấu thời gian kèm **đệm dọn phòng 5 phút** `[startAt, endAt + 5m)`, sau đó ghi đồng thời `room_occupancy` và `bookings`/`room_maintenances`.

## 3. `BUG-03` [Low] — `hotel_config/main` legacy thiếu mảng `bookingSources`

- **Vị trí mã nguồn cũ:** `src/context/PmsContext.tsx`, `src/lib/pmsActions.ts`, `src/components/SettingsAndAdminView.tsx`.
- **Nguyên nhân gốc rễ:**
  - Các khách sạn khởi tạo trước thời điểm ra mắt `bookingSources` chỉ có trường `otaChannels` (6 kênh OTA) trong `hotel_config/main` mà không có mảng `bookingSources` hợp nhất (6 nguồn trực tiếp + 6 kênh OTA).
  - Giao diện tạm fallback bằng hằng số phía Client nhưng không ghi bền vững xuống Firestore, gây khó khăn khi Chủ KS muốn thêm/sửa/ẩn nguồn khách và gây lệch dữ liệu kiểm toán schema.
- **Hướng khắc phục triệt để:** Viết hàm migration idempotent `ensureBookingSourcesConfig()` có cờ `configMigrationVersion: 1` chạy trong `runTransaction()` (tối đa 1 lần/phiên cho `owner`/`superadmin`), chỉ bổ sung khi thực sự thiếu và bảo toàn 100% `otaChannels` cũng như mọi nguồn tùy chỉnh; bổ sung nút **"Khôi phục danh mục nguồn mặc định"** (chỉ bổ sung phần thiếu) trong Cài đặt.

## 4. `UI-01` → `UI-04` [Environment Block] — Nút thắt Node `v20.18.0` cho trình duyệt tự động

- **Nguyên nhân gốc rễ:** Gói `chrome-devtools-mcp` yêu cầu Node `>= 20.19.0`, trong khi máy phát triển chạy Node `v20.18.0`, khiến đợt QA trước bị chặn toàn bộ 4 hạng mục giao diện.
- **Hướng khắc phục:** Cài đặt cục bộ `playwright-core` (devDependency) điều khiển Google Chrome sẵn có trên máy, chạy trực tiếp trên Node `v20.18.0` chống ảnh hưởng cấu hình toàn cục và kết hợp chạy trên Firebase Local Emulator Suite (cô lập 100% với Production).
