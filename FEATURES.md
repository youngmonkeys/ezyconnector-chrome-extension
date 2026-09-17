# Tính năng

EzyConnector là Chrome extension (Manifest V3) kết nối EzyPlatform với trình duyệt thông qua
WebSocket và thực thi workflow JSON bằng các command tổng quát.

## Kiến trúc

- `src/background/index.ts` — service worker: khởi tạo/duy trì kết nối WebSocket và gửi kết quả ngược lại server.
- `src/background/websocket-client.ts` — client WebSocket có tự động reconnect (exponential backoff).
- `src/background/dispatcher.ts` — tiếp nhận tác vụ `workflow.execute`.
- `src/background/workflow.ts` — command registry và workflow executor.
- `src/popup/` — popup cấu hình WebSocket URL + token, hiển thị trạng thái kết nối.

## Keep-alive (chrome.alarms)

Service worker của Manifest V3 có thể bị Chrome unload khi idle, làm mất kết nối WebSocket.
Extension tạo một alarm `keep-alive` chạy mỗi 1 phút (`chrome.alarms.create`); mỗi lần alarm
bắn, nếu trạng thái kết nối đang là `disconnected` hoặc `error` thì gọi lại `start()` để thử
kết nối lại. Cơ chế này bổ sung cho auto-reconnect (exponential backoff) của
`websocket-client.ts`, đảm bảo kết nối được khôi phục ngay cả khi service worker vừa bị đánh thức
lại từ trạng thái unload.

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

## Logging

Mỗi workflow và command được ghi log với prefix `[EzyConnector][Workflow]`, bao gồm request ID,
step index, thời gian bắt đầu, duration thực tế và delay được chọn. Log không chứa nội dung tin
nhắn hay URL file. Xem log tại service worker của extension trong `chrome://extensions`.
