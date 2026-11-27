# PHƯƠNG ÁN THIẾT KẾ HỆ THỐNG QUẢN LÝ KHÁCH SẠN (LIKE FAMILY PMS)

**Phiên bản:** 2.3 (Bản thiết kế chuẩn cuối cùng — Đầy đủ nghiệp vụ Lễ tân, Tìm kiếm phòng trống theo loại phòng/số lượng & Tạo đặt phòng cho các phòng đã chọn, Lịch đặt phòng Timeline Calendar liên tục, AI OCR 3 ảnh & Dấu nhập cảnh, Đa bảng giá & Điều chỉnh giá thông minh, Bảo trì phòng & Sao lưu dữ liệu)  
**Trạng thái:** Sẵn sàng triển khai Giai đoạn 1 (Web App)  
**Đối tượng áp dụng:** Khách sạn quy mô nhỏ dưới 30 phòng (Boutique Hotel, Mini Hotel, Homestay, Villa) vận hành theo mô hình gia đình

---

## 1. Tổng Quan Dự Án

### 1.1. Mục tiêu hệ thống
**Like Family PMS (Property Management System)** được thiết kế chuyên biệt cho quy mô khách sạn mini từ **30 phòng trở lại**, vận hành theo mô hình công ty gia đình. Hệ thống số hóa toàn diện quy trình từ khâu cấu hình phòng/đa bảng giá, tra cứu phòng trống theo từng loại phòng & số lượng yêu cầu để tạo đặt phòng tức thì, quản lý lịch đặt phòng trực quan dạng Timeline Calendar liên tục, nhận đặt phòng lẻ/đoàn/OTA, điều chỉnh giá linh hoạt, quét AI OCR & lưu trữ hồ sơ/ảnh giấy tờ tùy thân của toàn bộ khách lưu trú, kiểm soát hạn tạm trú theo dấu nhập cảnh & khai báo ASM cho khách nước ngoài, quản lý bảo trì từng phòng, buồng phòng đến quản lý dòng tiền, công nợ OTA, nhận diện khách hàng thân thiết, xuất biểu mẫu giao dịch tùy chỉnh, sao lưu dữ liệu và báo cáo tài chính lãi/lỗ chi tiết.

Mục tiêu cốt lõi là **tinh gọn – đồng bộ tức thì – dễ dùng cho mọi thành viên trong gia đình – an toàn chống sai sót – chi phí duy trì gần như bằng 0đ**, xử lý mượt mà mọi tình huống phát sinh thực tế tại quầy lễ tân.

### 1.2. Chiến lược triển khai 2 giai đoạn (Web App First)
* **Giai đoạn 1 — Xây dựng Web App hoàn chỉnh (Ưu tiên số 1):** Tập trung hoàn thiện 100% tính năng cốt lõi, công cụ tìm kiếm phòng trống theo loại phòng/số lượng & tạo đặt phòng cho các phòng được chọn, sơ đồ phòng & lịch đặt phòng Timeline Calendar liên tục, nghiệp vụ lễ tân, quản lý đa bảng giá & điều chỉnh giá thông minh, lưu trữ hồ sơ đa khách & AI OCR 3 loại ảnh giấy tờ, cảnh báo thời hạn lưu trú & đánh dấu khai báo ASM, nhật ký bảo trì phòng, tùy chỉnh biểu mẫu động, quản lý nhân viên, đối soát OTA, báo cáo tài chính và sao lưu dữ liệu trên nền tảng Web App (tối ưu cho máy tính quầy lễ tân, đồng thời hỗ trợ giao diện Responsive/PWA để người nhà và buồng phòng mở nhanh bằng trình duyệt trên điện thoại trong thời gian đầu).
* **Giai đoạn 2 — Đóng gói & Mở rộng App cho điện thoại (Mobile App):** Sau khi Web App đã vận hành ổn định, trơn tru tại khách sạn, tiến hành đóng gói thành ứng dụng di động (Android APK / iOS) sử dụng chung cơ sở dữ liệu Firebase, bổ sung các tiện ích đặc thù trên di động (thông báo đẩy Push Notification tức thì khi có khách đặt/dọn phòng xong/cảnh báo hạn lưu trú, chụp ảnh & quét OCR trực tiếp bằng camera điện thoại).

### 1.3. Phạm vi & Đối tượng sử dụng
* **Chủ khách sạn / Quản lý chính (Admin/Owner):** Toàn quyền theo dõi báo cáo tài chính Lãi/Lỗ (P&L), doanh thu, chi phí, công nợ OTA, cấu hình danh mục tầng/loại phòng/đa bảng giá, **thiết kế biểu mẫu động trên Web App**, **quản lý & phân quyền nhân viên**, **thực hiện dọn dẹp/xóa thủ công kho ảnh giấy tờ cũ**, **sao lưu toàn bộ dữ liệu**, và kiểm soát nhật ký thao tác/hoàn tác để quản trị minh bạch.
* **Thành viên trực quầy / Lễ tân (Front Desk):** Tra cứu phòng trống nhanh theo loại phòng & số lượng khi khách hỏi để tạo đặt phòng ngay, theo dõi lịch đặt phòng Calendar & sơ đồ phòng, xử lý đặt phòng lẻ/đoàn/OTA, điều chỉnh giá phòng linh hoạt, tra cứu & đối chiếu khách quay lại, phân bổ phòng, Check-in đa khách & chụp/quét AI OCR giấy tờ tùy thân, theo dõi cảnh báo hạn lưu trú & đánh dấu khai báo tạm trú ASM, Check-out / trả phòng sớm / phụ thu giờ, gửi phiếu xác nhận cho khách, đổi phòng/ghép phòng, ghi nhận bảo trì phòng, thao tác hoàn tác khi nhầm lẫn và thu chi tại quầy.
* **Bộ phận Buồng phòng (Housekeeping):** Xem danh sách phòng cần dọn theo tầng trên giao diện di động, cập nhật trạng thái dọn phòng tức thì, báo cáo hỏng hóc thiết bị và kiểm kê minibar.

---

## 2. Kiến Trúc Hệ Thống & Công Nghệ (100% Firebase Serverless)

