const COACH_LINE_ID = "5487-777-877"; 
const MY_LIFF_ID = "2010678137-EkdnuUi9";

const SUPABASE_URL = 'https://qjthdrxrssordalufwhb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_ck-5xYAyrCAlrqSnaPKeSQ_h2fbGmwo';

const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

document.addEventListener("DOMContentLoaded", () => {
    generateDateCarousel();
    initializeLiff(MY_LIFF_ID);
});

async function testInsertBooking() {
    console.log("嘗試寫入資料到 Supabase...");
    
    const { data, error } = await supabase
        .from('bookings')
        .insert([
            {
                booking_date: '2026-07-14',
                start_time: '08:00',
                duration_mins: 120,
                status: 'pending',
                user_line_id: 'U1234567890test',
                user_name: '測試學員A',
                participants: 2,
                location: '大安運動中心',
                is_first_trial: true,
                note: '教練好，我想練殺球'
            }
        ]);

    if (error) {
        console.error("寫入失敗：", error);
    } else {
        console.log("寫入成功！", data);
        alert("成功連接 Supabase 並寫入一筆測試資料！");
    }
}

setTimeout(testInsertBooking, 3000);

function initializeLiff(myLiffId) {
    // 【加入本地測試模式】如果沒填真實 ID，直接模擬登入成功
    if (myLiffId === "2010678137") {
        console.log("進入本地測試模式...");
        document.getElementById("user-name").textContent = "開發者 (測試中)";
        document.getElementById("time-grid").innerHTML = ""; // 清空錯誤訊息
        renderTimeGrid(); // 畫出時間表
        return;
    }

    liff.init({ liffId: myLiffId })
        .then(() => {
            if (liff.isLoggedIn()) getUserProfile();
            else liff.login();
        })
        .catch((err) => {
            console.error("LIFF 初始化失敗", err);
            document.getElementById("time-grid").innerHTML = `<p style="color:red; padding:20px;">系統初始化失敗：${err.message}</p>`;
        });
}

function getUserProfile() {
    liff.getProfile().then((profile) => {
        document.getElementById("user-name").textContent = profile.displayName;
        if (profile.pictureUrl) document.getElementById("user-avatar").src = profile.pictureUrl;
        
        if (profile.userId === COACH_LINE_ID) {
            document.getElementById("role-badge").style.display = "inline-block";
        }
        
        document.getElementById("time-grid").innerHTML = "";
        renderTimeGrid(); // 拿到資料後，畫出時間表
    }).catch(err => console.error(err));
}

function generateDateCarousel() {
    const carousel = document.getElementById("date-carousel");
    carousel.innerHTML = ""; 
    const today = new Date();
    const daysOfWeek = ["日", "一", "二", "三", "四", "五", "六"];
    
    let previousMonth = -1; // 追蹤前一天的月份

    for (let i = 1; i <= 14; i++) {
        let futureDate = new Date(today);
        futureDate.setDate(today.getDate() + i);

        let currentMonth = futureDate.getMonth() + 1; // getMonth 回傳 0-11，所以要 +1
        let day = futureDate.getDate();
        let weekDay = daysOfWeek[futureDate.getDay()];

        // 【新增】如果換月了，插入月份分隔線
        if (previousMonth !== -1 && currentMonth !== previousMonth) {
            let divider = document.createElement("div");
            divider.className = "month-divider";
            divider.innerHTML = `
                <span>${currentMonth}月</span>
                <div class="line"></div>
            `;
            carousel.appendChild(divider);
        }
        previousMonth = currentMonth;

        let btn = document.createElement("div");
        btn.className = "date-btn";
        if (i === 1) btn.classList.add("active"); 
        
        btn.innerHTML = `
            <span>${weekDay}</span>
            <span style="font-size: 20px; font-weight: bold;">${day}</span>
        `;

        btn.addEventListener('click', () => {
            document.querySelectorAll('.date-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            console.log(`切換到日期：${currentMonth}月 ${day}號`);
            // 實務上這裡會呼叫後端 API 重新撈取該日期的課表
            // renderTimeGrid(); // 點擊後重新渲染並載入當天資料
        });

        carousel.appendChild(btn);
    }
}

// 畫出 08:00 到 22:00 的時間網格
function renderTimeGrid() {
    const timeGrid = document.getElementById("time-grid");
    timeGrid.innerHTML = ""; // 清空畫布

    for (let hour = 8; hour <= 21; hour++) {
        ['00', '30'].forEach(minute => {
            let timeString = `${hour.toString().padStart(2, '0')}:${minute}`;
            
            let row = document.createElement("div");
            row.className = "time-row";
            
            row.innerHTML = `
                <div class="time-label">${timeString}</div>
                <div class="time-slot" id="slot-${timeString.replace(':', '')}">
                    <!-- 預約色塊會透過 addBooking 塞在這裡 -->
                </div>
            `;
            timeGrid.appendChild(row);
        });
    }

    insertMockBookings();
}

// 塞入假資料來預覽介面 (現在加入 duration 分鐘數)
function insertMockBookings() {
    // 參數：(開始時間, 狀態, 標題, 副標題, 分鐘數, 是否為自己的預約)
    
    // 範例一：08:00 開始，長度 120 分鐘 (2 小時)
    addBooking("0800", "confirmed", "羽球訓練", "大安運動中心", 120, true);
    
    // 範例二：14:30 開始，長度 60 分鐘 (1 小時)，別人的預約
    addBooking("1430", "pending", "待確定預約", "信義運動中心", 60, false);
    
    // 範例三：19:00 開始，長度 90 分鐘 (1.5 小時)，鎖定狀態
    addBooking("1900", "locked", "教練休息時段", "", 90, false);
}

// 【新增核心功能】根據時間長度，動態生成預約色塊
function addBooking(timeId, status, title, subtitle, durationMins, isMine) {
    const slot = document.getElementById(`slot-${timeId}`);
    if (!slot) return;
    
    // 計算需要跨越的格數 (30分鐘 = 1格)
    const slotsSpanned = Math.ceil(durationMins / 30);
    
    let block = document.createElement("div");
    let statusClass = `status-${status}`;
    let mineClass = isMine ? "my-booking" : "";
    block.className = `booking-block ${statusClass} ${mineClass}`;
    
    // 計算高度：每一格 100% 高度 + (跨越格數 - 1) px 來覆蓋邊框線條
    block.style.height = `calc(${slotsSpanned * 100}% + ${slotsSpanned - 1}px)`;
    
    // 將分鐘數轉換為小時顯示
    const hoursText = durationMins >= 60 ? `(${durationMins / 60}小時)` : '';
    
    block.innerHTML = `
        <div>${title} ${hoursText}</div>
        ${subtitle ? `<div class="booking-info">${subtitle}</div>` : ''}
    `;
    
    slot.appendChild(block);
}