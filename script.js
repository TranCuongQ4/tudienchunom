// Cấu hình PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

// DOM elements
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const resultArea = document.getElementById('resultArea');

// URL Cloudflare Worker API
const CLOUDFLARE_WORKER_URL = 'https://trachunom.cuongprovuimusic.workers.dev/';

// Biến cho zoom overlay
let zoomOverlay = null;
let zoomCanvas = null;
let closeBtn = null;
let isZooming = false;
let zoomScale = 1;
let panX = 0;
let panY = 0;
let isDragging = false;
let startX = 0;
let startY = 0;
let touchStartX = 0;
let touchStartY = 0;
let touchStartPanX = 0;
let touchStartPanY = 0;
let touchLastDist = 0;
let touchStartScale = 1;

// Biến cho hiệu ứng hoa sen
let lotusParticles = [];
let lotusAnimationId = null;
let lotusContainer = null;
let isLotusRunning = false;

// --- 1. Hàm tìm kiếm từ Cloudflare API ---
async function searchWord(keyword) {
    try {
        const url = `${CLOUDFLARE_WORKER_URL}?q=${encodeURIComponent(keyword)}&t=${Date.now()}`;
        const response = await fetch(url);
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        return data.results || [];
    } catch (error) {
        console.error('❌ Lỗi tìm kiếm từ Cloudflare:', error);
        return [];
    }
}

// --- 2. Hàm tải một trang PDF cụ thể từ thư mục tudien ---
async function loadPDFPage(pdfFileName) {
    const pdfUrl = `tudien/${pdfFileName}`;
    try {
        const loadingTask = pdfjsLib.getDocument(pdfUrl);
        const pdfDoc = await loadingTask.promise;
        return pdfDoc;
    } catch (error) {
        console.error(`❌ Lỗi tải file ${pdfFileName}:`, error);
        return null;
    }
}

// --- 3. Render trang PDF thành ảnh canvas ---
async function renderPageToCanvas(pdfFileName, container) {
    try {
        // Kiểm tra container tồn tại
        if (!container) {
            console.error(`Container không tồn tại cho file ${pdfFileName}`);
            return false;
        }
        
        container.innerHTML = '';
        
        // Tải file PDF cụ thể
        const pdfDoc = await loadPDFPage(pdfFileName);
        if (!pdfDoc) {
            container.innerHTML = `<p style="color:#ff6b6b;">❌ Lỗi tải file ${pdfFileName}</p>`;
            return false;
        }
        
        // Lấy trang đầu tiên (vì mỗi file PDF chỉ có 1 trang)
        const page = await pdfDoc.getPage(1);
        const viewport = page.getViewport({ scale: 1.5 });
        
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.maxWidth = '100%';
        canvas.style.height = 'auto';
        canvas.style.cursor = 'pointer';
        canvas.setAttribute('data-page', pdfFileName);
        
        canvas.addEventListener('click', function(e) {
            e.stopPropagation();
            openZoom(this, pdfFileName);
        });
        
        const renderContext = {
            canvasContext: context,
            viewport: viewport
        };
        await page.render(renderContext).promise;
        
        container.appendChild(canvas);
        
        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'download-btn';
        downloadBtn.innerHTML = '<i class="fas fa-download"></i> Tải trang này';
        downloadBtn.onclick = () => {
            const link = document.createElement('a');
            link.download = `trang_${pdfFileName}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        };
        container.appendChild(downloadBtn);
        
        return true;
    } catch (error) {
        console.error(`Lỗi render file ${pdfFileName}:`, error);
        if (container) {
            container.innerHTML = `<p style="color:#ff6b6b;">❌ Lỗi tải trang ${pdfFileName}</p>`;
        }
        return false;
    }
}

// --- 4. Tạo Zoom Overlay ---
function createZoomOverlay() {
    if (zoomOverlay) {
        zoomOverlay.style.display = 'flex';
        if (closeBtn) {
            closeBtn.style.display = 'flex';
        }
        return;
    }
    
    zoomOverlay = document.createElement('div');
    zoomOverlay.id = 'zoomOverlay';
    zoomOverlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.95);
        z-index: 9999;
        display: flex;
        justify-content: center;
        align-items: center;
        overflow: hidden;
        touch-action: none;
    `;
    
    const zoomContainer = document.createElement('div');
    zoomContainer.id = 'zoomContainer';
    zoomContainer.style.cssText = `
        width: 100%;
        height: 100%;
        overflow: hidden;
        position: relative;
        touch-action: none;
    `;
    
    zoomCanvas = document.createElement('canvas');
    zoomCanvas.id = 'zoomCanvas';
    zoomCanvas.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        transform-origin: center;
        cursor: grab;
        touch-action: none;
    `;
    
    zoomContainer.appendChild(zoomCanvas);
    zoomOverlay.appendChild(zoomContainer);
    
    closeBtn = document.createElement('div');
    closeBtn.id = 'closeBtn';
    closeBtn.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background: #ff0000;
        border: none;
        color: #ffffff;
        font-size: 24px;
        font-weight: bold;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 10001;
        transition: all 0.2s ease;
        user-select: none;
        -webkit-user-select: none;
        font-family: Arial, sans-serif;
        box-shadow: 0 0 30px rgba(255,0,0,0.5);
        line-height: 1;
        pointer-events: auto;
    `;
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('draggable', 'false');
    
    closeBtn.addEventListener('mouseenter', function() {
        this.style.transform = 'scale(1.1)';
        this.style.background = '#cc0000';
        this.style.boxShadow = '0 0 40px rgba(255,0,0,0.7)';
    });
    closeBtn.addEventListener('mouseleave', function() {
        this.style.transform = 'scale(1)';
        this.style.background = '#ff0000';
        this.style.boxShadow = '0 0 30px rgba(255,0,0,0.5)';
    });
    
    closeBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        console.log('Đã nhấn nút X - Đóng zoom');
        closeZoom();
    });
    
    document.body.appendChild(closeBtn);
    document.body.appendChild(zoomOverlay);
    
    zoomOverlay.addEventListener('click', function(e) {
        if (e.target === this || e.target === zoomContainer) {
            closeZoom();
        }
    });
    
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && isZooming) {
            closeZoom();
        }
    });
    
    window.addEventListener('popstate', function(e) {
        if (isZooming) {
            closeZoom();
        }
    });
}

