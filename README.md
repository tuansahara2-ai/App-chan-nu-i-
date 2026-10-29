# PigProfit AI — Full-stack farm management MVP

Version **1.8.0** · Vietnamese-language responsive web app / PWA · FastAPI backend · SQLite

PigProfit AI giúp ghi nhật ký chăn nuôi, quản lý nhiều trang trại/lứa nuôi, theo dõi cám theo giai đoạn và giá theo ngày hiệu lực, lần cân, biến động đàn, chi phí, bán heo, hồ sơ heo theo mã QR, FCR và lãi/lỗ quản trị.

> **Trạng thái phát hành:** bản full-stack MVP/pilot có thể triển khai trên một máy chủ. Đây chưa phải bản SaaS quy mô lớn đã hoàn tất kiểm toán bảo mật và kế toán. Trước khi thu phí đại trà cần cấu hình tên miền/HTTPS, sao lưu ngoài máy chủ, vận hành giám sát; nên bổ sung email xác minh/khôi phục mật khẩu, thanh toán thuê bao, và chuyển cơ sở dữ liệu sang PostgreSQL khi cần mở rộng nhiều instance.

## Tính năng chính

- Giao diện desktop dùng sidebar, giao diện điện thoại dùng điều hướng phù hợp màn hình nhỏ.

### Quản trị trang trại và lứa nuôi
- Workspace (công ty/hộ kinh doanh) có một hoặc nhiều trang trại; mỗi trang trại có nhiều lứa nuôi.
- Khai báo số heo đầu kỳ, khối lượng bình quân đầu vào, giá trị mua heo, ngày bắt đầu và giá heo hơi tham chiếu.
- Chuyển nhanh giữa trang trại/lứa; đánh dấu lứa đã kết thúc và mở lại khi cần.

### Nhật ký ngày và nhiều loại cám
- Ghi thức ăn tiêu thụ theo ngày; có thể chọn nhiều sản phẩm cám trong cùng ngày.
- Danh mục cám theo giai đoạn, tên sản phẩm, nhà cung cấp và lịch sử giá theo ngày hiệu lực.
- Mỗi dòng nhật ký lưu lại lượng kg và đơn giá đã áp dụng tại thời điểm ghi nhận; đổi bảng giá không tự hồi tố nhật ký cũ.
- Ghi heo chết, loại thải, bán, chuyển đi, nhập thêm, khối lượng và ghi chú. Phân loại đúng sự kiện để tránh tính sai số đầu đàn.

### Cân, QR và giao dịch
- Lưu lịch cân toàn đàn, cân mẫu hoặc ước tính, với ngày cân và ghi chú.
- Hồ sơ heo theo mã cá thể; tạo mã hàng loạt, in tem QR, quét bằng camera trên trình duyệt hỗ trợ hoặc nhập mã thủ công, cập nhật trạng thái và lịch sử cân.
- Sổ phiếu bán: ngày bán, số con, tổng kg, giá/kg, khách hàng, mã phiếu và ghi chú; doanh thu cập nhật vào báo cáo.
- Chi phí phát sinh có thể lọc theo khoảng ngày và loại chi phí.

### Báo cáo và kiểm soát số liệu
- Tổng quan lượng cám, chi phí cám, FCR gần nhất, sinh khối, giá trị đàn tồn, doanh thu và lãi/lỗ kinh tế ước tính.
- Báo cáo tổng kết lứa với bộ lọc từ ngày/đến ngày; KPI chi phí, doanh thu, kết quả giao dịch và lượng thức ăn cùng phạm vi ngày; cơ cấu chi phí, biểu đồ và bảng nhật ký được lọc đồng bộ. FCR và lãi/lỗ kinh tế tích lũy toàn lứa được hiển thị riêng để không trộn kết quả giao dịch trong kỳ với định giá tồn đàn.
- Xuất CSV riêng cho kỳ báo cáo đang lọc, ngoài chức năng xuất toàn bộ nhật ký.
- Xuất CSV cho nhật ký, doanh thu và hồ sơ heo; xuất/nhập bản sao lưu JSON; in báo cáo hoặc lưu PDF từ trình duyệt.
- Cảnh báo thiếu dữ liệu, giá cám thiếu, kỳ FCR không hợp lệ, trọng lượng quá cũ và sai lệch cân đối đàn.

### Tài khoản và đồng bộ
- Đăng ký workspace, đăng nhập/đăng xuất, đổi mật khẩu, đặt lại mật khẩu qua email bằng token một lần có thời hạn, phiên đăng nhập có thời hạn và mật khẩu được băm bằng PBKDF2.
- Vai trò: `owner`, `manager`, `editor`, `viewer`; máy chủ kiểm tra quyền ở API.
- Dữ liệu mỗi workspace được cách ly ở máy chủ; snapshot có số phiên bản để phát hiện hai thiết bị cùng ghi và tránh ghi đè âm thầm.
- Service worker chỉ cache app shell, không cache API/snapshot chứa dữ liệu riêng.

