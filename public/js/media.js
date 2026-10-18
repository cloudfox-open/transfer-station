/* 文件中转站 — 媒体：图片 / 视频 / PDF 查看器 */
// =========================================================
// 图片查看器
// =========================================================
function openImage(index) {
  if (!imageList.length) return;
  currentImageIndex = index;
  updateImageViewer();
  preloadNeighbors();
  document.getElementById('image-viewer').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function updateImageViewer() {
  const img = imageList[currentImageIndex];
  if (!img) return;
  document.getElementById('viewer-img').src = '/api/file?path=' + encodeURIComponent(img.path);
  document.getElementById('viewer-name').textContent = img.name;
  document.getElementById('viewer-download').href = '/api/file?path=' + encodeURIComponent(img.path) + '&download=1';
  document.getElementById('image-counter').textContent = `${currentImageIndex + 1} / ${imageList.length}`;
}

function preloadNeighbors() {
  if (imageList.length < 2) return;
  const next = (currentImageIndex + 1) % imageList.length;
  const prev = (currentImageIndex - 1 + imageList.length) % imageList.length;
  [prev, next].forEach(i => {
    const item = imageList[i];
    if (item && !preloadCache[item.path]) {
      new Image().src = '/api/file?path=' + encodeURIComponent(item.path);
      preloadCache[item.path] = true;
    }
  });
}

function prevImage() {
  if (imageList.length <= 1) return;
  currentImageIndex = (currentImageIndex - 1 + imageList.length) % imageList.length;
  updateImageViewer(); preloadNeighbors(); resetSlideshow();
}

function nextImage() {
  if (imageList.length <= 1) return;
  currentImageIndex = (currentImageIndex + 1) % imageList.length;
  updateImageViewer(); preloadNeighbors(); resetSlideshow();
}

function closeImageViewer() {
  document.getElementById('image-viewer').classList.remove('active');
  document.body.style.overflow = '';
  stopSlideshow();
}

// 幻灯片
function toggleSlideshow() { slideshowActive ? stopSlideshow() : startSlideshow(); }

function startSlideshow() {
  slideshowActive = true;
  document.getElementById('slideshow-btn').textContent = '⏸ 暂停';
  slideshowTimer = setInterval(nextImage, slideshowSpeed);
}

function stopSlideshow() {
  slideshowActive = false;
  document.getElementById('slideshow-btn').textContent = '▶ 自动播放';
  if (slideshowTimer) { clearInterval(slideshowTimer); slideshowTimer = null; }
}

function resetSlideshow() {
  if (slideshowActive) { clearInterval(slideshowTimer); slideshowTimer = setInterval(nextImage, slideshowSpeed); }
}

function changeSlideshowSpeed() {
  slideshowSpeed = parseInt(document.getElementById('slideshow-speed').value);
  if (slideshowActive) { clearInterval(slideshowTimer); slideshowTimer = setInterval(nextImage, slideshowSpeed); }
}

// =========================================================
// 视频
// =========================================================
function openVideo(index) {
  if (!videoList.length) return;
  currentVideoIndex = index;
  updateVideoViewer();
  document.getElementById('video-viewer').classList.add('active');
  document.getElementById('viewer-video').play().catch(() => {});
  document.body.style.overflow = 'hidden';
}

function updateVideoViewer() {
  const v = videoList[currentVideoIndex];
  if (!v) return;
  const video = document.getElementById('viewer-video');
  video.src = '/api/file?path=' + encodeURIComponent(v.path);
  video.playbackRate = parseFloat(document.getElementById('video-speed').value);
  document.getElementById('video-name').textContent = v.name;
  document.getElementById('video-download').href = '/api/file?path=' + encodeURIComponent(v.path) + '&download=1';
  document.getElementById('video-counter').textContent = `${currentVideoIndex + 1} / ${videoList.length}`;
}

function prevVideo() {
  if (videoList.length <= 1) return;
  currentVideoIndex = (currentVideoIndex - 1 + videoList.length) % videoList.length;
  updateVideoViewer();
  document.getElementById('viewer-video').play().catch(() => {});
}

function nextVideo() {
  if (videoList.length <= 1) return;
  currentVideoIndex = (currentVideoIndex + 1) % videoList.length;
  updateVideoViewer();
  document.getElementById('viewer-video').play().catch(() => {});
}

function closeVideoViewer() {
  document.getElementById('video-viewer').classList.remove('active');
  const video = document.getElementById('viewer-video');
  video.pause(); video.src = '';
  document.body.style.overflow = '';
}

function changeVideoSpeed() {
  document.getElementById('viewer-video').playbackRate = parseFloat(document.getElementById('video-speed').value);
}

// =========================================================
// PDF
// =========================================================
function openPdfViewer(filePath) {
  document.getElementById('pdf-name').textContent = filePath.split(/[\\/]/).pop();
  document.getElementById('pdf-download').href = '/api/file?path=' + encodeURIComponent(filePath) + '&download=1';
  document.getElementById('pdf-frame').src = '/api/file?path=' + encodeURIComponent(filePath);
  document.getElementById('pdf-viewer').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closePdfViewer() {
  document.getElementById('pdf-viewer').classList.remove('active');
  document.getElementById('pdf-frame').src = '';
  document.body.style.overflow = '';
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function togglePdfFullscreen() {
  if (!document.fullscreenElement) document.getElementById('pdf-viewer').requestFullscreen().catch(() => {});
  else document.exitFullscreen().catch(() => {});
}