### 2.1. Tại sao chọn 100% Firebase cho quy mô < 30 phòng?
* **Đồng bộ thời gian thực (Real-time Sync):** Khi lễ tân thao tác Check-in, đổi phòng hoặc buồng phòng bấm "Đã dọn xong", sơ đồ phòng và lịch đặt phòng trên mọi thiết bị đang mở cập nhật ngay lập tức mà không cần tải lại trang.
* **Hoạt động bền bỉ kể cả khi rớt mạng (Offline Persistence):** Cloud Firestore tự động lưu bộ nhớ đệm (cache) ngay trên trình duyệt máy tính quầy lễ tân. Nếu mạng Wi-Fi khách sạn bị chập chờn, lễ tân vẫn Check-in/Check-out bình thường, dữ liệu tự động đồng bộ lên đám mây ngay khi có mạng trở lại.
* **Chi phí vận hành gần như 0đ:** Với quy mô dưới 30 phòng, dung lượng dữ liệu và lượt đọc/ghi hàng ngày nằm gọn trong hạn mức miễn phí của Firebase (hoặc chỉ tốn vài nghìn đồng/tháng trên gói Blaze), không tốn chi phí thuê máy chủ VPS hay bảo trì server phức tạp.
* **Sẵn sàng nâng cấp từ Web lên Mobile App:** Kiến trúc ReactJS + Firebase giúp tái sử dụng toàn bộ logic nghiệp vụ và dữ liệu khi chuyển sang đóng gói app điện thoại ở Giai đoạn 2 mà không phải viết lại hệ thống.

### 2.2. Bộ công nghệ chuẩn (Tech Stack)
* **Frontend (Web App Giai đoạn 1):** ReactJS (Vite) + Tailwind CSS + Lucide Icons (Thiết kế giao diện tối ưu cho màn hình máy tính quầy lễ tân, tương thích Responsive trên trình duyệt di động).
* **Mobile Wrapper (Giai đoạn 2):** Capacitor (đóng gói trực tiếp từ mã nguồn Web App sang Android APK / iOS, tích hợp Camera chụp/quét giấy tờ và Firebase Cloud Messaging).
* **Authentication (Đăng nhập & Quản lý tài khoản):** Firebase Authentication (Đăng nhập bằng Email/Mật khẩu hoặc Google Sign-in, hỗ trợ khóa/mở khóa tài khoản nhân viên tức thì).
* **Database (Cơ sở dữ liệu):** Cloud Firestore (NoSQL thời gian thực, bật tính năng `enableIndexedDbPersistence`).
* **Storage (Lưu trữ hình ảnh giấy tờ & Biểu mẫu):** Firebase Cloud Storage (Lưu ảnh chụp CCCD 2 mặt, ảnh Hộ chiếu/Visa/Dấu nhập cảnh, logo khách sạn, hóa đơn chứng từ chi phí & sửa chữa).
* **Hosting:** Firebase Hosting (tốc độ cao, có sẵn chứng chỉ bảo mật SSL miễn phí, hỗ trợ cài đặt Web App ra màn hình chính như ứng dụng PWA).
* **AI OCR & Tích hợp tiện ích:**
  * **Google Gemini Vision API (`gemini-2.5-flash`):** Nhận diện hình ảnh CCCD, Hộ chiếu, Visa và Dấu mộc nhập cảnh; trích xuất chính xác các trường dữ liệu cần thiết điền thẳng vào form khách hàng.
  * Tạo mã **VietQR động** tự động điền sẵn số tiền và nội dung thanh toán từng phòng/đoàn.
  * Xuất phiếu xác nhận & biểu mẫu sang **Ảnh PNG chất lượng cao / PDF** để gửi nhanh qua Zalo Web, WhatsApp, Messenger, Email cho khách ngay tại quầy.
  * Kết nối đồng bộ lịch phòng **OTA (iCal / Channel Manager)** với Booking.com, Agoda, Airbnb, Traveloka.

---

## 3. Các Phân Hệ Chức Năng Chính & Giải Pháp Nghiệp Vụ

### 3.1. Quản lý Phòng theo Loại phòng & Tầng + Đa Mức Giá & Điều Chỉnh Giá Thông Minh

#### A. Quản lý Cấu trúc Tầng, Loại phòng & Đa Bảng Giá (Multi-tier Room Pricing)
* **Quản lý Phòng theo Tầng & Loại phòng:**
  * Danh sách phòng (tối đa 30 phòng) được phân nhóm rõ ràng theo **Tầng** (VD: Tầng 1, Tầng 2, Tầng 3, Tầng 4, Tầng 5...) và gắn với một **Loại phòng** cụ thể (VD: *Phòng Đơn Tiêu Chuẩn*, *Phòng Đôi Không Ban Công*, *Phòng Đôi Có Ban Công*, *Phòng Gia Đình*).
  * Sơ đồ phòng hỗ trợ lọc nhanh theo **Tầng**, theo **Loại phòng**, hoặc theo **Trạng thái phòng**.
* **1 Loại phòng có nhiều mức giá khác nhau (`priceTiers`):**
  * Trong cấu hình của mỗi Loại phòng, chủ khách sạn có thể tạo **không giới hạn các gói giá** để lễ tân chọn nhanh tùy theo đối tượng khách và thời điểm. Ví dụ:
    * *Giá Ngày Thường (Mặc định):* 350.000đ / đêm
    * *Giá Cuối Tuần / Lễ Tết:* 450.000đ / đêm
    * *Giá Khách Quen / Giảm Giá:* 300.000đ / đêm
    * *Giá Thuê Tuần (7 ngày):* 280.000đ / đêm
    * *Giá Thuê Tháng (30 ngày):* 180.000đ / đêm (tương đương 5.400.000đ/tháng)

#### B. Cơ chế Điều Chỉnh Giá Linh Hoạt trên Đơn Đặt Phòng (Tại mọi thời điểm)
Trong suốt vòng đời của đơn đặt phòng — dù đang ở bước **Tạo đặt phòng**, **Làm thủ tục Nhận phòng (Check-in)**, **Khách đang lưu trú**, hay **Làm thủ tục Trả phòng (Check-out)** — khu vực **Chi tiết Giá phòng** đều cho phép lễ tân (có phân quyền) điều chỉnh giá cực kỳ linh hoạt qua 4 công cụ đồng bộ:
1. **Chọn nhanh theo Gói giá của Loại phòng:** Dropdown hiển thị tất cả các mức giá đã cấu hình cho loại phòng đó (VD: chọn chuyển từ *Giá Ngày Thường* sang *Giá Khách Quen*).
2. **Sửa trực tiếp từng ngày riêng lẻ (`dailyRates`):** Bảng liệt kê chi tiết từng đêm lưu trú (Đêm 1, Đêm 2, Đêm 3...), cho phép bấm sửa đơn giá của bất kỳ đêm nào (VD: đêm thứ 6 giữ 350k, đêm thứ 7 tăng 450k).
3. **Ô "Đổi 1 giá cho tất cả các ngày" (Bulk Apply Single Rate):** Khi nhập một mức giá vào ô này và bấm áp dụng (ví dụ: nhập `320.000đ`), toàn bộ các đêm trong đơn đặt phòng đó lập tức được cập nhật đồng loạt về mức `320.000đ/đêm` và tự tính lại tổng tiền.
4. **Ô "Tổng tiền phòng" tự động chia đều ngược lại (Total-to-Daily Auto Split):**
   * Dành cho các đơn dài ngày hoặc khách thỏa thuận trọn gói (VD: khách ở 7 đêm chốt tổng tiền phòng tròn `2.000.000đ`).
   * Khi lễ tân nhập trực tiếp số tiền vào **Ô Tổng tiền phòng**, hệ thống tự động chia đều số tiền đó cho số đêm lưu trú và cập nhật lại đơn giá từng ngày tương ứng (nếu phép chia có số lẻ làm tròn nghìn đồng, phần chênh lệch lẻ được cộng tự động vào đêm cuối cùng để đảm bảo tổng cộng các đêm luôn khớp 100% với số tổng đã nhập).

