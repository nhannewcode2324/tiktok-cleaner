import type { Lang } from './types';

export const translations = {
  vi: {
    appTitle: 'TikTok Cleaner Pro',
    tagline: 'Quản lý & Tự động dọn dẹp Reposts & Likes',
    connected: 'Đã kết nối',
    notConnected: 'Chưa kết nối',
    openTikTok: 'Mở TikTok',
    refreshAccount: 'Làm mới tài khoản',
    openDashboard: 'Mở Dashboard toàn màn hình',
    scanVideos: 'Quét Video',
    scanning: 'Đang quét...',
    stopScan: 'Dừng quét',
    scanReposts: 'Chỉ quét Reposts',
    scanLikes: 'Chỉ quét Likes',
    scanBoth: 'Quét cả hai (Reposts & Likes)',
    scanSectionTitle: 'QUÉT DỮ LIỆU TIKTOK',
    selectionSectionTitle: 'THAO TÁC CHỌN VIDEO DỌN DẸP',
    selectUnavailable: 'Chọn Bị ẩn / Đã xóa',
    
    // Stats
    totalScanned: 'Tổng đã quét',
    totalSelected: 'Đã chọn',
    selectedReposts: 'Reposts đã chọn',
    selectedLikes: 'Likes đã chọn',
    cleaned: 'Đã dọn dẹp',
    remaining: 'Còn lại',
    failed: 'Thất bại',

    // Toolbar
    selectAll: 'Chọn tất cả',
    deselectAll: 'Bỏ chọn tất cả',
    invertSelection: 'Đảo lựa chọn',
    selectReposts: 'Chỉ chọn Reposts',
    selectLikes: 'Chỉ chọn Likes',
    selectVisible: 'Chọn đang hiển thị',
    selectAllScanned: 'Chọn toàn bộ đã quét',

    // Filters
    searchPlaceholder: 'Tìm kiếm theo @tác giả hoặc nội dung...',
    filterAll: 'Tất cả',
    filterRepost: 'Chỉ Reposts',
    filterLike: 'Chỉ Likes',
    filterSelected: 'Đã chọn',
    filterUnselected: 'Chưa chọn',
    filterSuccess: 'Đã thành công',
    filterFailed: 'Bị lỗi',
    filterUnavailable: 'Bị ẩn / Đã xóa',

    // Sort
    sortNewest: 'Mới nhất → Cũ nhất (Chuẩn TikTok)',
    sortOldest: 'Cũ nhất → Mới nhất',
    sortPostNewest: 'Ngày đăng gốc (Mới → Cũ)',
    sortViewsDesc: 'Lượt xem (Cao → Thấp)',
    sortViewsAsc: 'Lượt xem (Thấp → Cao)',
    sortAuthorAsc: 'Tác giả (A → Z)',

    // Action
    cleanupSelected: 'Dọn dẹp đã chọn',
    noVideosSelected: 'Chưa chọn video nào',
    confirmCleanupTitle: 'Xác nhận Dọn dẹp Video',
    confirmWarning: 'Hành động này sẽ thực hiện gỡ tương tác trên tài khoản TikTok của bạn đối với các video đã chọn. Thao tác này không thể hoàn tác tự động.',
    targetAccount: 'Tài khoản đích',
    repostsToRemove: 'Số Reposts cần gỡ',
    likesToRemove: 'Số Likes cần bỏ',
    totalVideos: 'Tổng video xử lý',
    btnConfirm: 'Bắt đầu Dọn dẹp',
    btnCancel: 'Hủy bỏ',

    // Progress
    progressTitle: 'Tiến trình Xử lý',
    btnPause: 'Tạm dừng',
    btnResume: 'Tiếp tục',
    btnStop: 'Dừng lại',
    btnReset: 'Đặt lại tiến trình',
    pausedBanner: 'Tạm dừng:',

    // Logs & Settings
    activityLog: 'Nhật ký Hoạt động',
    exportCsv: 'Xuất CSV',
    exportJson: 'Xuất JSON',
    settings: 'Cài đặt',
    language: 'Ngôn ngữ',
    theme: 'Giao diện',
    dark: 'Tối (Dark)',
    light: 'Sáng (Light)',
    actionDelay: 'Khoảng nghỉ giữa các thao tác (giây)',
    maxItemsPerRun: 'Giới hạn số video mỗi lượt chạy',
    retryLimit: 'Số lần thử lại khi lỗi',
    stopOnConsecutiveErrors: 'Dừng khi lỗi liên tiếp',
    confirmBeforeCleanupText: 'Luôn xác nhận trước khi dọn dẹp',
    clearCache: 'Xóa bộ nhớ đệm cục bộ',
    clearCacheConfirm: 'Bạn có chắc chắn muốn xóa toàn bộ danh sách video đã quét và nhật ký cục bộ?',
    cacheCleared: 'Đã xóa bộ nhớ đệm thành công',
  },
  en: {
    appTitle: 'TikTok Cleaner Pro',
    tagline: 'Smart Repost & Like Manager',
    connected: 'Connected',
    notConnected: 'Not Connected',
    openTikTok: 'Open TikTok',
    refreshAccount: 'Refresh Account',
    openDashboard: 'Open Full Dashboard',
    scanVideos: 'Scan Videos',
    scanning: 'Scanning...',
    stopScan: 'Stop Scan',
    scanReposts: 'Scan Reposts Only',
    scanLikes: 'Scan Likes Only',
    scanBoth: 'Scan Both (Reposts & Likes)',
    scanSectionTitle: 'TIKTOK SCAN CONTROLS',
    selectionSectionTitle: 'VIDEO SELECTION CONTROLS',
    selectUnavailable: 'Select Hidden / Deleted',

    // Stats
    totalScanned: 'Total Scanned',
    totalSelected: 'Selected',
    selectedReposts: 'Selected Reposts',
    selectedLikes: 'Selected Likes',
    cleaned: 'Cleaned',
    remaining: 'Remaining',
    failed: 'Failed',

    // Toolbar
    selectAll: 'Select All',
    deselectAll: 'Deselect All',
    invertSelection: 'Invert Selection',
    selectReposts: 'Select Reposts Only',
    selectLikes: 'Select Likes Only',
    selectVisible: 'Select Visible',
    selectAllScanned: 'Select All Scanned',

    // Filters
    searchPlaceholder: 'Search by @author or description...',
    filterAll: 'All',
    filterRepost: 'Reposts Only',
    filterLike: 'Likes Only',
    filterSelected: 'Selected',
    filterUnselected: 'Unselected',
    filterSuccess: 'Cleaned',
    filterFailed: 'Failed',
    filterUnavailable: 'Hidden / Deleted',

    // Sort
    sortNewest: 'Newest → Oldest (TikTok Order)',
    sortOldest: 'Oldest → Newest',
    sortPostNewest: 'Post Date (Newest First)',
    sortViewsDesc: 'Views (High to Low)',
    sortViewsAsc: 'Views (Low to High)',
    sortAuthorAsc: 'Creator (A to Z)',

    // Action
    cleanupSelected: 'Cleanup Selected',
    noVideosSelected: 'No videos selected',
    confirmCleanupTitle: 'Confirm Video Cleanup',
    confirmWarning: 'This action will remove interactions on your TikTok account for the selected videos. This cannot be undone automatically.',
    targetAccount: 'Target Account',
    repostsToRemove: 'Reposts to remove',
    likesToRemove: 'Likes to remove',
    totalVideos: 'Total videos to process',
    btnConfirm: 'Start Cleanup',
    btnCancel: 'Cancel',

    // Progress
    progressTitle: 'Processing Progress',
    btnPause: 'Pause',
    btnResume: 'Resume',
    btnStop: 'Stop',
    btnReset: 'Reset Progress',
    pausedBanner: 'Paused:',

    // Logs & Settings
    activityLog: 'Activity Log',
    exportCsv: 'Export CSV',
    exportJson: 'Export JSON',
    settings: 'Settings',
    language: 'Language',
    theme: 'Theme',
    dark: 'Dark Mode',
    light: 'Light Mode',
    actionDelay: 'Action Delay (seconds)',
    maxItemsPerRun: 'Max items per run',
    retryLimit: 'Retry limit on error',
    stopOnConsecutiveErrors: 'Pause on consecutive errors',
    confirmBeforeCleanupText: 'Always confirm before cleanup',
    clearCache: 'Clear Local Cache',
    clearCacheConfirm: 'Are you sure you want to clear all scanned videos and logs from local storage?',
    cacheCleared: 'Cache cleared successfully',
  },
};

export function getT(lang: Lang) {
  return translations[lang] || translations.vi;
}
