# EzyConnector

Chrome extension (Manifest V3) kết nối EzyPlatform với Zalo OA thông qua WebSocket. Extension
nhận dữ liệu thông báo và thực hiện duy nhất tác vụ gửi tin nhắn hoặc hình ảnh trên Zalo OA.

## Kiến trúc

- `src/background/index.ts` — service worker: khởi tạo/duy trì kết nối WebSocket và gửi kết quả ngược lại server.
- `src/background/websocket-client.ts` — client WebSocket có tự động reconnect (exponential backoff).
- `src/background/dispatcher.ts` — chỉ chấp nhận tác vụ cố định `zaloOa.sendMessage`.
- `src/background/handlers/notification.ts` — triển khai luồng gửi thông báo cố định trên `oa.zalo.me`.
- `src/popup/` — popup cấu hình WebSocket URL + token, hiển thị trạng thái kết nối.

## Giao thức message

Server gửi xuống dữ liệu cho tác vụ cố định:

```json
{
  "id": "req-1",
  "type": "zaloOa.sendMessage",
  "payload": {
    "zaloOaUserId": "123",
    "message": "Xin chào",
    "imageUrls": ["https://cdn.example.com/images/example.jpg"]
  }
}
```

Extension trả về:

```json
{ "id": "req-1", "ok": true, "data": { "sent": true } }
```

hoặc khi lỗi:

```json
{ "id": "req-1", "ok": false, "error": "message lỗi" }
```

Các selector, thứ tự thao tác và logic gửi Zalo OA đều nằm trong package extension. Server không
thể gửi selector, URL đích, HTTP request hoặc workflow tùy ý. URL ảnh phải dùng HTTPS và thuộc
Admin URL hoặc danh sách origin ảnh mà người dùng nhập và chủ động cấp quyền khi đăng nhập.

## Cài đặt & build

```bash
npm install
npm run build      # build một lần, output vào dist/
npm run watch       # build lại mỗi khi sửa code
```

## Đóng gói để phát hành

1. Đồng bộ version trong `manifest.json`, `package.json` và `package-lock.json`.
2. Build extension:

   ```bash
   npm run build
   ```

3. Nén **nội dung bên trong** thư mục `dist/` (không nén cả thư mục `dist`) để
   `manifest.json` nằm ngay tại thư mục gốc của file ZIP:

   ```bash
   mkdir -p release
   cd dist
   zip -r ../release/ezy-connector-0.0.1.zip . -x '*.map'
   cd ..
   ```

4. Tải file `release/ezy-connector-0.0.1.zip` lên Chrome Web Store. Thư mục
   `release/` đã được Git bỏ qua. Khi phát hành phiên bản mới, thay `0.0.1` trong
   tên file bằng version tương ứng.

## Load vào Chrome

1. `npm run build`.
2. Mở `chrome://extensions`, bật "Developer mode".
3. "Load unpacked" → chọn thư mục `dist/`.
4. Mở popup, nhập WebSocket URL (ví dụ `wss://your-ezyplatform-host/ws`) và token, bấm "Lưu & Kết nối".