### 3.2. Tìm Kiếm Phòng Trống Theo Loại Phòng & Số Lượng Phòng — Tạo Đặt Phòng Cho Các Phòng Được Chọn

Để xử lý nhanh gọn và chính xác tình huống khách gọi điện thoại, nhắn Zalo hoặc đứng trực tiếp tại quầy hỏi đặt phòng (ví dụ: *"Từ ngày 15/12 đến 18/12 còn trống 3 phòng Đôi Có Ban Công và 1 phòng Đơn không?"*), hệ thống tích hợp công cụ **Tìm Phòng Trống Thông Minh (Room Availability Finder)** ngay trên trang chủ Dashboard, Sơ đồ phòng và Lịch Calendar:

#### A. Nhập Tiêu chí Tìm kiếm (Từ ngày – Đến ngày, Loại phòng & Số lượng phòng)
* **Khoảng thời gian lưu trú:** Chọn **Từ ngày (Check-in)** $\rightarrow$ **Đến ngày (Check-out)** (tự động tính và hiển thị tổng số đêm).
* **Chọn Loại phòng & Số lượng phòng cần tìm của loại phòng đó:**
  * Cho phép chọn **Loại phòng** (VD: *Phòng Đôi Có Ban Công*) và nhập **Số lượng phòng cần đặt** của đúng loại phòng đó (VD: `3` phòng).
  * Hỗ trợ nút **"+ Thêm loại phòng"** để khách có thể tìm kết hợp nhiều loại phòng cùng lúc trong 1 lần tra cứu (VD: dòng 1 tìm `3` *Phòng Đôi Có Ban Công* + dòng 2 tìm `1` *Phòng Đơn Tiêu Chuẩn*).

#### B. Logic Kiểm tra Phòng Trống Chuẩn Xác (Zero-Overbooking Check)
Hệ thống đối chiếu toàn bộ danh sách phòng (`rooms`) theo từng loại phòng được yêu cầu với các đơn đặt phòng đang có hiệu lực (`reserved`, `in_house`) và lịch khóa bảo trì (`maintenance`) trong khoảng thời gian `[checkIn, checkOut)`:
* Một phòng được xác định là **Còn trống** khi và chỉ khi không tồn tại bất kỳ đơn đặt phòng nào thỏa mãn điều kiện chồng lấn `existing.checkIn < search.checkOut` VÀ `existing.checkOut > search.checkIn` (nhận diện chuẩn xác cả những phòng có khách cũ trả phòng buổi sáng và khách mới nhận phòng buổi chiều cùng ngày).

#### C. Hiển thị Kết quả Theo Từng Loại Phòng & Tạo Đặt Phòng Cho Các Phòng Được Chọn
1. **Đánh giá Đủ / Thiếu theo từng Loại phòng yêu cầu:**
   * **Đủ phòng (Badge Xanh lá — VD: *"Phòng Đôi Có Ban Công: Còn trống 5 phòng / Cần 3 phòng (Đủ phòng)"*):** Hiển thị danh sách 5 số phòng trống cụ thể thuộc loại phòng đó theo từng tầng (VD: `P.204 - Tầng 2`, `P.304 - Tầng 3`, `P.404 - Tầng 4`...) kèm trạng thái dọn phòng hiện tại (*Sạch* / *Chờ dọn*) và đơn giá gói mặc định của loại phòng.
   * **Thiếu phòng (Badge Cam — VD: *"Phòng Đôi Có Ban Công: Chỉ còn 2 phòng / Cần 3 phòng (Thiếu 1 phòng)"*):** Báo rõ số lượng còn trống thực tế của loại phòng đó và gợi ý các phòng trống thuộc loại phòng khác trong cùng khoảng ngày để lễ tân tư vấn bổ sung cho khách.
2. **Tích chọn phòng cụ thể & Tạo đặt phòng ngay:**
   * Mỗi phòng trống trong danh sách kết quả đều có **ô tích chọn (`checkbox`)**. Lễ tân tích chọn đúng các số phòng muốn giao cho khách (VD: tích chọn `P.204`, `P.304`, `P.404`).
   * Ngay phía dưới danh sách kết quả luôn hiển thị thanh thao tác nổi với nút **"Tạo đặt phòng cho [X] phòng đã chọn"**:
     * Nếu chỉ tích chọn **1 phòng**: Mở ngay Form **Tạo đặt phòng lẻ** với **Số phòng, Loại phòng, Ngày nhận phòng, Ngày trả phòng và Đơn giá** đã được điền sẵn tự động.
     * Nếu tích chọn **từ 2 phòng trở lên** (cùng loại hoặc khác loại): Mở ngay Form **Tạo đặt phòng khách đoàn / nhóm** với toàn bộ danh sách các phòng đã chọn (`P.204`, `P.304`, `P.404`), khoảng ngày lưu trú và bảng giá từng phòng đã được gán sẵn — lễ tân chỉ cần nhập tên khách/trưởng đoàn, SĐT và tiền cọc (nếu có) là hoàn tất.

### 3.3. Lịch Đặt Phòng Trực Quan Dạng Calendar Liên Tục (Continuous Timeline Grid / Tape Chart)

Để lễ tân nhìn bao quát toàn bộ tình trạng phòng trống/kín qua nhiều tuần, nhiều tháng liền mạch mà không bị ngắt quãng giữa các tháng, hệ thống cung cấp giao diện **Lịch Đặt Phòng Dạng Lưới Thời Gian Liên Tục (Continuous Timeline Calendar)** song song với Sơ đồ phòng hiện tại:

#### A. Bố cục Ma trận Lưới 2 Chiều & Cuộn Liên Tục (Infinite Horizontal Scroll)
* **Trục dọc (Cột bên trái cố định — Sticky Room Column):** Liệt kê toàn bộ danh sách phòng được nhóm gọn gàng theo **Tầng** (Tầng 1, Tầng 2...) và hiển thị rõ **Số phòng + Loại phòng + Trạng thái dọn phòng hiện tại** (Sạch / Chờ dọn / Bảo trì). Cột này luôn ghim cố định bên trái khi cuộn ngang.
* **Trục ngang (Dòng thời gian liên tục vô tận — Continuous Date Axis):** Hiển thị danh sách các ngày liên tiếp nối đuôi nhau không bị ngắt trang khi chuyển giao giữa cuối tháng này sang đầu tháng sau (VD: `28/11` $\rightarrow$ `29/11` $\rightarrow$ `30/11` $\rightarrow$ `01/12` $\rightarrow$ `02/12`...).
  * Hỗ trợ **cuộn ngang mượt mà (Infinite Scroll)** bằng con lăn chuột, kéo thanh trượt hoặc vuốt cảm ứng để xem liền mạch hàng chục ngày trước đó (lịch sử đã qua) và hàng tháng tiếp theo (tương lai) mà không cần tải lại trang.
  * **Tự động tải dữ liệu nối tiếp (Dynamic Window Fetching):** Khi người dùng cuộn gần tới mép trái (quá khứ) hoặc mép phải (tương lai) của khung thời gian đang tải, hệ thống tự động nạp nối tiếp các đơn đặt phòng của 30 ngày kế cận vào bộ nhớ đệm.
* **Thanh điều hướng Thời gian nhanh (Quick Date Navigation):**
  * Nút **"Hôm nay" (Today):** Đưa khung nhìn nhảy ngay về cột ngày hiện tại (cột ngày hôm nay luôn được tô nổi bật bằng đường kẻ dọc màu xanh/đỏ xuyên suốt bảng).
  * Nút **Lùi / Tiến nhanh:** `< 1 Tuần`, `< 1 Ngày`, `1 Ngày >`, `1 Tuần >` và **Bộ chọn ngày (Date Picker)** để nhảy tức thì đến bất kỳ mốc ngày nào trong quá khứ hoặc tương lai.
  * **Chế độ thu phóng khung nhìn (Zoom Levels):** Chuyển đổi nhanh giữa chế độ xem **14 ngày** (chi tiết, chữ to dễ đọc), **30 ngày** (bao quát cả tháng), hoặc **60 ngày** (nhìn tổng quan mùa cao điểm / khách dài hạn).

#### B. Hiển thị Thanh Đặt Phòng (Booking Bars) & Thao tác Trực tiếp trên Lịch
* **Thanh hiển thị trực quan theo trạng thái & nguồn đặt:** Mỗi đơn đặt phòng hiển thị thành một thanh ngang kéo dài chính xác từ ô ngày Check-in (nửa chiều rộng ô ngày đến) sang ô ngày Check-out (nửa chiều rộng ô ngày đi) giúp nhìn thấy ngay các phòng trống giao ca trong ngày:
  * **Màu Xanh dương:** Đặt trước (`reserved`) — chưa nhận phòng.
  * **Màu Xanh lá:** Đang lưu trú (`in_house`).
  * **Màu Xám nhạt:** Đã trả phòng (`checked_out` — lịch sử ngày trước).
  * **Màu Cam / Tím:** Đặt qua kênh OTA (kèm biểu tượng nhỏ Booking.com, Agoda, Airbnb...).
  * **Màu Vàng / Khóa chéo:** Phòng đang bảo trì / khóa phòng (`blocked`).
  * Trên mỗi thanh hiển thị: **Tên khách + Số đêm + Biểu tượng cảnh báo** (nếu chưa thanh toán đủ, chưa khai báo ASM, hoặc có ghi chú đặc biệt).
* **Thao tác tương tác trực tiếp ngay trên lưới Calendar:**
  * **Bấm chọn / Kéo chọn ô trống:** Bấm vào 1 ô ngày trống (hoặc bấm giữ và kéo chuột qua nhiều ngày trống liên tiếp trên một dòng phòng) để mở ngay cửa sổ **Tạo đặt phòng mới** với Số phòng, Ngày nhận phòng và Ngày trả phòng đã được điền sẵn.
  * **Kéo thả đổi phòng / dời ngày (Drag & Drop):** Cho phép kéo thanh đặt phòng sang dòng phòng khác (đổi phòng) hoặc kéo giãn mép phải thanh đặt phòng để gia hạn thêm đêm (hệ thống tự động kiểm tra trùng lịch và mở hộp thoại xác nhận áp giá).
  * **Bấm vào thanh đặt phòng:** Mở nhanh bảng thông tin chi tiết đơn để Check-in, Check-out, sửa giá, thêm dịch vụ hoặc thanh toán ngay tại chỗ.
  * **Dòng tổng hợp trên cùng (Summary Header Row):** Hiển thị ngay dưới mỗi cột ngày: **Tổng số phòng còn trống** và **Tỷ lệ lấp đầy (%)** của ngày đó để lễ tân báo khách ngay lập tức khi có người gọi điện hỏi phòng.

### 3.4. Quản lý Đa Khách Lưu Trú, AI OCR 3 Loại Ảnh Giấy Tờ & Kiểm Soát Tạm Trú ASM

#### A. Quản lý Đa Khách Lưu Trú trong 1 Phòng (`occupants`)
* Khi làm thủ tục Check-in (hoặc bổ sung người ở ghép sau khi đã nhận phòng), màn hình chi tiết phòng cho phép bấm **"+ Thêm khách lưu trú"** không giới hạn số lượng người trong phòng.
* Phân định rõ **Khách đại diện chính (`isPrimary = true`)** (người đứng tên hóa đơn/thanh toán) và các **Khách ở cùng (`isPrimary = false`)**. Toàn bộ thành viên ở cùng đều được lưu thành hồ sơ độc lập trong Kho Khách hàng (`guests`) để nhận diện khi quay lại lần sau.

#### B. Chụp ảnh & AI OCR Trích xuất Thông tin Chuẩn (Chỉ lấy đúng các trường cần thiết)
Khi lễ tân chụp trực tiếp từ Webcam/Camera hoặc tải ảnh giấy tờ tùy thân lên, hệ thống tự động nén ảnh (~250KB) lưu lên Firebase Cloud Storage, đồng thời gọi **AI OCR** trích xuất và điền tự động đúng các trường thông tin quy định:
1. **Đối với Khách Việt Nam — Căn cước công dân (2 ô ảnh: Mặt trước & Mặt sau CCCD):**
   * **Số CCCD** (`idNumber`)
   * **Họ và tên** (`fullName`)
   * **Giới tính** (`gender`)
   * **Thường trú** (`address`)
   * **Ngày cấp** (`idIssueDate`)
   * **Số điện thoại** (`phone` — tự động đối chiếu/điền nếu khách đã có trong hệ thống hoặc lễ tân nhập bổ sung)
