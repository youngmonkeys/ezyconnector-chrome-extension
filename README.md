# EzyConnector

Chrome extension (Manifest V3) kết nối EzyPlatform với trình duyệt thông qua WebSocket và
thực thi workflow JSON bằng các command tổng quát.

## Kiến trúc

- `src/background/index.ts` — service worker: khởi tạo/duy trì kết nối WebSocket và gửi kết quả ngược lại server.
- `src/background/websocket-client.ts` — client WebSocket có tự động reconnect (exponential backoff).
- `src/background/dispatcher.ts` — tiếp nhận tác vụ `workflow.execute`.
- `src/background/workflow.ts` — command registry và workflow executor.
- `src/popup/` — popup cấu hình WebSocket URL + token, hiển thị trạng thái kết nối.

## Giao thức message

Server gửi xuống workflow; selector và logic riêng của từng hệ thống nằm ở backend:

```json
{
  "id": "req-1",
  "type": "workflow.execute",
  "payload": {
    "version": 1,
    "commands": [
      { "name": "tab.ensure", "args": { "url": "https://example.com", "urlPattern": "https://example.com/*" }, "saveAs": "page" },
      { "name": "dom.fill", "args": { "tabId": "${page.id}", "selector": "textarea", "value": "Xin chào" } },
      { "name": "dom.keypress", "args": { "tabId": "${page.id}", "selector": "textarea", "key": "Enter" } }
    ]
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

Các command hiện có: `tab.ensure`, `tab.create`, `tab.update`, `tab.reload`, `tab.remove`,
`dom.wait`, `dom.click`, `dom.fill`, `dom.keypress`, `dom.uploadRemoteFiles` và `delay`.
Kết quả có thể lưu bằng `saveAs` rồi tham chiếu ở command sau theo cú pháp `${name.field}`.
Command `delay` nhận một `durationMs` cố định hoặc khoảng `minDurationMs`/`maxDurationMs`.
Nên truyền `tabId` để timer chạy trong tab, tránh timer service worker bị Chrome trì hoãn.
`dom.fill` hỗ trợ khoảng delay trước khi gõ và giữa từng ký tự.

Mỗi workflow và command được ghi log với prefix `[EzyConnector][Workflow]`, bao gồm request ID,
step index, thời gian bắt đầu, duration thực tế và delay được chọn. Log không chứa nội dung tin
nhắn hay URL file. Xem log tại service worker của extension trong `chrome://extensions`.

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