// --- 5. Mở Zoom ---
async function openZoom(canvas, pdfFileName) {
    if (isZooming) return;
    
    // Tạm dừng hiệu ứng hoa sen khi zoom
    stopLotusEffect();
    
    history.pushState({ zoom: true }, '');
    
    isZooming = true;
    zoomScale = 1;
    panX = 0;
    panY = 0;
    
    createZoomOverlay();
    
    if (zoomOverlay) {
        zoomOverlay.style.display = 'flex';
    }
    if (closeBtn) {
        closeBtn.style.display = 'flex';
    }
    
    const sourceCanvas = canvas;
    const ctx = zoomCanvas.getContext('2d');
    
    zoomCanvas.width = sourceCanvas.width;
    zoomCanvas.height = sourceCanvas.height;
    zoomCanvas.style.width = 'auto';
    zoomCanvas.style.height = '100vh';
    zoomCanvas.style.maxWidth = '100%';
    zoomCanvas.style.maxHeight = '100%';
    
    ctx.drawImage(sourceCanvas, 0, 0);
    
    zoomCanvas.setAttribute('data-page', pdfFileName);
    zoomCanvas.setAttribute('data-scale', '1');
    
    updateZoomTransform();
    
    zoomOverlay.removeEventListener('wheel', handleWheel);
    zoomOverlay.removeEventListener('touchstart', handleTouchStart);
    zoomOverlay.removeEventListener('touchmove', handleTouchMove);
    zoomOverlay.removeEventListener('touchend', handleTouchEnd);
    
    zoomOverlay.addEventListener('wheel', handleWheel, { passive: false });
    zoomOverlay.addEventListener('touchstart', handleTouchStart, { passive: false });
    zoomOverlay.addEventListener('touchmove', handleTouchMove, { passive: false });
    zoomOverlay.addEventListener('touchend', handleTouchEnd, { passive: false });
    
    zoomCanvas.removeEventListener('mousedown', startDrag);
    document.removeEventListener('mousemove', moveDrag);
    document.removeEventListener('mouseup', endDrag);
    
    zoomCanvas.addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', moveDrag);
    document.addEventListener('mouseup', endDrag);
}

// --- 6. Xử lý Zoom ---
function updateZoomTransform() {
    if (!zoomCanvas) return;
    const scale = zoomScale;
    zoomCanvas.style.transform = `translate(calc(-50% + ${panX}px), calc(-50% + ${panY}px)) scale(${scale})`;
}

function handleWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    zoomScale = Math.min(Math.max(zoomScale + delta, 0.5), 5);
    updateZoomTransform();
}

