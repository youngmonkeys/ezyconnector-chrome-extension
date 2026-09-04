# EzyConnector

Chrome extension (Manifest V3) kết nối tới hệ thống sử dụng EzyPlatform thông qua WebSocket,
nhận các yêu cầu (request) từ server và thực thi trực tiếp trên trình duyệt.

## Kiến trúc

- `src/background/index.ts` — service worker: khởi tạo/duy trì kết nối WebSocket, dispatch request đến handler tương ứng, gửi response ngược lại server.
- `src/background/websocket-client.ts` — client WebSocket có tự động reconnect (exponential backoff).
- `src/background/dispatcher.ts` — định tuyến request theo `type` tới handler xử lý.
- `src/background/handlers/dom-automation.ts` — các action `dom.*` (đọc HTML/text, click, điền form) chạy trên tab qua `chrome.scripting.executeScript`.
- `src/background/handlers/http-proxy.ts` — action `http.request`, thực hiện fetch thay server (dùng cookie/session của trình duyệt).
- `src/popup/` — popup cấu hình WebSocket URL + token, hiển thị trạng thái kết nối.

## Giao thức message

Server gửi xuống:

```json
{ "id": "req-1", "type": "dom.getText", "payload": { "selector": "#title" } }
```

Extension trả về:

```json
{ "id": "req-1", "ok": true, "data": "Nội dung..." }
```

hoặc khi lỗi:

```json
{ "id": "req-1", "ok": false, "error": "message lỗi" }
```

### Các `type` hỗ trợ sẵn

- `dom.getHtml` — trả về `document.documentElement.outerHTML` của tab (mặc định tab đang active, hoặc truyền `tabId`).
- `dom.getText` — `payload.selector`, trả `textContent` của phần tử.
- `dom.click` — `payload.selector`, click vào phần tử.
- `dom.fill` — `payload.selector`, `payload.value`, điền giá trị vào input/textarea.
- `http.request` — `payload.url`, `payload.method`, `payload.headers`, `payload.body`.

Thêm action mới bằng cách bổ sung handler trong `src/background/handlers/` và route trong `dispatcher.ts`.

## Cài đặt & build

```bash
npm install
npm run build      # build một lần, output vào dist/
npm run watch       # build lại mỗi khi sửa code
```

## Load vào Chrome

1. `npm run build`.
2. Mở `chrome://extensions`, bật "Developer mode".
3. "Load unpacked" → chọn thư mục `dist/`.
4. Mở popup, nhập WebSocket URL (ví dụ `wss://your-ezyplatform-host/ws`) và token, bấm "Lưu & Kết nối".
