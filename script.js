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
        let isMine = (currentUserProfile && booking.user_line_id === currentUserProfile.userId);
        let title = '';
        let subtitle = '';

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
            subtitle = booking.location; 
        }

        // 修改：直接傳遞整包 booking 物件
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
    block.style.height = `calc(${slotsSpanned * 100}% + ${slotsSpanned - 1}px)`;
    
    const hoursText = booking.duration_mins >= 60 ? `(${booking.duration_mins / 60}h)` : '';
    block.innerHTML = `<div>${title} ${hoursText}</div>${subtitle ? `<div class="booking-info">${subtitle}</div>` : ''}`;
    
    // 綁定點擊開啟詳情
    block.addEventListener('click', (e) => {
        e.stopPropagation(); 
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

// 取消預約 API
async function handleCancelBooking() {
    if (confirm("確定要取消這個時段嗎？")) {
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

// 確定預約 API (教練專用)
async function handleConfirmBooking() {
    if (confirm("確定要接受這筆預約嗎？")) {
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