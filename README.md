# EzyConnector

Chrome extension (Manifest V3) kết nối EzyPlatform với trình duyệt thông qua WebSocket và
thực thi workflow JSON bằng các command tổng quát.

Xem chi tiết kiến trúc, giao thức message và danh sách command tại [FEATURES.md](FEATURES.md).

## Cài đặt (dùng ngay, không cần cài công cụ lập trình)

1. Vào trang [Releases](https://github.com/youngmonkeys/ezyconnector-chrome-extension/releases)
   và tải file `.zip` của bản mới nhất (ví dụ `ezy-connector-0.0.1.zip`).
2. Giải nén file `.zip` vừa tải ra một thư mục bất kỳ.
3. Mở `chrome://extensions`, bật "Developer mode" (góc trên bên phải).
4. Bấm "Load unpacked" → chọn thư mục vừa giải nén (thư mục chứa file `manifest.json`).
5. Mở popup của extension, nhập WebSocket URL (ví dụ `wss://your-ezyplatform-host/ws`) và
   token, bấm "Lưu & Kết nối".

Khi có bản mới, lặp lại các bước trên với file `.zip` mới để cập nhật.

## Build từ source (chỉ cần khi muốn tự sửa code)

```bash
npm install
npm run build      # build một lần, output vào dist/
npm run watch       # build lại mỗi khi sửa code
```

Sau khi build xong, làm theo các bước "Cài đặt" ở trên nhưng chọn thư mục `dist/` thay vì
thư mục giải nén từ Releases.

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

4. Tải file `release/ezy-connector-0.0.1.zip` lên Chrome Web Store và/hoặc đính kèm vào
   GitHub Releases. Thư mục `release/` đã được Git bỏ qua. Khi phát hành phiên bản mới, thay
   `0.0.1` trong tên file bằng version tương ứng.