function handleTouchStart(e) {
    e.preventDefault();
    if (e.touches.length === 1) {
        isDragging = true;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchStartPanX = panX;
        touchStartPanY = panY;
    } else if (e.touches.length === 2) {
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        touchLastDist = Math.hypot(touch1.clientX - touch2.clientX, touch1.clientY - touch2.clientY);
        touchStartScale = zoomScale;
    }
}

function handleTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 1 && isDragging) {
        const dx = e.touches[0].clientX - touchStartX;
        const dy = e.touches[0].clientY - touchStartY;
        panX = touchStartPanX + dx;
        panY = touchStartPanY + dy;
        updateZoomTransform();
    } else if (e.touches.length === 2) {
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        const dist = Math.hypot(touch1.clientX - touch2.clientX, touch1.clientY - touch2.clientY);
        const scale = dist / touchLastDist;
        zoomScale = Math.min(Math.max(touchStartScale * scale, 0.5), 5);
        updateZoomTransform();
    }
}

function handleTouchEnd(e) {
    isDragging = false;
}

function startDrag(e) {
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    zoomCanvas.style.cursor = 'grabbing';
}

function moveDrag(e) {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    panX += dx;
    panY += dy;
    startX = e.clientX;
    startY = e.clientY;
    updateZoomTransform();
}

function endDrag(e) {
    isDragging = false;
    if (zoomCanvas) zoomCanvas.style.cursor = 'grab';
}

// --- 7. Đóng Zoom ---
function closeZoom() {
    if (!isZooming) {
        if (zoomOverlay) {
            zoomOverlay.style.display = 'none';
        }
        if (closeBtn) {
            closeBtn.style.display = 'none';
        }
        // Khởi động lại hiệu ứng hoa sen nếu đang tắt
        if (!isLotusRunning) {
            startLotusEffect();
        }
        return;
    }
    
    console.log('Đóng zoom');
    isZooming = false;
    
    if (zoomOverlay) {
        zoomOverlay.style.display = 'none';
        zoomOverlay.removeEventListener('wheel', handleWheel);
        zoomOverlay.removeEventListener('touchstart', handleTouchStart);
        zoomOverlay.removeEventListener('touchmove', handleTouchMove);
        zoomOverlay.removeEventListener('touchend', handleTouchEnd);
        document.removeEventListener('mousemove', moveDrag);
        document.removeEventListener('mouseup', endDrag);
        if (zoomCanvas) {
            zoomCanvas.removeEventListener('mousedown', startDrag);
        }
    }
    
    if (closeBtn) {
        closeBtn.style.display = 'none';
    }
    
    zoomScale = 1;
    panX = 0;
    panY = 0;
    
    if (history.state && history.state.zoom) {
        history.back();
    }
    
    // Khởi động lại hiệu ứng hoa sen
    startLotusEffect();
}

// --- 8. HIỆU ỨNG HOA SEN RƠI LỘN XỘN ---

// Lớp đối tượng hoa sen
class LotusParticle {
    constructor(container) {
        this.container = container;
        this.element = document.createElement('div');
        this.element.className = 'lotus-particle';
        
        const symbols = ['🌸', '🌺', '🍁', '🍂', '🍀️'];
        this.element.textContent = symbols[Math.floor(Math.random() * symbols.length)];
        
        // Vị trí ban đầu ngẫu nhiên
        this.x = Math.random() * 100;
        this.y = -20 - Math.random() * 150;
        this.size = 20 + Math.random() * 25;
        
        // Vận tốc rơi
        this.velocityY = 0.3 + Math.random() * 0.6;
        this.velocityX = (Math.random() - 0.5) * 0.4;
        
        // Dao động hình sin
        this.amplitude = 20 + Math.random() * 50;
        this.frequency = 0.008 + Math.random() * 0.025;
        this.phase = Math.random() * Math.PI * 2;
        
        // Xoay
        this.rotation = 0;
        this.rotationSpeed = (Math.random() - 0.5) * 3;
        
        // Độ mờ
        this.opacity = 0.04 + Math.random() * 0.08;
        
        // Màu sắc
        const colors = ['#ff69b4', '#ff1493', '#ff6b81', '#ff4757', '#ff6348', '#ff7f50', '#ffb6c1', '#ff4081'];
        this.color = colors[Math.floor(Math.random() * colors.length)];
        
        // Độ trễ ban đầu
        this.delay = Math.random() * 5;
        this.age = -this.delay;
        
        this.element.style.cssText = `
            position: absolute;
            left: ${this.x}%;
            top: ${this.y}px;
            font-size: ${this.size}px;
            opacity: 0;
            pointer-events: none;
            transform-origin: center;
            color: ${this.color};
            text-shadow: 0 0 20px ${this.color}40, 0 0 40px ${this.color}20;
            will-change: transform, top, left, opacity;
            transition: none;
            z-index: 0;
        `;
        
        container.appendChild(this.element);
        this.isActive = true;
        this.isVisible = false;
    }
    
