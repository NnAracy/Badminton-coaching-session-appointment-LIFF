const COACH_LINE_ID = "Uebc116558da54785e0c7671baa01a172"; 
const MY_LIFF_ID = "2010678137-EkdnuUi9";
const SUPABASE_URL = 'https://qjthdrxrssordalufwhb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_ck-5xYAyrCAlrqSnaPKeSQ_h2fbGmwo';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 狀態變數
let currentUserProfile = null;
let isCoach = false;
let currentSelectedDate = ''; // 格式 YYYY-MM-DD
let selectedStartTime = '';   // 格式 HH:mm
let todaysBookings = [];      // 儲存當前選定日期的所有預約，供防呆檢查
let currentDetailBooking = null;

let isEditMode = false;
let isDragging = false;
let dragAction = null; // 'lock' 或 'unlock' (根據按下去的第一格決定)
let autoScrollInterval = null;
let scrollSpeed = 0;
let isScrolling = false;

document.addEventListener("DOMContentLoaded", () => {
    setupModalListeners();
    generateDateCarousel();
    initializeLiff(MY_LIFF_ID);
});

function initializeLiff(myLiffId) {
    liff.init({ liffId: myLiffId })
        .then(() => {
            if (liff.isLoggedIn()) {
                liff.getProfile().then(profile => {
                    currentUserProfile = profile;
                    finishLogin();
                });
            } else {
                liff.login();
            }
        }).catch(err => console.error(err));
}

function finishLogin() {
    isCoach = (currentUserProfile.userId === COACH_LINE_ID);
    document.getElementById("user-name").textContent = currentUserProfile.displayName;
    if (currentUserProfile.pictureUrl) document.getElementById("user-avatar").src = currentUserProfile.pictureUrl;
    if (isCoach) document.getElementById("role-badge").style.display = "inline-block";
    
    if (isCoach) {
        document.getElementById("role-badge").style.display = "inline-block";
        document.getElementById("coach-edit-controls").style.display = "flex"; // 顯示編輯按鈕
        setupEditModeListeners();
    }
    fetchAndRenderBookings();
}