### Cấu hình email đặt lại mật khẩu

Sao chép các biến `PIGPROFIT_PUBLIC_URL`, `PIGPROFIT_SMTP_HOST`, `PIGPROFIT_SMTP_PORT`, `PIGPROFIT_SMTP_USER`, `PIGPROFIT_SMTP_PASSWORD`, `PIGPROFIT_SMTP_FROM`, `PIGPROFIT_SMTP_STARTTLS` và `PIGPROFIT_SMTP_SSL` vào môi trường triển khai. `PIGPROFIT_PUBLIC_URL` phải là URL HTTPS công khai đã trỏ về app; ví dụ `https://app.tenmiencuaban.vn`. Dùng mật khẩu ứng dụng hoặc credential SMTP dành riêng cho dịch vụ, không dùng mật khẩu hộp thư cá nhân. Khi chưa cấu hình SMTP, endpoint vẫn trả thông báo chung để tránh lộ tài khoản nhưng sẽ không tạo token reset không thể gửi.

## Chạy thử nhanh trên máy tính

Yêu cầu Python 3.12+ và Node.js 20+ (Node chỉ dùng để kiểm tra cú pháp JavaScript).

```bash
python -m venv .venv
# Windows PowerShell: .venv\Scripts\Activate.ps1
# macOS/Linux:
source .venv/bin/activate
pip install -r requirements.txt
uvicorn server:app --host 127.0.0.1 --port 8000
```

Mở `http://127.0.0.1:8000`. Lần đầu, chọn **Tạo workspace**, nhập email và mật khẩu tối thiểu 10 ký tự. Tệp SQLite được tạo trong `data/pigprofit.sqlite3` mặc định. Để dừng server nhấn `Ctrl+C`.

Không cần mở riêng `index.html` nếu muốn kiểm thử backend; mở bằng `file://` sẽ chạy chế độ cục bộ và không dùng API/đăng nhập cloud.

## Triển khai một máy chủ có tên miền và HTTPS

Dùng Docker Compose production kèm Caddy để tự lấy và gia hạn TLS certificate. Cần một VPS Linux có Docker Engine + Docker Compose plugin, một tên miền do bạn quản lý và bản ghi DNS `A`/`AAAA` trỏ đến IP máy chủ. Mở cổng TCP 80/443 và UDP 443 nếu muốn HTTP/3.

1. Tải gói mã nguồn và giải nén vào máy chủ; giữ các tệp `Dockerfile`, `docker-compose.prod.yml`, `Caddyfile`, `server.py`, `app.js`, `styles.css`, `index.html`, manifest và icon cùng thư mục.
2. Tạo tệp môi trường từ mẫu:

   ```bash
   cp .env.example .env
   ```

   Sửa `.env` và đặt `DOMAIN=app.tenmiencuaban.vn` bằng tên miền thật. Không tải `.env` lên GitHub hoặc gửi cho khách hàng.

3. Đảm bảo DNS tên miền trỏ tới VPS và không có dịch vụ khác chiếm cổng 80/443.
4. Từ thư mục dự án, chạy:

   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   docker compose -f docker-compose.prod.yml ps
   docker compose -f docker-compose.prod.yml logs -f pigprofit-ai caddy
   ```

5. Mở `https://app.tenmiencuaban.vn`, đăng ký workspace chủ đầu tiên, tạo trại/lứa thử và kiểm tra đăng nhập trên hai trình duyệt/thiết bị. Tài khoản chủ chỉ quản trị workspace của mình.
6. Kiểm tra `https://app.tenmiencuaban.vn/api/health`. Phản hồi bình thường có `ok: true`, `mode: fullstack`.

Không cần mở port 8000 ra Internet trong `docker-compose.prod.yml`; API nằm sau Caddy. Volume `pigprofit_data` giữ dữ liệu SQLite khi nâng cấp container. Caddy tự lưu chứng chỉ trong volume riêng.

## Sao lưu và khôi phục

Sao lưu SQLite khi ứng dụng đang chạy bằng công cụ dùng Online Backup API:

```bash
python scripts/backup_sqlite.py
```

Trong production, công cụ phải được chạy ở đúng thư mục triển khai và có Python/SQLite tương thích; nếu chạy trong container, hãy dùng lệnh tương tự:

```bash
docker compose -f docker-compose.prod.yml exec pigprofit-ai python /app/scripts/backup_sqlite.py --source /app/data/pigprofit.sqlite3 --output-dir /app/data/backups
```

Sau đó **sao chép file backup ra khỏi VPS** (ví dụ kho object storage riêng có quyền truy cập hạn chế). Bản sao lưu nằm trên cùng đĩa không bảo vệ được khi VPS/hệ thống lưu trữ hỏng hoặc bị xóa. Cần định kỳ thử phục hồi vào môi trường riêng; không thay database đang chạy bằng bản backup khi chưa dừng và chưa kiểm chứng.