2. **Đối với Khách Nước Ngoài — Chụp đủ 3 ô ảnh: (1) Hộ chiếu, (2) Thị thực / e-Visa, và (3) Trang có Dấu mộc nhập cảnh (Entry Stamp):**
   * **Mã số Visa / Số Hộ chiếu** (`visaNumber` / `passportNumber`)
   * **Họ và tên** (`fullName`)
   * **Ngày tháng năm sinh** (`dob`)
   * **Giới tính** (`gender`)
   * **Quốc tịch** (`nationality`)
   * **Ngày nhập cảnh** (`entryDate`)
   * **Thời hạn được phép lưu trú tại Việt Nam** (`stayPermitExpiryDate` — **Quy tắc ưu tiên:** AI OCR đối chiếu cả ảnh Visa lẫn ảnh Dấu mộc nhập cảnh đóng tại cửa khẩu và **luôn ưu tiên lấy ngày hết hạn trên Dấu nhập cảnh** làm mốc chuẩn để tránh rủi ro khách bị quá hạn lưu trú).

#### C. Cảnh báo Thời hạn Lưu trú Khách Nước Ngoài & Đánh dấu Khai báo ASM
1. **Kiểm tra & Cảnh báo tự động Thời hạn lưu trú:**
   * Hệ thống tự động đối chiếu **Thời hạn được phép lưu trú tại Việt Nam (`stayPermitExpiryDate`)** với **Ngày dự kiến trả phòng (`checkOut`)** và **Ngày hiện tại**:
     * *Cảnh báo ngay lúc Check-in:* Nếu `stayPermitExpiryDate < checkOut`, hệ thống bật cảnh báo đỏ ngay trên form Check-in (*"Lưu ý: Hạn lưu trú trên dấu nhập cảnh của khách hết hạn trước ngày dự kiến trả phòng"*).
     * *Cảnh báo trong quá trình lưu trú:* Nếu khách đang ở (`in_house`, chưa Check-out) và sắp đến hạn lưu trú (còn $\le 2$ ngày hoặc quá hạn), hệ thống bật **Cảnh báo đỏ nhấp nháy** ngay trên thẻ phòng ở Sơ đồ phòng, trên thanh Calendar và danh sách cảnh báo trên Dashboard để lễ tân nhắc khách gia hạn hoặc làm thủ tục trả phòng đúng hạn.
2. **Mục đánh dấu & Theo dõi Khai báo Tạm trú trên trang ASM của Xuất nhập cảnh:**
   * Trên hồ sơ của từng khách nước ngoài trong phòng có mục trạng thái **"Khai báo tạm trú ASM (Xuất nhập cảnh)"** gồm 2 trạng thái rõ ràng:
     * **`Yêu cầu đăng ký tạm trú ASM` (Mặc định khi Check-in khách nước ngoài — Badge màu Cam nổi bật):** Nhắc nhở lễ tân cần khai báo trên trang ASM của Cục Quản lý Xuất nhập cảnh.
     * **`Đã khai báo ASM` (Badge màu Xanh lá):** Sau khi lễ tân khai báo xong trên cổng ASM, bấm nút **"Đánh dấu đã khai báo ASM"** (tự động lưu thời gian và tên nhân viên thực hiện).
   * Có bộ lọc nhanh **"Khách nước ngoài chưa khai báo ASM"** và nút **Xuất file dữ liệu chuẩn** giúp lễ tân copy/nhập liệu lên trang ASM nhanh chóng, không bao giờ bỏ sót.

#### D. Cơ chế Xóa Ảnh Cũ Thủ Công (Chỉ dành riêng cho User Admin)
* **Không tự động xóa ngầm:** Toàn bộ ảnh chụp CCCD (2 mặt), Hộ chiếu, Visa và Dấu nhập cảnh được lưu trữ an toàn trên Firebase Cloud Storage.
* **Nút "Dọn dẹp ảnh giấy tờ cũ" (Chỉ hiển thị cho tài khoản `owner` / `admin`):**
  * Trong mục **Quản trị Dữ liệu / Cài đặt Bảo mật** trên Web App, chỉ Admin mới thấy nút **"Dọn dẹp ảnh CCCD / Hộ chiếu cũ"**.
  * Admin chọn mốc thời gian muốn dọn (VD: *Xóa toàn bộ ảnh giấy tờ của các đơn đã Check-out trước ngày DD/MM/YYYY* hoặc *cũ hơn 30 / 60 / 90 ngày*), hệ thống hiển thị số lượng file ảnh và dung lượng sẽ giải phóng để Admin xác nhận xóa thủ công. Việc xóa chỉ xóa file hình ảnh trên Cloud Storage, **vẫn giữ nguyên toàn bộ thông tin chữ** trong hồ sơ khách hàng (`guests`) và lịch sử lưu trú (`bookings`).

### 3.5. Hệ thống Biểu mẫu Giao dịch & Trình Tùy Chỉnh Linh Hoạt (Chỉ trên Web App)
* **Bộ 3 Biểu mẫu chuẩn gửi khách hàng:**
  1. **Phiếu Xác nhận Đặt phòng (Booking Confirmation)**
  2. **Phiếu Xác nhận Thanh toán / Phiếu Thu & Hóa đơn (Payment Receipt / Folio)**
  3. **Phiếu Đăng ký Nhận phòng (Registration Card)**
* **Giải pháp Tùy chỉnh Biểu mẫu Linh hoạt (Chỉ khả dụng trên Web App):**
  * Chỉ mở tính năng chỉnh sửa trên giao diện Web App (ẩn trên Mobile App để tránh thao tác nhầm).
  * Cho phép Admin tích bật/tắt linh hoạt từng trường dữ liệu (ẩn/hiện đơn giá từng đêm, số CCCD/Visa, danh sách khách ở cùng, tên nhân viên, mã VietQR, khung chữ ký, hoa hồng OTA...), thay đổi Logo, Hotline, nội quy nhận/trả phòng, thêm trường thông tin tự định nghĩa và xem trước trực tiếp (Live Preview) theo thời gian thực với hỗ trợ song ngữ Việt – Anh.

### 3.6. Cơ chế Hoàn tác Toàn diện (Universal Undo & Rollback) chống sai sót
* **Thanh thông báo Hoàn tác tức thì (15 giây)** sau mỗi thao tác và **Nút "Hoàn tác thao tác" trong Lịch sử Đơn đặt phòng** cho mọi nghiệp vụ: *Hoàn tác Nhận phòng (Undo Check-in)*, *Hoàn tác Trả phòng (Undo Check-out)*, *Hoàn tác Đổi/Ghép phòng*, *Hoàn tác Hủy đơn*, và *Hoàn tác Phiếu Thu – Chi*.
* Mọi thao tác hoàn tác đều khôi phục nguyên trạng dữ liệu trước đó, yêu cầu nhập **Lý do hoàn tác** và ghi vết vĩnh viễn vào `audit_logs` để chống gian lận.

