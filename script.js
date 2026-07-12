const COACH_LINE_ID = "5487-777-877"; 
const MY_LIFF_ID = "2010678137-EkdnuUi9";

document.addEventListener("DOMContentLoaded", () => {
    generateDateCarousel();
    initializeLiff(MY_LIFF_ID);
});

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

    for (let i = 1; i <= 14; i++) {
        let futureDate = new Date(today);
        futureDate.setDate(today.getDate() + i);

        let day = futureDate.getDate();
        let weekDay = daysOfWeek[futureDate.getDay()];

        let btn = document.createElement("div");
        btn.className = "date-btn";
        if (i === 1) btn.classList.add("active"); 
        
        btn.innerHTML = `
            <span>${weekDay}</span>
            <span style="font-size: 20px; font-weight: bold;">${day}</span>
        `;

        // 【新增】點擊事件監聽器
        btn.addEventListener('click', () => {
            // 1. 把所有按鈕的 active 狀態移除
            document.querySelectorAll('.date-btn').forEach(b => b.classList.remove('active'));
            // 2. 把當前點擊的按鈕加上 active (變綠色)
            btn.classList.add('active');
            // 3. 實務上這裡會呼叫後端 API 重新撈取該日期的課表
            console.log(`切換到日期：${day}號`);
        });

        carousel.appendChild(btn);
    }
}

// 【新增】畫出 08:00 到 22:00 的時間網格
function renderTimeGrid() {
    const timeGrid = document.getElementById("time-grid");
    timeGrid.innerHTML = ""; // 清空畫布

    // 產生從 8 到 21 的每個小時，分為 00 分與 30 分
    for (let hour = 8; hour <= 21; hour++) {
        ['00', '30'].forEach(minute => {
            let timeString = `${hour.toString().padStart(2, '0')}:${minute}`;
            
            let row = document.createElement("div");
            row.className = "time-row";
            
            row.innerHTML = `
                <div class="time-label">${timeString}</div>
                <div class="time-slot" id="slot-${timeString.replace(':', '')}">
                    <!-- 預約色塊會塞在這裡 -->
                </div>
            `;
            timeGrid.appendChild(row);
        });
    }

    // 畫完網格後，我們手動塞入幾個「假資料」來測試 UI 樣式
    insertMockBookings();
}

// 塞入假預約資料來預覽介面
function insertMockBookings() {
    // 假裝 08:00 有一個「已確定」且是「自己的」預約
    const slot0800 = document.getElementById("slot-0800");
    if(slot0800) {
        slot0800.innerHTML = `
            <div class="booking-block status-confirmed my-booking">
                <div>羽球訓練 (2小時)</div>
                <div class="booking-info">大安運動中心</div>
            </div>
        `;
        // 因為是 2 小時，實務上我們會用 CSS 把這個色塊的高度拉長 (例如跨 4 個 row)，這裡先簡單展示
    }

    // 假裝 14:30 有一個「別人的待確定」預約 (你看不到名字，只看到地點)
    const slot1430 = document.getElementById("slot-1430");
    if(slot1430) {
        slot1430.innerHTML = `
            <div class="booking-block status-pending">
                <div>待確定預約</div>
                <div class="booking-info">信義運動中心</div>
            </div>
        `;
    }

    // 假裝 19:00 是教練鎖定的休息時間
    const slot1900 = document.getElementById("slot-1900");
    if(slot1900) {
        slot1900.innerHTML = `
            <div class="booking-block status-locked">
                <div>教練休息時段</div>
            </div>
        `;
    }
}