Người dùng cuối vẫn có thể xuất JSON trong ứng dụng. JSON phù hợp di chuyển dữ liệu nghiệp vụ; backup SQLite là bản sao lưu cả tài khoản/session/audit của backend nên phải bảo vệ như dữ liệu nhạy cảm.

## Chạy kiểm thử trước khi phát hành

```bash
pip install -r requirements-dev.txt
./scripts/smoke_test.sh
```

Bộ kiểm tra hiện gồm cú pháp Python/JavaScript và API tests cho: sức khỏe API/security headers, đăng ký/đăng nhập, cách ly workspace, kiểm soát quyền, phạm vi trại, đổi/đặt lại mật khẩu, phiên đăng nhập bị thu hồi, phát hiện xung đột revision, kiểm tra snapshot, endpoint tạo QR và allowlist tệp tĩnh. Kiểm tra frontend xác nhận có bộ lọc ngày và xuất CSV kỳ báo cáo; cần kiểm thử trình duyệt thủ công trước khi mở bán. GitHub Actions chạy bộ test này khi push/PR.

## Quy ước tính toán — đọc trước khi dùng vào quyết định tài chính

- **Số heo còn:** số đầu lứa + nhập thêm − chết − loại thải − bán − chuyển ra. Heo bán nhập qua sổ phiếu thì không đồng thời nhập trùng số bán trong nhật ký ngày cùng ngày.
- **Sinh khối:** số heo còn × trọng lượng bình quân gần nhất. Màn hình phải coi đó là ước tính nếu dùng cân mẫu/ước tính, không phải khối lượng cân tổng.
- **FCR theo kỳ:** tổng thức ăn kỳ / tăng trọng ròng kỳ. Tăng trọng ròng cần tính sinh khối cuối + kg bán + kg chết/loại/chuyển ra − sinh khối đầu − kg nhập thêm. Nhật ký thức ăn trong kỳ và hai mốc cân phải đầy đủ; dữ liệu sự kiện thiếu kg có thể khiến kết quả là ước tính/cảnh báo.
- **Chi phí cám:** mỗi dòng cám là lượng tiêu thụ × giá đã lưu; giá bình quân là bình quân gia quyền, không phải trung bình đơn giản giữa các bao cám.
- **Lãi/lỗ kinh tế ước tính:** doanh thu bán + thu từ loại thải + giá trị đàn còn lại − vốn ban đầu/giá trị heo nhập − chi phí cám − chi phí khác − chi phí của heo nhập thêm. Đây là chỉ số quản trị, không thay thế sổ kế toán/thuế; sẽ sai nếu thiếu giá vốn hoặc chi phí.
- **Lãi/lỗ trên kg sinh khối còn:** lãi/lỗ lứa chia sinh khối heo hơi còn lại; không phải lợi nhuận riêng của một phiếu bán, cũng không phải giá thành/kg thịt xẻ.
- FCR và lãi/lỗ chỉ đáng tin ở mức độ mà số liệu gốc đáng tin. Cần đối chiếu song song với sổ trại trước khi quyết định tài chính quy mô lớn.

## Giới hạn của bản 1.8.0

- Backend hiện dùng **SQLite và snapshot JSON mỗi workspace**, phù hợp thử nghiệm/pilot trên một instance. Không chạy nhiều instance backend cùng database SQLite như thể là PostgreSQL. Khi tải tăng, dữ liệu cần query/analytics chi tiết hoặc cần mở rộng đa máy chủ, hãy chuyển sang PostgreSQL và các bảng nghiệp vụ chuẩn hóa.
- Chưa có email verification, cổng thanh toán thuê bao, tích hợp Zalo/SMS/push, nhập dữ liệu từ cân tự động hoặc báo giá heo tự động.
- Chưa có kiểm toán bảo mật độc lập hoặc cam kết SLA. Cần giám sát uptime/dung lượng, backup ngoài máy chủ, quy trình phản hồi sự cố và quy định lưu/xóa dữ liệu trước khi mở bán rộng.
- Rate limit đăng nhập hiện lưu trong bộ nhớ của một process; ở quy mô lớn cần chuyển sang kho dùng chung (ví dụ Redis) và thêm chống bot/monitoring.
- HTTPS camera QR yêu cầu người dùng cấp quyền camera; hỗ trợ quét tự động phụ thuộc trình duyệt. Có thể nhập mã tem thủ công nếu không hỗ trợ.

## Cấu trúc dự án

- `index.html`, `styles.css`, `app.js`: frontend responsive/PWA.
- `server.py`: FastAPI auth, snapshot, phân quyền, audit, QR và phục vụ allowlist tài nguyên tĩnh.
- `Dockerfile`, `docker-compose.yml`: chạy phát triển nội bộ.
- `docker-compose.prod.yml`, `Caddyfile`: triển khai VPS với HTTPS.
- `scripts/backup_sqlite.py`: backup database nhất quán.
- `tests/test_api.py`, `scripts/smoke_test.sh`: API/security smoke tests.
# pigprofit-ai