### 3.7. Quản lý Nhân viên & Phân quyền Chi tiết
* Quản lý hồ sơ nhân viên (người nhà & nhân viên thuê ngoài), **khóa/mở khóa tài khoản 1 chạm**, phân quyền chi tiết từng chức năng (ẩn lợi nhuận/hoa hồng OTA với nhân viên thuê ngoài, khóa cứng quyền dọn ảnh cũ & sao lưu dữ liệu chỉ dành cho Admin), quản lý **Sổ Bàn Giao Tiền Mặt Cuối Ca** và nhật ký hoạt động theo từng nhân viên.

### 3.8. Các Nghiệp vụ Lễ tân & Vận hành Chuyên sâu Khác
1. **Trả phòng Sớm (Early Check-out) & Phụ thu Nhận sớm / Trả muộn (Hourly Surcharge):**
   * **Chốt trả phòng sớm:** Khi khách đặt dài ngày nhưng báo trả phòng sớm hơn dự kiến, lễ tân bấm **"Chốt trả phòng sớm"** để cắt ngắn số đêm còn lại (tự động giải phóng phòng trống trên Sơ đồ phòng, Tìm phòng trống & Lịch Calendar cho khách mới đặt), giữ nguyên tiền các đêm đã ở và tính toán số tiền hoàn lại nếu khách đã thanh toán trước.
   * **Phụ thu giờ:** Cho phép thêm nhanh khoản phụ thu *Nhận phòng sớm (Early Check-in)* hoặc *Trả phòng muộn (Late Check-out)* theo số giờ hoặc theo % giá phòng ngay trên phiếu thanh toán.
2. **Nhật ký Bảo trì Thiết bị & Tài sản Từng Phòng (Room Maintenance Log):**
   * Mỗi phòng có tab **Lịch sử Bảo trì & Thiết bị** để ghi nhận các lần sửa chữa, vệ sinh điều hòa, thay khóa từ, sửa ống nước... kèm ngày thực hiện, người phụ trách và chi phí sửa chữa (tự động liên kết sang **Sổ Chi Phí** để theo dõi hiệu quả vận hành từng phòng).
3. **Chuyển phòng khác hạng / khác giá (Split-Stay):**
   * Xử lý theo cơ chế **Chuỗi chặng lưu trú (`bookingChainId`)**: chốt doanh thu chặng cũ (chuyển phòng cũ sang `dirty`), chuyển danh sách khách `occupants` & trạng thái ASM sang phòng mới với 3 tùy chọn giá (*Giá phòng mới*, *Giữ giá phòng cũ*, *Giá thỏa thuận*), và gộp chung lên 1 hóa đơn duy nhất khi Check-out.
4. **Ghép phòng & Gộp hóa đơn (Room & Bill Merge):**
   * Hỗ trợ gộp nhiều phòng đặt rời vào chung 1 nhóm thanh toán (`groupId`) hoặc dồn khách từ 2 phòng về ở chung 1 phòng (chốt tiền và kết chuyển công nợ phòng trả bớt sang phòng giữ lại).
5. **Đặt phòng, Phân bổ & Check-in Khách đoàn (Group Booking):**
   * Tạo đoàn nhanh chỉ cần thông tin Trưởng đoàn (có cọc hoặc không cọc), hỗ trợ các phòng trong đoàn có ngày đến/đi lệch nhau, phân bổ phòng nhanh và Check-in hàng loạt 1 chạm.
6. **Quản lý Đơn đặt phòng Tập trung & Đối chiếu Khách hàng Quay lại 3 Lớp:**
   * Tìm kiếm tức thì 1 ô không dấu/có dấu (theo tên khách chính/khách ở cùng, SĐT, CCCD/Visa/Passport, mã đơn, số phòng); tự động nhận diện khách quen qua SĐT/CCCD/Họ tên, tự động điền thông tin và hiển thị lịch sử lưu trú cũ.
7. **Xử lý Đặt phòng OTA & Đối soát Tiền về 1 Lượt (OTA Collect & Payout Batch):**
   * Tách bạch **Giá bán Gross**, **Hoa hồng OTA (%)**, và **Tiền thực nhận Net**; đưa tiền phòng OTA vào **Sổ Công Nợ Phải Thu OTA (`unsettled`)** và hỗ trợ gạch nợ hàng loạt theo từng đợt chuyển khoản sao kê của OTA.
8. **Hệ thống Báo cáo Tài chính, Doanh thu, Chi phí & Lọc Đa Chiều + Sao Lưu Dữ Liệu 1 Chạm (1-Click Full Backup):**
   * Báo cáo Lãi/Lỗ thực tế (P&L), Sổ quỹ Thu – Chi, Công nợ OTA & Khách đoàn, Chỉ số hiệu suất (**Occupancy %**, **ADR**, **RevPAR**) với bộ lọc đa chiều toàn diện.
   * **Nút "Sao lưu toàn bộ dữ liệu" (Chỉ dành cho Admin):** Xuất toàn bộ dữ liệu phòng, đặt phòng, hồ sơ khách, thu chi và lịch sử thao tác thành file Excel nhiều sheet (`.xlsx`) hoặc JSON tải về máy tính / lưu lên Google Drive để đảm bảo an toàn dữ liệu tuyệt đối.

---

## 4. Thiết Kế Cơ Sở Dữ Liệu Firestore & Storage (100% Firebase)

### 4.1. Cấu trúc Cloud Firestore Collections

