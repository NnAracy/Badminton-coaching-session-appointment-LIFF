const COACH_LINE_ID = "5487-777-877"; 
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
    
    // 登入完成後，撈取當天(第一天)的資料
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
    renderEmptyTimeGrid(); // 先畫出空白網格
    
    const { data, error } = await supabaseClient
        .from('bookings')
        .select('*')
        .eq('booking_date', currentSelectedDate);

    if (error) {
        console.error("讀取資料失敗：", error);
        return;
    }

    todaysBookings = data; // 存起來供等一下防呆檢查用

    data.forEach(booking => {
        let isMine = (currentUserProfile && booking.user_line_id === currentUserProfile.userId);
        let title = '';
        let subtitle = '';

        // 權限與視覺邏輯
        if (booking.status === 'locked') {
            title = "教練休息時段";
        } else if (isCoach) {
            title = `${booking.user_name} (${booking.participants}人)`;
            subtitle = booking.location;
        } else if (isMine) {
            title = `我的預約 (${booking.participants}人)`;
            subtitle = booking.location;
        } else {
            title = booking.status === 'confirmed' ? "已被預約" : "待確定預約";
            subtitle = booking.location; // 別人只能看到地點
        }

        addBooking(booking.start_time.replace(':', ''), booking.status, title, subtitle, booking.duration_mins, isMine);
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

function addBooking(timeId, status, title, subtitle, durationMins, isMine) {
    const slot = document.getElementById(`slot-${timeId}`);
    if (!slot) return;
    
    const slotsSpanned = Math.ceil(durationMins / 30);
    let block = document.createElement("div");
    block.className = `booking-block status-${status} ${isMine ? "my-booking" : ""}`;
    block.style.height = `calc(${slotsSpanned * 100}% + ${slotsSpanned - 1}px)`;
    
    const hoursText = durationMins >= 60 ? `(${durationMins / 60}h)` : '';
    block.innerHTML = `<div>${title} ${hoursText}</div>${subtitle ? `<div class="booking-info">${subtitle}</div>` : ''}`;
    
    // 這裡未來可以加入「點擊色塊看詳情」的監聽器
    
    slot.appendChild(block);
}

// ================= Modal 與表單邏輯 =================

function setupModalListeners() {
    document.getElementById("close-modal").addEventListener("click", () => {
        document.getElementById("booking-modal").style.display = "none";
    });

    document.getElementById("booking-form").addEventListener("submit", handleBookingSubmit);
}

function openBookingModal(timeString) {
    selectedStartTime = timeString;
    document.getElementById("modal-time-display").textContent = `日期：${currentSelectedDate} | 時間：${timeString}`;
    
    // 重置表單
    document.getElementById("booking-form").reset();
    
    // 依據身份顯示特殊選項
    if (isCoach) {
        document.getElementById("coach-options").style.display = "block";
    }

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
    const isLocked = document.getElementById("lock-checkbox")?.checked;
    
    const newStartMins = timeToMins(selectedStartTime);
    const newEndMins = newStartMins + durationMins;

    // 1. 防呆邏輯：檢查重疊 (Collision Detection)
    let hasConflict = todaysBookings.some(existing => {
        let exStart = timeToMins(existing.start_time);
        let exEnd = exStart + existing.duration_mins;
        // 兩個時間段重疊的數學條件：新開始 < 舊結束 且 新結束 > 舊開始
        return (newStartMins < exEnd) && (newEndMins > exStart);
    });

    if (hasConflict) {
        alert("時間段衝突，無法預約");
        return; // 中斷，留在原方塊
    }

    // 2. 準備寫入資料庫
    let insertData = {
        booking_date: currentSelectedDate,
        start_time: selectedStartTime,
        duration_mins: durationMins,
        status: isLocked ? 'locked' : 'pending',
        user_line_id: currentUserProfile.userId,
        user_name: currentUserProfile.displayName,
        participants: parseInt(document.getElementById("participants-input").value),
        location: document.getElementById("location-select").value,
        is_first_trial: document.getElementById("first-trial-checkbox").checked,
        note: document.getElementById("note-input").value
    };

    if (isLocked) {
        // 教練鎖定時不需這些資料
        insertData.participants = null;
        insertData.location = null;
    }

    document.getElementById("submit-booking-btn").textContent = "處理中...";

    const { error } = await supabaseClient.from('bookings').insert([insertData]);

    document.getElementById("submit-booking-btn").textContent = "送出預約";

    if (error) {
        console.error("預約失敗", error);
        alert("系統發生錯誤，請稍後再試。");
    } else {
        // 預約成功：關閉 modal，重新撈取並渲染當天課表
        document.getElementById("booking-modal").style.display = "none";
        fetchAndRenderBookings();
    }
}