    update() {
        if (!this.isActive) return;
        
        this.age += 0.016; // ~60fps
        
        // Chỉ hiển thị sau thời gian trễ
        if (this.age < 0) {
            this.element.style.opacity = '0';
            return;
        }
        
        // Rơi xuống với gia tốc nhẹ
        this.velocityY += 0.001;
        this.y += this.velocityY;
        
        // Dao động theo hình sin (lượn sóng)
        this.x += this.velocityX + Math.sin(this.phase) * 0.03;
        this.phase += this.frequency;
        
        // Xoay
        this.rotation += this.rotationSpeed;
        
        // Kiểm tra nếu rơi ra khỏi màn hình thì reset
        if (this.y > window.innerHeight + 100) {
            this.reset();
        }
        
        // Giới hạn x trong khoảng 0-100%
        if (this.x < -10) this.x = -10;
        if (this.x > 110) this.x = 110;
        
        // Cập nhật vị trí và transform
        this.element.style.left = `${this.x}%`;
        this.element.style.top = `${this.y}px`;
        this.element.style.transform = `rotate(${this.rotation}deg) scale(${0.8 + Math.sin(this.phase * 2) * 0.2})`;
        
        // Hiệu ứng mờ dần khi xuống cuối
        const progress = this.y / (window.innerHeight + 100);
        const fadeOpacity = this.opacity * (1 - progress * 0.5);
        this.element.style.opacity = Math.max(0, fadeOpacity);
        
        if (!this.isVisible) {
            this.isVisible = true;
        }
    }
    
    reset() {
        this.y = -20 - Math.random() * 150;
        this.x = Math.random() * 100;
        this.velocityY = 0.3 + Math.random() * 0.6;
        this.velocityX = (Math.random() - 0.5) * 0.4;
        this.amplitude = 20 + Math.random() * 50;
        this.frequency = 0.008 + Math.random() * 0.025;
        this.phase = Math.random() * Math.PI * 2;
        this.rotationSpeed = (Math.random() - 0.5) * 3;
        this.age = -(Math.random() * 8);
        this.isVisible = false;
        this.element.style.opacity = '0';
    }
    
    destroy() {
        this.isActive = false;
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
    }
}