| Collection Name | Mô tả | Cấu trúc Document & Các trường dữ liệu chính |
| :--- | :--- | :--- |
| `hotel_config` | Cấu hình chung khách sạn | Document `main`: `hotelName`, `address`, `phone`, `floors` (mảng danh sách tầng: `["Tầng 1", "Tầng 2"...]`), `wifiByFloor` (map mật khẩu Wi-Fi theo tầng), `bankAccount` (tạo VietQR), `otaChannels`, `expenseCategories`. |
| `form_templates` | Mẫu biểu mẫu tùy chỉnh động (Chỉnh sửa trên Web App) | Document `booking_confirmation`, `payment_receipt`, `registration_card`: `logoUrl`, `headerTitle`, `visibleFields`, `customFields`, `footerPolicyVi`, `footerPolicyEn`, `updatedAt`, `updatedBy`. |
| `staff_users` | Nhân viên, thành viên gia đình & phân quyền | `uid`, `fullName`, `phone`, `email`, `role` (`owner` / `manager` / `receptionist` / `housekeeping`), `permissions` (`canViewProfit`, `canEditPrice`, `canUndoAction`, `canManageStaff`, `canCleanupPhotos`, `canFullBackup`...), `isActive`, `createdAt`. |
| `shift_handovers` | Sổ giao ca & kiểm quỹ nhân viên | `id`, `shiftDate`, `staffUid`, `staffName`, `startTime`, `endTime`, `openingCash`, `cashInTotal`, `cashOutTotal`, `expectedClosingCash`, `actualHandoverCash`, `note`. |
| `room_types` | Loại phòng & Đa mức giá | `id`, `name`, `maxAdults`, `maxChildren`, `priceTiers` (mảng các gói giá: `[{ id, tierName: "Giá ngày thường", price: 350000, isDefault: true }, { id, tierName: "Giá cuối tuần", price: 450000 }, { id, tierName: "Giá khách quen", price: 300000 }...]`). |
| `rooms` | Danh sách phòng theo Tầng & Loại phòng (< 30 phòng) | `id`, `roomNumber` ("201", "204"...), `floor` ("Tầng 2"), `roomTypeId`, `roomTypeName`, `hkStatus` (`clean` / `dirty` / `cleaning` / `maintenance`), `currentBookingId`, `note`. |
| `room_maintenances` | Nhật ký bảo trì & sửa chữa từng phòng | `id`, `roomId`, `roomNumber`, `issueTitle`, `description`, `cost`, `transactionId` (liên kết sang Sổ Chi Phí), `status` (`pending` / `completed`), `reportedAt`, `completedAt`, `performedBy`. |
| `guests` | Kho hồ sơ khách hàng (Lưu cả khách chính & khách ở cùng) | `id`, `guestCategory` (`vietnamese` / `foreigner`), `fullName`, `normalizedName`, `phone`, `gender`, `dob`, `nationality`, `idType` (`cccd` / `visa_passport`), `idNumber`, `idIssueDate`, `address`, `entryDate`, `stayPermitExpiryDate`, `idFrontImageUrl` (Mặt trước CCCD / Trang Hộ chiếu), `idBackImageUrl` (Mặt sau CCCD / Ảnh Visa), `entryStampImageUrl` (Ảnh Dấu nhập cảnh), `idPhotoUploadedAt`, `preferences`, `totalStays`, `totalSpent`, `lastVisitDate`. |
| `booking_groups` | Hồ sơ Khách đoàn / Nhóm ghép | `id`, `groupCode`, `groupName`, `leaderGuestId`, `leaderName`, `leaderPhone`, `depositAmount`, `billingMode` (`master` / `split`), `status`. |
| `bookings` | Đơn đặt phòng & Chặng lưu trú (Tối ưu truy vấn khoảng thời gian cho Tìm phòng trống & Calendar) | `id`, `bookingCode`, `bookingChainId`, `groupId`, `checkIn` (Timestamp — có index để truy vấn nhanh phòng trống & dải ngày Calendar), `checkOut` (Timestamp), `primaryGuestId`, `primaryGuestSnapshot`, `occupants` (Mảng danh sách tất cả khách ở trong phòng: `guestId`, `guestCategory`, `fullName`, `phone`, `gender`, `dob`, `nationality`, `idType`, `idNumber`, `idIssueDate`, `address`, `entryDate`, `stayPermitExpiryDate`, `asmStatus` [`pending_asm` / `declared_asm` / `not_applicable`], `asmDeclaredAt`, `asmDeclaredBy`, `idFrontImageUrl`, `idBackImageUrl`, `entryStampImageUrl`, `isPrimary`), `occupantCount`, `hasForeigner`, `hasPendingAsm`, `hasStayPermitAlert`, `isReturningGuest`, `source`, `otaChannel`, `otaBookingRef`, `roomId`, `roomNumber`, `floor`, `roomTypeId`, `selectedPriceTierId`, `dailyRates` (mảng giá chi tiết từng đêm: `[{ date, rate }]`), `nights`, `grossRoomTotal`, `otaCommissionAmount`, `netRoomTotal`, `serviceTotal`, `hourlySurcharge`, `depositPaid`, `guestPaid`, `otaSettlementStatus`, `payoutBatchId`, `status`, `lastActionSnapshot`. |
| `transactions` | Sổ nhật ký Thu – Chi chi tiết | `id`, `bookingId`, `groupId`, `payoutBatchId`, `roomMaintenanceId`, `type` (`room_charge` / `service` / `deposit` / `payment` / `refund` / `expense`), `category`, `amount`, `method`, `date`, `status` (`active` / `voided_by_undo`), `createdAt`, `createdByUid`, `createdByName`, `note`. |
| `ota_payout_batches` | Lô đối soát tiền OTA về 1 lượt | `id`, `batchCode`, `otaChannel`, `payoutDate`, `bookingIds`, `expectedNetTotal`, `actualReceivedAmount`, `bankFeeDiff`, `createdBy`. |
| `daily_summaries` | Sổ tổng hợp báo cáo theo ngày | Document ID `YYYY-MM-DD`: `totalGrossRevenue`, `totalOtaCommission`, `totalNetRevenue`, `totalCashIn`, `totalBankIn`, `totalExpense`, `occupiedRoomsCount`, `revenueByOta`, `revenueByRoomType`. |
| `audit_logs` | Nhật ký thao tác, Hoàn tác, Dọn ảnh & Sao lưu | `id`, `actionType` (`check_in`, `check_out`, `early_checkout`, `undo_action`, `declare_asm`, `cleanup_id_photos`, `full_backup`, `room_transfer`, `price_override`, `void_transaction`, `edit_form_template`...), `targetId`, `previousState`, `newState`, `reason`, `performedByUid`, `performedByName`, `timestamp`. |

### 4.2. Tổ chức Thư mục Firebase Cloud Storage
* `/guest_ids/{guestId}/{timestamp}_front.jpg` — Lưu ảnh mặt trước CCCD hoặc trang nhân thân Hộ chiếu (đã nén ~250KB).
* `/guest_ids/{guestId}/{timestamp}_back.jpg` — Lưu ảnh mặt sau CCCD hoặc ảnh Thị thực / e-Visa.
* `/guest_ids/{guestId}/{timestamp}_stamp.jpg` — Lưu ảnh trang có Dấu mộc nhập cảnh (Entry Stamp) của khách nước ngoài.
* `/hotel_assets/logo.png` — Logo khách sạn dùng cho các biểu mẫu in/gửi khách.
* `/expense_receipts/{YYYY-MM}/{transactionId}.jpg` — Ảnh chụp hóa đơn chi phí vận hành & bảo trì phòng.

