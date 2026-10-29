## 1.8.0 — Báo cáo theo kỳ và xuất giao dịch theo bộ lọc
- Bổ sung chọn ngày bắt đầu/kết thúc trên màn hình Báo cáo giống luồng trong thiết kế tham chiếu.
- Tổng hợp riêng thức ăn, chi phí, phiếu bán, thu từ heo loại và nhật ký phát sinh trong khoảng ngày được chọn.
- Thêm KPI chi phí kỳ, doanh thu bán kỳ, kết quả giao dịch kỳ và lượng thức ăn kỳ.
- Cơ cấu chi phí, biểu đồ so sánh và bảng nhật ký dùng cùng khoảng ngày; vẫn hiển thị riêng FCR và lãi/lỗ kinh tế tích lũy theo toàn lứa để tránh trộn kỳ giao dịch với giá trị đàn tồn.
- Thêm xuất CSV giao dịch theo khoảng ngày đang lọc, giữ nút xuất nhật ký toàn bộ để đối chiếu.
- Tăng cache PWA và đồng bộ phiên bản API/frontend/tài liệu.

## 1.7.1 — Kiểm tra và đóng gói pilot
- Chạy lại toàn bộ kiểm thử API/backend: 17 bài kiểm thử đạt.
- Kiểm tra cú pháp JavaScript và Python trước khi phát hành gói.
- Đóng gói lại source hiện hành, loại bỏ cache Python/pytest và dữ liệu SQLite cục bộ khỏi gói phát hành.
- Không thay đổi schema hoặc dữ liệu ứng dụng trong lần đóng gói này.

# PigProfit AI — lịch sử cập nhật

## 1.7.0 — Phục hồi mật khẩu và đóng gói phát hành
- Thêm luồng yêu cầu đặt lại mật khẩu qua email với thông báo không tiết lộ tài khoản tồn tại hay không.
- Token đặt lại được lưu dưới dạng SHA-256, có hạn 30 phút, chỉ dùng một lần; thành công sẽ thu hồi mọi phiên đăng nhập và ghi audit log.
- Thêm giao diện Quên mật khẩu / Đặt mật khẩu mới; token trong URL được ưu tiên trước phiên đã đăng nhập.
- Thêm cấu hình SMTP TLS và URL HTTPS công khai cho triển khai Docker; khi SMTP chưa cấu hình, không tạo token reset không thể gửi.
- Đồng bộ phiên bản ở API, frontend, service worker, tài liệu và smoke test.
- Bổ sung kiểm thử cho vòng đời reset, thu hồi phiên, token một lần và thông báo chống dò tài khoản.

## 1.5.1 — Gia cố luồng dữ liệu và phát hành
- Đảm bảo phiếu bán phát sinh từ QR không thể bị sửa ngày/số con/khối lượng làm lệch hồ sơ heo; sửa giá bán cập nhật cả hồ sơ liên kết.
- Giới hạn tạo tem ở 300 mã/lượt và mở giới hạn API QR tương ứng để giảm lỗi khi in tem hàng loạt.
- Bỏ khai báo `command` trùng trong Compose production; chỉ giữ một cấu hình Uvicorn tin cậy proxy nội bộ.
- Đồng bộ phiên bản frontend, health endpoint, service worker cache, tài liệu và bài kiểm thử.
- Chạy lại kiểm thử cú pháp và API sau sửa đổi.

## 1.5.0 — Hoàn thiện giao diện và kiểm soát luồng dữ liệu
- Chuyển giao diện desktop sang điều hướng sidebar, giữ điều hướng ngang thân thiện trên máy tính bảng/điện thoại.
- Cố định phiên bản frontend và tăng phiên bản cache app shell để tránh giữ tài nguyên cũ sau cập nhật PWA.
- Bảo vệ phiếu bán phát sinh từ hồ sơ QR khỏi bị sửa số con/khối lượng làm lệch giữa hồ sơ heo và sổ doanh thu; vẫn cho sửa thông tin thương mại phù hợp.
- Cập nhật health endpoint, footer, tài liệu release và kiểm thử theo phiên bản 1.5.0.
- Chạy smoke tests Python/JavaScript, API tests và kiểm thử giao diện trình duyệt cho đăng ký workspace, tạo lứa, danh mục cám, nhật ký, cân, chi phí, phiếu bán, QR, báo cáo và đồng bộ snapshot.