// Khởi tạo hiệu ứng hoa sen
function initLotusEffect() {
    // Kiểm tra và tạo container nếu chưa có
    if (!lotusContainer) {
        lotusContainer = document.createElement('div');
        lotusContainer.className = 'lotus-container';
        lotusContainer.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 0;
            overflow: hidden;
        `;
        
        // Thêm vào resultArea
        if (resultArea) {
            resultArea.style.position = 'relative';
            resultArea.insertBefore(lotusContainer, resultArea.firstChild);
        }
    }
    
    // Xóa các hạt cũ
    lotusParticles.forEach(p => p.destroy());
    lotusParticles = [];
    
    // Tạo hoa sen mới
    const count = 15 + Math.floor(Math.random() * 10);
    for (let i = 0; i < count; i++) {
        const particle = new LotusParticle(lotusContainer);
        // Phân bố đều trên màn hình
        particle.x = (i / count) * 100 + (Math.random() - 0.5) * 10;
        particle.y = (i / count) * window.innerHeight - 100;
        lotusParticles.push(particle);
    }
}

// Bắt đầu hiệu ứng hoa sen
function startLotusEffect() {
    if (isLotusRunning) return;
    
    // Kiểm tra nếu đang zoom thì không khởi động
    if (isZooming) return;
    
    isLotusRunning = true;
    
    // Khởi tạo nếu chưa có
    if (lotusParticles.length === 0) {
        initLotusEffect();
    }
    
    // Dừng animation cũ nếu có
    if (lotusAnimationId) {
        cancelAnimationFrame(lotusAnimationId);
        lotusAnimationId = null;
    }
    
    // Chạy animation
    function animateLotus() {
        if (!isLotusRunning) return;
        
        lotusParticles.forEach(p => p.update());
        lotusAnimationId = requestAnimationFrame(animateLotus);
    }
    
    animateLotus();
}

// Dừng hiệu ứng hoa sen
function stopLotusEffect() {
    isLotusRunning = false;
    if (lotusAnimationId) {
        cancelAnimationFrame(lotusAnimationId);
        lotusAnimationId = null;
    }
}

// Làm mới hiệu ứng hoa sen
function refreshLotusEffect() {
    stopLotusEffect();
    
    // Xóa container cũ
    if (lotusContainer) {
        lotusContainer.innerHTML = '';
        lotusParticles = [];
    }
    
    // Khởi tạo lại
    setTimeout(() => {
        initLotusEffect();
        startLotusEffect();
    }, 100);
}

// --- 9. HÀM TÌM KIẾM (đã cập nhật để gọi API Cloudflare) ---
async function searchAndDisplay(keyword) {
    if (isZooming) closeZoom();
    
    // Tạm dừng hoa sen khi tìm kiếm
    stopLotusEffect();
    
    resultArea.innerHTML = '';

    if (!keyword || keyword.trim() === '') {
        resultArea.innerHTML = `<p class="hint">🔍 Nhập từ (bát,tuệ,ngộ,v...v...)</p>`;
        setTimeout(() => {
            if (!isZooming) {
                startLotusEffect();
            }
        }, 300);
        return;
    }

    const searchTerm = keyword.trim().toLowerCase();
    console.log(`🔎 Tìm từ: "${searchTerm}"`);

    // Gọi API tìm kiếm từ Cloudflare
    const pdfFiles = await searchWord(searchTerm);
    
    if (pdfFiles.length === 0) {
        resultArea.innerHTML = `<div class="result-item" style="border-left-color:#ff6b6b;">
            <div class="page-content" style="color:#7a8399; padding:10px 0;">
                💡 Không có từ "<strong>${searchTerm}</strong>" trong từ điển
                <br/>• Kiểm tra chính tả
                <br/>• Thử từ khác
            </div>
        </div>`;
        
        setTimeout(() => {
            if (!isZooming) {
                refreshLotusEffect();
            }
        }, 500);
        return;
    }

    // Sắp xếp kết quả theo số thứ tự
    const sortedPdfFiles = pdfFiles.sort((a, b) => {
        const numA = parseInt(a);
        const numB = parseInt(b);
        return numA - numB;
    });
    
    // Tạo container cho từng file PDF
    for (const pdfFileName of sortedPdfFiles) {
        const pageDiv = document.createElement('div');
        pageDiv.className = 'result-item';
        
        const containerId = `page-${pdfFileName.replace('.pdf', '')}`;
        pageDiv.innerHTML = `
            <div class="page-content" id="${containerId}" style="text-align:center; padding:10px 0;">
                <div style="color:#7a8399; padding:20px;">⏳ Đang tải trang ${pdfFileName}...</div>
            </div>
        `;
        resultArea.appendChild(pageDiv);
        
        const contentDiv = document.getElementById(containerId);
        if (contentDiv) {
            await renderPageToCanvas(pdfFileName, contentDiv);
        } else {
            console.error(`Không tìm thấy container với ID: ${containerId}`);
        }
    }

    resultArea.scrollTop = 0;
    
    setTimeout(() => {
        if (!isZooming) {
            refreshLotusEffect();
        }
    }, 500);
}

// --- 10. Xử lý sự kiện ---
async function handleSearch() {
    const keyword = searchInput.value.trim();
    if (keyword === '') {
        resultArea.innerHTML = `<p class="hint">🔍 Nhập từ (bát,tuệ,ngộ,v...v...)</p>`;
        if (!isZooming) {
            refreshLotusEffect();
        }
        return;
    }
    await searchAndDisplay(keyword);
}

searchBtn.addEventListener('click', handleSearch);

searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        handleSearch();
    }
});

document.addEventListener('contextmenu', (e) => e.preventDefault());

// --- 11. Khởi chạy ---
async function init() {
    // Hiển thị thông báo đã sẵn sàng
    resultArea.innerHTML = `<p class="hint">📚 Thư viện nôm chuẩn Việt Nam. 📚</br></br>
                            🌸 Sản Phẩm Viện Việt - Học 🌸</br></br>
                            Nguyễn Hữu Vinh - Đặng Thế Kiệt</br>
                            Nguyễn Doãn Vượng - Lê Văn Đặng</br>
                            Nguyễn Văn Sâm - Nguyễn Ngọc Bích</br>
                            Trần Uyên Thi</p>`;
    
    // Khởi tạo hiệu ứng hoa sen
    setTimeout(() => {
        initLotusEffect();
        startLotusEffect();
    }, 500);
}

// Khởi tạo khi trang load
init();

// Xử lý khi resize
let resizeTimeout;
window.addEventListener('resize', function() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        if (!isZooming && isLotusRunning) {
            refreshLotusEffect();
        }
    }, 500);
});