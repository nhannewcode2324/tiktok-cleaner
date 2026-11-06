# TikTok Cleaner Pro — Smart Repost & Like Manager

<p align="center">
  <img src="public/icons/icon128.png" width="128" height="128" alt="TikTok Cleaner Pro Logo" style="border-radius: 24px; box-shadow: 0 8px 24px rgba(255, 79, 121, 0.4);" />
</p>

<p align="center">
  <b>Chrome Extension Manifest V3 — Tự động dọn dẹp Repost & Thả tim TikTok an toàn, nhanh chóng và thông minh.</b><br />
  <i>Unofficial automated assistant to bulk clean, review, and manage your TikTok Reposts & Likes with zero account ban risks.</i>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Chrome_Extension-Manifest_V3-blue?logo=googlechrome&logoColor=white" alt="Manifest V3" />
  <img src="https://img.shields.io/badge/Framework-React_18_%2B_TypeScript-61dafb?logo=react&logoColor=black" alt="React 18" />
  <img src="https://img.shields.io/badge/Vitest-57_Tests_Passed-green?logo=vitest&logoColor=white" alt="Tests" />
  <img src="https://img.shields.io/badge/License-MIT-purple" alt="License" />
</p>

---

## 📌 Mục lục / Table of Contents
- [🇻🇳 Tiếng Việt](#-tiếng-việt)
  - [Tính năng nổi bật](#1-tính-năng-nổi-bật)
  - [Hướng dẫn cài đặt](#2-hướng-dẫn-cài-đặt-chrome--edge)
  - [Hướng dẫn sử dụng](#3-hướng-dẫn-sử-dụng)
- [🇬🇧 English](#-english)
  - [Key Features](#1-key-features)
  - [Installation Guide](#2-installation-guide)
  - [How to Use](#3-how-to-use)
- [🛠 Dành cho lập trình viên / Development](#-dành-cho-lập-trình-viên--development)

---

# 🇻🇳 Tiếng Việt

## 1. Tính năng nổi bật

- ⚡ **Quét siêu tốc (Hybrid API + DOM)**: Quét hàng trăm video Reposts & Likes trong vài giây qua API nội bộ của phiên đăng nhập hiện tại; tự động chuyển sang DOM nếu cần.
- 🎯 **Thứ tự chuẩn (Mới nhất → Cũ nhất)**: Danh sách luôn được xếp theo đúng thứ tự hiển thị của TikTok từ mới nhất tới cũ nhất.
- 🛡️ **An toàn, cùng một tab**: Thực hiện bỏ Tim & gỡ Repost trực tiếp trên cùng một tab TikTok, không mở tab tràn lan, không gửi click dồn dập.
- ⏹️ **Dừng & Tạm dừng tức thì (0ms)**: Bấm **Dừng quét** hoặc **Dừng/Tạm dừng dọn dẹp** là hệ thống ngắt ngay lập tức, giữ nguyên các video đã làm, bấm **Tiếp tục** bất kỳ lúc nào.
- 🔍 **Không bỏ qua nhầm (Anti-Premature-Skip)**: Máy trạng thái quan sát DOM (`WAITING_FOR_VIDEO → WAITING_FOR_LIKE_BUTTON → CHECKING_LIKE → UNLIKING → VERIFYING`) đảm bảo video tải chậm không bao giờ bị đánh dấu `SKIPPED` oan.
- 🎨 **Giao diện Neon Dark SaaS**: Phong cách hiện đại (Neon Pink `#FF4F79` & Cyan `#36D5D8`), hỗ trợ cả **Side Panel** tiện lợi và **Dashboard toàn màn hình**.

## 2. Hướng dẫn cài đặt (Chrome / Edge / Cốc Cốc)

1. Tải về mã nguồn hoặc file `tiktok-cleaner-pro.zip`.
2. Mở trình duyệt và truy cập:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Cốc Cốc: `coccoc://extensions`
3. Bật **Chế độ dành cho nhà phát triển (Developer mode)** ở góc trên bên phải.
4. Bấm **Tải tiện ích đã giải nén (Load unpacked)** và chọn thư mục:
   ```
   tiktok-cleaner-pro/dist
   ```
5. Ghim biểu tượng **TikTok Cleaner Pro** lên thanh công cụ trình duyệt.

## 3. Hướng dẫn sử dụng

1. **Đăng nhập TikTok**: Mở [https://www.tiktok.com](https://www.tiktok.com) trên trình duyệt và đăng nhập tài khoản của bạn.
2. **Mở tiện ích**: Nhấp vào icon tiện ích để mở Side Panel (hoặc nhấn nút phóng to để vào Dashboard toàn màn hình). Extension sẽ tự nhận diện `@username` của bạn.
3. **Quét dữ liệu**:
   - Nhấn **Quét cả hai (Reposts & Likes)** hoặc chọn quét riêng **Chỉ quét Reposts** / **Chỉ quét Likes**.
   - Bấm **Dừng quét** bất kỳ lúc nào nếu đã đủ số lượng mong muốn.
4. **Chọn video cần gỡ**:
   - Nhấp vào từng thẻ video để chọn/bỏ chọn.
   - Dùng các nút nhanh: *Chọn tất cả*, *Bỏ chọn tất cả*, *Chỉ chọn Reposts*, *Chỉ chọn Likes*, *Đảo lựa chọn*.
5. **Bắt đầu dọn dẹp**:
   - Nhấn nút **Dọn dẹp đã chọn** ở thanh chân trang.
   - Hộp thoại xác nhận hiển thị chi tiết số video cần xóa. Bấm **Bắt đầu dọn dẹp**.
   - Extension sẽ tự động xử lý tuần tự. Bạn có thể nhấn **Tạm dừng** hoặc **Dừng** ngay trên thanh điều khiển bất cứ khi nào.

---

# 🇬🇧 English

## 1. Key Features

- ⚡ **Hybrid Fast Scanner (API + DOM)**: Rapidly discovers hundreds of Reposts & Likes within seconds via active TikTok session APIs with automatic DOM fallback.
- 🎯 **Correct Ordering (Newest → Oldest)**: Always displays videos exactly in TikTok's authentic chronological feed order.
- 🛡️ **Single-Tab Safe Automation**: Unlikes and removes reposts sequentially in the current TikTok tab — never spawns endless tabs or floods clicks.
- ⏹️ **Instant 0ms Stop & Pause**: Click **Stop Scan**, **Pause**, or **Stop** at any moment; operations abort immediately without losing processed progress. Safely **Resume** at will.
- 🔍 **Anti-Premature-Skip Engine**: Multi-stage state machine (`WAITING_FOR_VIDEO → WAITING_FOR_LIKE_BUTTON → CHECKING_LIKE → UNLIKING → VERIFYING`) prevents slow-loading videos from being mistakenly marked as `SKIPPED`.
- 🎨 **Neon Dark Glassmorphism UI**: High-end SaaS design with Neon Pink & Cyan accents, supporting both **Chrome Side Panel** and a full-size **Dashboard**.

## 2. Installation Guide

1. Download or clone this repository.
2. Open your Chromium browser (Chrome, Edge, Brave, Opera, Arc) and navigate to `chrome://extensions`.
3. Enable **Developer mode** toggle in the top-right corner.
4. Click **Load unpacked** and select the directory:
   ```
   tiktok-cleaner-pro/dist
   ```
5. Pin **TikTok Cleaner Pro** to your extension bar.

## 3. How to Use

1. **Sign in to TikTok**: Open [https://www.tiktok.com](https://www.tiktok.com) and log in to your account.
2. **Open Extension**: Click the extension icon to launch the Side Panel (or click the expand button for Full Dashboard). It automatically detects your `@username`.
3. **Scan Videos**:
   - Click **Scan Both (Reposts & Likes)** or select **Scan Reposts** / **Scan Likes**.
   - Hit **Stop Scan** whenever you have gathered enough videos.
4. **Select Videos**:
   - Click video cards to select or unselect.
   - Utilize quick toolbars: *Select All*, *Select Reposts*, *Select Likes*, *Invert Selection*, etc.
5. **Start Cleanup**:
   - Click **Cleanup Selected** on the sticky bottom action bar.
   - Review the confirmation summary and confirm to start.
   - Monitor live progress (% completed, success, skipped, failed) and pause or stop at any moment.

---

## 🛠 Dành cho lập trình viên / Development

```bash
# Di chuyển vào thư mục dự án / Navigate to project
cd tiktok-cleaner-pro

# Cài đặt thư viện / Install dependencies
npm install

# Chạy toàn bộ Unit Tests (57 tests) / Run tests
npm test

# Kiểm tra kiểu TypeScript / Run typecheck
npm run typecheck

# Build toàn bộ extension ra thư mục dist/ / Build extension
npm run build

# Đóng gói file zip phát hành / Build release zip package
npm run zip
```

---

## 🔒 Bản quyền & Miễn trừ trách nhiệm / Disclaimer

- **Cre**: `nhangom`
- Dự án là công cụ mã nguồn mở độc lập, phi thương mại giúp người dùng tự quản lý dữ liệu cá nhân của mình trên TikTok. Không liên kết, tài trợ hoặc được ủy quyền bởi ByteDance hoặc TikTok.
- *This is an independent open-source tool for personal data management. Not affiliated with, endorsed, or sponsored by TikTok or ByteDance.*