function generateDateCarousel() {
    const carousel = document.getElementById("date-carousel");
    carousel.innerHTML = ""; 
    const today = new Date();
    const daysOfWeek = ["日", "一", "二", "三", "四", "五", "六"];
    let previousMonth = -1;

    for (let i = 1; i <= 14; i++) {
        let futureDate = new Date(today);
        futureDate.setDate(today.getDate() + i);

        // 產生 YYYY-MM-DD 字串供資料庫使用
        let dateString = `${futureDate.getFullYear()}-${String(futureDate.getMonth()+1).padStart(2,'0')}-${String(futureDate.getDate()).padStart(2,'0')}`;
        
        if (i === 1) currentSelectedDate = dateString; // 預設選中明天

        let currentMonth = futureDate.getMonth() + 1;
        let day = futureDate.getDate();
        let weekDay = daysOfWeek[futureDate.getDay()];

        if (previousMonth !== -1 && currentMonth !== previousMonth) {
            let divider = document.createElement("div");
            divider.className = "month-divider";
            divider.innerHTML = `<span>${currentMonth}月</span><div class="line"></div>`;
            carousel.appendChild(divider);
        }
        previousMonth = currentMonth;

        let btn = document.createElement("div");
        btn.className = "date-btn";
        if (i === 1) btn.classList.add("active"); 
        
        btn.innerHTML = `<span>${weekDay}</span><span style="font-size: 20px; font-weight: bold;">${day}</span>`;
        btn.dataset.date = dateString;

        btn.addEventListener('click', () => {
            document.querySelectorAll('.date-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentSelectedDate = btn.dataset.date;
            fetchAndRenderBookings(); // 切換日期重新撈資料
        });
        carousel.appendChild(btn);
    }
}

// 核心：從資料庫撈取並渲染網格
async function fetchAndRenderBookings() {
    renderEmptyTimeGrid(); 
    
    const { data, error } = await supabaseClient
        .from('bookings')
        .select('*')
        .eq('booking_date', currentSelectedDate);

    if (error) {
        console.error("讀取資料失敗：", error);
        return;
    }

    todaysBookings = data; 

    data.forEach(booking => {
        // 【核心修正】加入 !isCoach 條件。
        // 如果是教練，強制將 isMine 設為 false，徹底關閉「自己的預約」的特殊樣式與邏輯
        let isMine = !isCoach && (currentUserProfile && booking.user_line_id === currentUserProfile.userId);
        
        let title = '';
        let subtitle = '';

        if (booking.status === 'locked') {
            title = "無法預約";
            subtitle = "";
        } else if (isCoach) {
            title = `${booking.user_name} (${booking.participants}人)`;
            subtitle = booking.location;
        } else if (isMine) {
            title = `我的預約 (${booking.participants}人)`;
            subtitle = booking.location;
        } else {
            title = booking.status === 'confirmed' ? "已被預約" : "待確定預約";
            subtitle = booking.location;
        }

        addBooking(booking, title, subtitle, isMine);
    });
}

function renderEmptyTimeGrid() {
    const timeGrid = document.getElementById("time-grid");
    timeGrid.innerHTML = ""; 

    for (let hour = 8; hour <= 21; hour++) {
        ['00', '30'].forEach(minute => {
            let timeString = `${hour.toString().padStart(2, '0')}:${minute}`;
            let row = document.createElement("div");
            row.className = "time-row";
            
            row.innerHTML = `
                <div class="time-label">${timeString}</div>
                <div class="time-slot" id="slot-${timeString.replace(':', '')}"></div>
            `;
            
            // 點擊空地觸發預約
            let slotDiv = row.querySelector('.time-slot');
            slotDiv.addEventListener('click', (e) => {
                if(e.target !== slotDiv) return; // 避免點到已有的色塊
                openBookingModal(timeString);
            });

            timeGrid.appendChild(row);
        });
    }
}

// 在 addBooking 函數中，綁定點擊事件
function addBooking(booking, title, subtitle, isMine) {
    const timeId = booking.start_time.replace(':', '');
    const slot = document.getElementById(`slot-${timeId}`);
    if (!slot) return;
    
    const slotsSpanned = Math.ceil(booking.duration_mins / 30);
    let block = document.createElement("div");
    block.className = `booking-block status-${booking.status} ${isMine ? "my-booking" : ""}`;
    block.style.height = `calc(${slotsSpanned * 100}% + ${slotsSpanned - 1}px - 6px)`;
    
    const hoursText = booking.duration_mins >= 60 ? `(${booking.duration_mins / 60}h)` : '';
    block.innerHTML = `<div>${title} ${hoursText}</div>${subtitle ? `<div class="booking-info">${subtitle}</div>` : ''}`;
    
    // 綁定點擊開啟詳情
    block.addEventListener('click', (e) => {
        e.stopPropagation(); 
        
        // 【新增】如果是鎖定時段，點擊不做任何反應
        if (booking.status === 'locked') return;

        if (isCoach || isMine) {
            openDetailModal(booking);
        }
    });
    
    slot.appendChild(block);
}

// 渲染詳細資訊與權限判斷
function openDetailModal(booking) {
    currentDetailBooking = booking; 
    
    const contentDiv = document.getElementById("detail-content");
    const cancelBtn = document.getElementById("detail-cancel-btn");
    const confirmBtn = document.getElementById("detail-confirm-btn");

    // 取消按鈕邏輯：學員不能取消 confirmed
    if (booking.status === 'confirmed' && !isCoach) {
        cancelBtn.style.display = "none"; 
    } else {
        cancelBtn.style.display = "block";
    }

    // 確認按鈕邏輯：只有教練且 pending 才顯示
    if (isCoach && booking.status === 'pending') {
        confirmBtn.style.display = "block";
    } else {
        confirmBtn.style.display = "none";
    }

    let trialHtml = booking.is_first_trial ? `<span class="trial-badge">首次試教</span>` : '';
    let statusText = booking.status === 'confirmed' 
        ? '<span style="color:#28a745;font-weight:bold;">已確定</span>' 
        : '<span style="color:#ffc107;font-weight:bold;">待確定</span>';
        
    contentDiv.innerHTML = `
        <p><strong>預約人：</strong> ${booking.user_name} ${trialHtml}</p>
        <p><strong>狀態：</strong> ${statusText}</p>
        <p><strong>時間：</strong> ${booking.start_time} (${booking.duration_mins} 分鐘)</p>
        <p><strong>地點：</strong> ${booking.location}</p>
        <p><strong>人數：</strong> ${booking.participants} 人</p>
        <p><strong>備註：</strong> ${booking.note || '無'}</p>
    `;

    document.getElementById("detail-modal").style.display = "flex";
}

// ================= 新增：自訂確認對話框的非同步函數 =================
function showCustomConfirm(message, okButtonText = "確定", okButtonColor = "#dc3545") {
    return new Promise((resolve) => {
        const modal = document.getElementById("custom-confirm-modal");
        const okBtn = document.getElementById("custom-btn-ok");
        const cancelBtn = document.getElementById("custom-btn-cancel");

        // 設定文字與按鈕顏色
        document.getElementById("custom-confirm-message").textContent = message;
        okBtn.textContent = okButtonText;
        okBtn.style.backgroundColor = okButtonColor;

        modal.style.display = "flex";

        // 點擊取消
        const onCancel = () => {
            modal.style.display = "none";
            cleanup();
            resolve(false); // 回傳 false
        };

        // 點擊確定
        const onOk = () => {
            modal.style.display = "none";
            cleanup();
            resolve(true); // 回傳 true
        };

        // 避免重複綁定事件
        const cleanup = () => {
            cancelBtn.removeEventListener("click", onCancel);
            okBtn.removeEventListener("click", onOk);
        };

        cancelBtn.addEventListener("click", onCancel);
        okBtn.addEventListener("click", onOk);
    });
}

// ================= 更新：取消預約 API =================
async function handleCancelBooking() {
    // 呼叫自訂視窗，並等待使用者點擊（取代原本的 window.confirm）
    const isConfirmed = await showCustomConfirm("確定要取消這個時段嗎？\n此動作無法復原。", "確定取消", "#dc3545");
    
    if (isConfirmed) {
        const { error } = await supabaseClient.from('bookings').delete().eq('id', currentDetailBooking.id);
        if (error) {
            alert("取消失敗，請稍後再試。");
            console.error(error);
        } else {
            document.getElementById("detail-modal").style.display = "none";
            fetchAndRenderBookings();
        }
    }
}

// ================= 更新：確定預約 API (教練專用) =================
async function handleConfirmBooking() {
    // 教練確認預約時，按鈕改用藍色
    const isConfirmed = await showCustomConfirm(`確定要接受「${currentDetailBooking.user_name}」的預約嗎？`, "確定接受", "#007bff");
    
    if (isConfirmed) {
        const { error } = await supabaseClient.from('bookings').update({ status: 'confirmed' }).eq('id', currentDetailBooking.id);
        if (error) {
            alert("確認失敗，請稍後再試。");
            console.error(error);
        } else {
            document.getElementById("detail-modal").style.display = "none";
            fetchAndRenderBookings();
        }
    }
}

// ================= Modal 與表單邏輯 =================

function setupModalListeners() {
    // 預約表單監聽
    document.getElementById("close-modal").addEventListener("click", () => {
        document.getElementById("booking-modal").style.display = "none";
    });
    document.getElementById("booking-form").addEventListener("submit", handleBookingSubmit);

    // 詳細資訊表單監聽
    document.getElementById("close-detail-modal").addEventListener("click", () => {
        document.getElementById("detail-modal").style.display = "none";
    });
    document.getElementById("detail-cancel-btn").addEventListener("click", handleCancelBooking);
    document.getElementById("detail-confirm-btn").addEventListener("click", handleConfirmBooking);
}

function openBookingModal(timeString) {
    selectedStartTime = timeString;
    document.getElementById("modal-time-display").textContent = `日期：${currentSelectedDate} | 時間：${timeString}`;
    document.getElementById("booking-form").reset();
    document.getElementById("booking-modal").style.display = "flex";
}

// 時間字串轉分鐘 (例如 "08:30" -> 510)
function timeToMins(timeStr) {
    let parts = timeStr.split(':');
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

// 送出預約
async function handleBookingSubmit(e) {
    e.preventDefault();

    const durationMins = parseInt(document.getElementById("duration-select").value);
    const newStartMins = timeToMins(selectedStartTime);
    const newEndMins = newStartMins + durationMins;

    // 防呆邏輯：檢查重疊
    let hasConflict = todaysBookings.some(existing => {
        let exStart = timeToMins(existing.start_time);
        let exEnd = exStart + existing.duration_mins;
        return (newStartMins < exEnd) && (newEndMins > exStart);
    });

    if (hasConflict) {
        alert("時間段衝突，無法預約");
        return; 
    }

    // 寫入資料庫
    let insertData = {
        booking_date: currentSelectedDate,
        start_time: selectedStartTime,
        duration_mins: durationMins,
        status: 'pending', // 預設皆為 pending
        user_line_id: currentUserProfile.userId,
        user_name: currentUserProfile.displayName,
        participants: parseInt(document.getElementById("participants-input").value),
        location: document.getElementById("location-select").value,
        is_first_trial: document.getElementById("first-trial-checkbox").checked,
        note: document.getElementById("note-input").value
    };

    document.getElementById("submit-booking-btn").textContent = "處理中...";
    const { error } = await supabaseClient.from('bookings').insert([insertData]);
    document.getElementById("submit-booking-btn").textContent = "送出預約";

    if (error) {
        console.error("預約失敗", error);
        alert("系統發生錯誤，請稍後再試。");
    } else {
        document.getElementById("booking-modal").style.display = "none";
        fetchAndRenderBookings();
    }
}

// ================= 2. 編輯模式切換邏輯 =================
function setupEditModeListeners() {
    const toggleBtn = document.getElementById("toggle-edit-btn");
    const saveBtn = document.getElementById("save-lock-btn");

    toggleBtn.addEventListener("click", () => {
        isEditMode = !isEditMode;
        if (isEditMode) {
            document.body.classList.add("edit-mode");
            toggleBtn.textContent = "取消";
            toggleBtn.style.backgroundColor = "#6c757d"; 
            saveBtn.style.display = "block";
            saveBtn.textContent = "保存"; // 【新增】每次進入都重置為保存
            prepareGridForPainting();
        } else {
            // 退出編輯模式
            document.body.classList.remove("edit-mode");
            toggleBtn.textContent = "鎖定時段";
            toggleBtn.style.backgroundColor = "#dc3545"; // 紅色
            saveBtn.style.display = "none";
            fetchAndRenderBookings(); // 放棄修改，重新拉取原始資料
        }
    });

    saveBtn.addEventListener("click", handleSaveLocks);
}

// 將資料庫的 locked 狀態轉換為畫布上的格子顏色
function prepareGridForPainting() {
    // 1. 清空所有格子的塗色
    document.querySelectorAll('.time-slot').forEach(slot => {
        slot.classList.remove('is-painting-locked');
    });

    // 2. 找出今天的鎖定資料，把它們拆解成 30 分鐘單位塗上顏色
    todaysBookings.forEach(booking => {
        if (booking.status === 'locked') {
            let startMins = timeToMins(booking.start_time);
            let endMins = startMins + booking.duration_mins;
            
            for (let m = startMins; m < endMins; m += 30) {
                let hour = Math.floor(m / 60).toString().padStart(2, '0');
                let min = (m % 60 === 0) ? '00' : '30';
                let slot = document.getElementById(`slot-${hour}${min}`);
                if (slot) slot.classList.add('is-painting-locked');
            }
        }
    });
    
    // 初始化拖曳監聽器
    initDragToSelect();
}

// ================= 3. iPhone 相簿風格：拖曳塗鴉與自動捲動 =================
function autoScrollLoop() {
    if (!isDragging || scrollSpeed === 0) {
        isScrolling = false;
        return;
    }
    window.scrollBy(0, scrollSpeed);
    requestAnimationFrame(autoScrollLoop);
}

function initDragToSelect() {
    const grid = document.getElementById("time-grid");
    grid.replaceWith(grid.cloneNode(true)); 
    const newGrid = document.getElementById("time-grid");

    // 統一使用 Pointer Events (完美解決手機點按與拖曳衝突)
    const startDrag = (e) => {
        if (!isEditMode) return;
        
        // 取得當前點擊的格子
        const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.time-slot');
        if (!target) return;
        
        const hasBooking = Array.from(target.children).some(child => !child.classList.contains('status-locked'));
        if (hasBooking) return;

        isDragging = true;
        // 讓瀏覽器持續追蹤這根手指，即便滑到螢幕外
        newGrid.setPointerCapture(e.pointerId); 
        
        dragAction = target.classList.contains('is-painting-locked') ? 'unlock' : 'lock';
        paintSlot(target);
    };

    const moveDrag = (e) => {
        if (!isDragging || !isEditMode) return;
        
        // 塗鴉邏輯
        const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.time-slot');
        if (target) {
            const hasBooking = Array.from(target.children).some(child => !child.classList.contains('status-locked'));
            if (!hasBooking) paintSlot(target);
        }

        // ================= 動態變速捲動演算法 =================
        const clientY = e.clientY;
        const threshold = 100; // 距離螢幕邊緣 120px 內開始觸發
        const maxSpeed = 20;   // 靠最邊緣時的最大捲動速度

        if (clientY < threshold) {
            // 越靠近上方，速度越快 (負值)
            scrollSpeed = -((threshold - clientY) / threshold) * maxSpeed;
        } else if (window.innerHeight - clientY < threshold) {
            // 越靠近下方，速度越快 (正值)
            scrollSpeed = ((threshold - (window.innerHeight - clientY)) / threshold) * maxSpeed;
        } else {
            scrollSpeed = 0;
        }

        // 啟動捲動馬達
        if (scrollSpeed !== 0 && !isScrolling) {
            isScrolling = true;
            requestAnimationFrame(autoScrollLoop);
        }
    };

    const endDrag = (e) => {
        isDragging = false;
        scrollSpeed = 0;
        dragAction = null;
        newGrid.releasePointerCapture(e.pointerId);
    };

    // 綁定現代指標事件
    newGrid.addEventListener('pointerdown', startDrag);
    newGrid.addEventListener('pointermove', moveDrag);
    newGrid.addEventListener('pointerup', endDrag);
    newGrid.addEventListener('pointercancel', endDrag); // 手指滑出螢幕等意外中斷
}

// 輔助函數：取得游標所在的格子
function getSlotFromEvent(e) {
    let clientX = e.touches ? e.touches[0].clientX : e.clientX;
    let clientY = e.touches ? e.touches[0].clientY : e.clientY;
    let element = document.elementFromPoint(clientX, clientY);
    return element ? element.closest('.time-slot') : null;
}

// 輔助函數：上色或擦除
function paintSlot(slot) {
    if (dragAction === 'lock') {
        slot.classList.add('is-painting-locked');
    } else if (dragAction === 'unlock') {
        slot.classList.remove('is-painting-locked');
    }
}

// 輔助函數：平滑自動捲動
function startAutoScroll(amount) {
    if (autoScrollInterval) return;
    autoScrollInterval = setInterval(() => {
        window.scrollBy(0, amount);
    }, 20); // 速度控制
}
function stopAutoScroll() {
    if (autoScrollInterval) {
        clearInterval(autoScrollInterval);
        autoScrollInterval = null;
    }
}

// ================= 4. 保存與重建邏輯 (Delete-and-Recreate) =================
async function handleSaveLocks() {
    const isConfirmed = await showCustomConfirm("確定要保存目前的鎖定時段嗎？", "確定保存", "#007bff");
    if (!isConfirmed) return;

    document.getElementById("save-lock-btn").textContent = "保存中...";

    // 1. 掃描畫面上所有被塗色的格子，合併成連續的時間段
    let newLocks = [];
    let currentLock = null;

    document.querySelectorAll('.time-slot').forEach(slot => {
        let isLocked = slot.classList.contains('is-painting-locked');
        let timeId = slot.id.replace('slot-', ''); // e.g. "0830"
        let timeStr = `${timeId.substring(0,2)}:${timeId.substring(2,4)}`;
        let currentMins = timeToMins(timeStr);

        if (isLocked) {
            if (!currentLock) {
                // 開啟一個新的連續區段
                currentLock = { start_time: timeStr, duration_mins: 30 };
            } else {
                // 延續上一個區段
                currentLock.duration_mins += 30;
            }
        } else {
            if (currentLock) {
                // 區段結束，存入陣列
                newLocks.push(currentLock);
                currentLock = null;
            }
        }
    });
    // 處理最後一個卡在 22:00 結束的區段
    if (currentLock) newLocks.push(currentLock);

    // 2. 刪除該日舊有的所有臨時鎖定資料
    const { error: deleteError } = await supabaseClient
        .from('bookings')
        .delete()
        .eq('booking_date', currentSelectedDate)
        .eq('status', 'locked');

    if (deleteError) {
        alert("保存失敗：清除舊資料錯誤");
        return;
    }

    // 3. 寫入新的連續鎖定資料
    if (newLocks.length > 0) {
        const insertData = newLocks.map(lock => ({
            booking_date: currentSelectedDate,
            start_time: lock.start_time,
            duration_mins: lock.duration_mins,
            status: 'locked'
        }));

        const { error: insertError } = await supabaseClient.from('bookings').insert(insertData);
        if (insertError) {
            alert("保存失敗：寫入新資料錯誤");
            return;
        }
    }

    // 成功後退出編輯模式
    document.getElementById("save-lock-btn").textContent = "保存";
    document.getElementById("toggle-edit-btn").click(); 
}