## 1.4.1 — Hoàn thiện giao diện và kiểm thử phát hành
- Bổ sung bộ lọc cảnh báo trên màn hình tổng quan: Tất cả, Cần chú ý và Thông tin.
- Bump cache app shell để điện thoại tải đúng frontend mới sau khi triển khai.
- Cấu hình production tin cậy proxy headers từ Caddy trong mạng Compose riêng để giới hạn đăng nhập theo IP khách truy cập.
- Siết danh sách file đưa vào Docker image, không chép dữ liệu người dùng, tests hoặc tệp hướng dẫn nội bộ vào runtime image.
- Giữ kiểm tra cú pháp frontend/backend và 14 API/security tests trong quy trình smoke test.

## 1.4.0 — Bản full-stack pilot
- Đưa vào cùng một app responsive/PWA các phần tổng quan, nhật ký, cân, chi phí, bán heo, báo cáo, quản lý cám đa giai đoạn và hồ sơ cá thể/QR.
- Sổ phiếu bán độc lập gồm ngày, số lượng, khối lượng, giá/kg, khách hàng, mã phiếu và ghi chú; nối vào cân đối đàn và báo cáo kinh tế.
- QR: tạo mã hàng loạt, in tem, quét camera khi trình duyệt hỗ trợ, tìm mã thủ công, cập nhật trạng thái và lịch sử cân.
- Chi phí có lọc ngày/loại; CSV riêng cho giao dịch bán và hồ sơ heo.
- Backend FastAPI với đăng ký/đăng nhập, phiên có thời hạn, vai trò workspace, snapshot revision để phát hiện xung đột, audit log, endpoint QR và cách ly dữ liệu theo workspace.
- Phục vụ tài nguyên frontend qua danh sách allowlist; không expose `server.py`, tests, database, `.env` hoặc README qua StaticFiles.
- Security headers, no-store cho API, service worker chỉ cache app shell, tránh cache dữ liệu tài khoản.
- Docker deployment, reverse proxy Caddy/HTTPS, healthcheck, script backup SQLite, API tests và CI GitHub Actions.
- Tăng chất lượng tài liệu triển khai, sao lưu/khôi phục và ghi rõ các giới hạn trước khi mở bán đại trà.

## 1.3.0 — Multi-tenant backend pilot
- Tài khoản workspace và thành viên; các vai trò owner/manager/editor/viewer.
- Lưu snapshot trên server theo tenant, optimistic revision và cảnh báo xung đột đồng bộ.
- Chống brute force cơ bản, security headers và chặn cache API.

## 1.1.0 — Cám theo giai đoạn
- Danh mục nhiều sản phẩm cám, giai đoạn sử dụng, hãng/nhà cung cấp.
- Lưu lịch sử đơn giá theo ngày hiệu lực cho từng sản phẩm.
- Nhật ký ngày có nhiều dòng cám; mỗi dòng lưu sản phẩm, giai đoạn, kg tiêu thụ và đơn giá.
- Chi phí, chỉ số FCR, báo cáo và CSV lấy chi tiết từng dòng cám; đổi giá sau này không hồi tố nhật ký cũ.

## 1.9.0 — Mobile app navigation refresh
- Reworked mobile navigation into a prominent fixed bottom tab bar with safe-area support for iPhone.
- Prioritized Dashboard, Daily Log, Weighing, Costs, and Reports; moved Sales, Pig QR Profiles, and Settings into a compact “More” menu.
- Kept the full navigation available on desktop layouts.