---

## 5. Bảo Mật Dữ Liệu & Quy Tắc Firebase Security Rules

1. **Xác thực & Khóa tài khoản tức thì:** Mọi truy vấn đọc/ghi trên Firestore và Cloud Storage đều kiểm tra đồng thời `request.auth != null` và trạng thái `isActive == true` của nhân viên trong collection `staff_users`.
2. **Bảo mật Kho ảnh Giấy tờ & Quyền Xóa Thủ Công Admin:**
   * Thư mục `/guest_ids/` trên Firebase Storage chặn hoàn toàn truy cập công khai (`allow read, create: if isActiveStaff()`).
   * Quyền xóa file ảnh giấy tờ (`allow delete`) trên Firebase Storage chỉ cấp cho tài khoản có vai trò `owner` / `admin` (`isAdmin()`). Mọi lần Admin bấm nút dọn dẹp ảnh cũ đều được lưu vết số lượng ảnh đã xóa vào `audit_logs`.
3. **Bảo vệ tính năng thiết kế biểu mẫu, sao lưu & tài chính:**
   * Chỉ tài khoản Admin (`owner`) mới được phép ghi dữ liệu vào `form_templates` và thực hiện xuất bản sao lưu toàn bộ dữ liệu (`full_backup`).
   * Giao dịch tài chính (`transactions`) không bao giờ bị xóa cứng; khi thực hiện **Hoàn tác (Undo)**, giao dịch được đánh dấu `status = 'voided_by_undo'` và ghi rõ lý do vào `audit_logs`.

---

## 6. Lộ Trình Triển Khai 2 Giai Đoạn (Web App Trước — Mobile App Sau)

### Giai đoạn 1: Xây dựng & Hoàn thiện Web App (Tuần 1 – Tuần 6)
Mục tiêu: Đưa hệ thống Web App vào vận hành chính thức tại quầy lễ tân khách sạn, chạy ổn định toàn bộ nghiệp vụ.
* **Tuần 1 – 2: Nền tảng Firebase, Quản lý Nhân viên, Phòng theo Tầng/Loại phòng, Đa Bảng Giá, Tìm Phòng Trống & Lịch Calendar Liên Tục**
  * Khởi tạo dự án Firebase (Auth, Firestore, Storage, Hosting, Offline Persistence).
  * Xây dựng phân hệ **Quản lý Nhân viên & Phân quyền chi tiết**, **Cấu hình Phòng theo Tầng & Loại phòng**, **Hệ thống Đa mức giá theo Loại phòng**, **Bộ công cụ Tìm phòng trống theo loại phòng & số lượng phòng của loại phòng đó (từ ngày đến ngày) và tạo đặt phòng cho các phòng được chọn**, Sơ đồ phòng trực quan, **Lịch đặt phòng Timeline Calendar cuộn liên tục các ngày trước/sau** (hỗ trợ kéo chọn tạo đơn, kéo thả đổi phòng/gia hạn) và Cơ chế đối chiếu khách hàng quay lại 3 lớp.
* **Tuần 3 – 4: Nghiệp vụ Lễ tân Nâng cao, Điều chỉnh Giá thông minh, AI OCR 3 Ảnh & Cảnh báo ASM**
  * Xây dựng bộ công cụ **Điều chỉnh giá linh hoạt trên đơn đặt phòng** (chọn gói giá, sửa từng ngày, ô đổi tất cả các ngày, ô tổng tự chia đều cho các ngày).
  * Hoàn thiện luồng Check-in/Check-out đa khách (`occupants`), chụp/tải **3 loại ảnh giấy tờ (Hộ chiếu, Visa, Dấu nhập cảnh)** và tích hợp **AI OCR (Gemini Vision)** ưu tiên lấy hạn trên dấu nhập cảnh, **cảnh báo đỏ quá hạn lưu trú**, **đánh dấu khai báo ASM**, và **dọn dẹp ảnh giấy tờ cũ thủ công dành riêng cho Admin**.
  * Sinh mã VietQR động, xử lý **Chuyển phòng khác hạng giá**, **Ghép phòng**, **Khách đoàn lệch ngày**, **Trả phòng sớm / Phụ thu giờ**, **Nhật ký bảo trì phòng**, và **Cơ chế Hoàn tác (Undo)** toàn diện.
* **Tuần 5 – 6: Trình Tùy Chỉnh Biểu Mẫu (Web App), Tài chính OTA, Báo cáo Đa chiều & Sao lưu Dữ liệu**
  * Xây dựng bộ 3 biểu mẫu giao dịch và **Trình tùy chỉnh trường dữ liệu động trên Web App** xuất ảnh PNG/PDF.
  * Xây dựng phân hệ **Công nợ OTA & Đối soát chuyển khoản theo lô**, **Sổ quỹ & Bàn giao ca**, **Báo cáo Lãi/Lỗ (P&L) với Bộ lọc đa chiều**, **Nút Sao lưu toàn bộ dữ liệu 1 chạm (1-Click Full Backup)** ra Excel/JSON cho Admin, và đồng bộ lịch iCal OTA.
  * Tối ưu giao diện Responsive/PWA trên Web App để chủ khách sạn và buồng phòng dùng tạm trên trình duyệt điện thoại trong thời gian đầu.

### Giai đoạn 2: Xây dựng & Đóng gói App cho Điện Thoại (Tuần 7 – Tuần 8)
Mục tiêu: Sau khi Web App đã chạy trơn tru và chốt hết các tinh chỉnh thực tế, đóng gói thành ứng dụng di động chuyên biệt.
* **Tuần 7: Đóng gói Mobile App (Android APK / iOS) & Tích hợp Camera điện thoại**
  * Sử dụng Capacitor đóng gói mã nguồn Web App thành ứng dụng di động độc lập (tự động ẩn các module chỉ dành cho máy tính như Trình chỉnh sửa Form Template và Nút dọn dẹp ảnh cũ/sao lưu dữ liệu của Admin nếu cần giới hạn trên app nhân viên).
  * Tích hợp **Camera điện thoại chụp ảnh & chạy AI OCR CCCD/Hộ chiếu/Visa/Dấu nhập cảnh** trực tiếp tại quầy hoặc cửa phòng.
* **Tuần 8: Thông báo đẩy (Push Notification) & Tối ưu Trải nghiệm Di động**
  * Tích hợp Firebase Cloud Messaging (FCM) gửi thông báo đẩy tức thì về điện thoại khi có đặt phòng mới, **cảnh báo khách nước ngoài sắp hết hạn lưu trú / chưa khai báo ASM**, khách Check-in/Check-out, hoặc phòng chuyển sang trạng thái *Chờ dọn*.