const COACH_LINE_ID = "Uebc116558da54785e0c7671baa01a172"; 
const MY_LIFF_ID = "2010678137-EkdnuUi9";
const SUPABASE_URL = 'https://qjthdrxrssordalufwhb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_ck-5xYAyrCAlrqSnaPKeSQ_h2fbGmwo';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 狀態變數
let currentUserIsAdmin = false;  // 是否為總教練
let currentUserIsCoach = false;  // 是否有教練身份 (決定會不會出現在選單)
let coachesList = [];         // 儲存從資料庫抓下來的教練名單
let currentSelectedCoachId = ''; // 畫面當下正在顯示哪位教練的時間表
let currentSelectedDate = ''; // 格式 YYYY-MM-DD
let selectedStartTime = '';   // 格式 HH:mm
let todaysBookings = [];      // 儲存當前選定日期的所有預約，供防呆檢查
let currentDetailBooking = null;
let lockedDatesMap = {};
let calendarInstance = null;

let isEditMode = false;
let isDragging = false;
let dragAction = null; // 'lock' 或 'unlock' (根據按下去的第一格決定)
let autoScrollInterval = null;
let scrollSpeed = 0;
let isScrolling = false;
let draftLocksMap = {};
let editedDates = new Set();

// 測試用
// let avatarClickCount = 0;

document.addEventListener("DOMContentLoaded", () => {
    setupModalListeners();
    initializeLiff(MY_LIFF_ID);
    initCalendar();
});

async function sendLineNotification(targetUserId, messageText, flexPayload = null) {
    try {
        const { data, error } = await supabaseClient.functions.invoke('line-notify', {
            body: { 
                userId: targetUserId, 
                message: messageText,
                flexPayload: flexPayload // 🟢 將 Flex JSON 一併傳給後端
            }
        });

        if (error) throw error;
        console.log("推播成功", data);
    } catch (err) {
        console.error("推播失敗", err);
    }
}

function buildFlexMessage(statusText, titleText, subtitleText, detailsArray, themeColor) {
    // 將傳入的明細陣列轉換為 Flex Message 的水平橫排格式
    const detailBoxes = detailsArray.map(item => ({
        type: "box",
        layout: "horizontal",
        margin: "md",
        contents: [
            { type: "text", text: item.label, size: "sm", color: "#666666", flex: 2 },
            { type: "text", text: item.value, size: "sm", color: "#111111", flex: 5, align: "end", wrap: true, weight: "bold" }
        ]
    }));

    return {
        type: "flex",
        altText: titleText, // 顯示在聊天列表列的預覽文字
        contents: {
            type: "bubble",
            body: {
                type: "box",
                layout: "vertical",
                contents: [
                    // 頂部狀態文字 (例如： - 已接單 -)
                    { type: "text", text: `- ${statusText} -`, color: themeColor, size: "sm", weight: "bold" },
                    // 大標題
                    { type: "text", text: titleText, weight: "bold", size: "xl", margin: "md" },
                    // 副標題
                    { type: "text", text: subtitleText, size: "xs", color: "#aaaaaa", margin: "sm" },
                    // 🟢 核心：圓角灰底資訊方塊 (精準還原你的附圖)
                    {
                        type: "box",
                        layout: "vertical",
                        margin: "lg",
                        backgroundColor: "#f8f9fa", // 淺灰底色
                        cornerRadius: "12px",       // 圓角
                        paddingAll: "16px",         // 內邊距
                        contents: detailBoxes
                    }
                ]
            }
        }
    };
}

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

async function finishLogin() {
    // 1. 查詢當前使用者的雙重權限
    const { data: roleData, error } = await supabaseClient
        .from('user_roles')
        .select('is_admin, is_coach')
        .eq('line_id', currentUserProfile.userId)
        .single();

    if (error) console.warn("讀取權限失敗 (或查無此人):", error);

    if (roleData) {
        currentUserIsAdmin = roleData.is_admin;
        currentUserIsCoach = roleData.is_coach;
    }

    document.getElementById("user-name").textContent = currentUserProfile.displayName;
    if (currentUserProfile.pictureUrl) document.getElementById("user-avatar").src = currentUserProfile.pictureUrl;
    
    const { data: coaches } = await supabaseClient
        .from('user_roles')
        .select('line_id, display_name')
        .eq('is_coach', true); 

    coachesList = coaches || [];

    // 3. 設定預設顯示的教練
    if (coachesList.length > 0) {
        // 如果自己是教練，預設看自己的表；否則看列表第一位
        if (currentUserIsCoach) {
            currentSelectedCoachId = currentUserProfile.userId;
        } else {
            currentSelectedCoachId = coachesList[0].line_id;
        }
    }

    renderCoachSelector();
    updateUIByRoleAndCoach();
    
    await fetchThirtyDaysLocks(); 
    initCalendar();
    fetchAndRenderBookings();
}

// 預先撈取未來 30 天的鎖定資料
async function fetchThirtyDaysLocks() {
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(today.getDate() + 30); // 擴展為 30 天

    const startStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    const endStr = `${endDate.getFullYear()}-${String(endDate.getMonth()+1).padStart(2,'0')}-${String(endDate.getDate()).padStart(2,'0')}`;

    const { data, error } = await supabaseClient
        .from('bookings')
        .select('booking_date, duration_mins, status')
        .gte('booking_date', startStr)
        .lte('booking_date', endStr)
        .eq('coach_line_id', currentSelectedCoachId);

    lockedDatesMap = {}; 
    if (!error && data) {
        data.forEach(item => {
            if (!lockedDatesMap[item.booking_date]) {
                lockedDatesMap[item.booking_date] = { totalMins: 0, count: 0 };
            }
            // 如果是鎖定，計入鎖定時間；如果是一般預約，計入有約數量
            if (item.status === 'locked') {
                lockedDatesMap[item.booking_date].totalMins += item.duration_mins;
            } else {
                lockedDatesMap[item.booking_date].count += 1;
            }
        });
    }
}

function initCalendar() {
    const today = new Date();
    const maxDate = new Date();
    maxDate.setDate(today.getDate() + 30); // 限制只能約一個月內

    // 預設日期設定為今天 (如果尚未選定)
    if (!currentSelectedDate) {
        currentSelectedDate = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    }
    document.getElementById("current-date-text").textContent = currentSelectedDate;

    // 將 Flatpickr 綁定在我們設計的 #date-picker-bar 上
    calendarInstance = flatpickr("#date-picker-bar", {
        locale: "zh",               // 繁體中文
        defaultDate: currentSelectedDate,
        minDate: "today",           // 過去日期不可選
        maxDate: maxDate,           // 最多選到 30 天後
        disableMobile: "true",      // 強制使用 Flatpickr 的精美介面，不使用手機原生難看的 UI
        
        // 🟢 核心鉤子：每次月曆渲染日期格子時，自動繪製紅點與打叉
        onDayCreate: function(dObj, dStr, fp, dayElem) {
            const dateStr = fp.formatDate(dayElem.dateObj, "Y-m-d");
            const dayInfo = lockedDatesMap[dateStr];

            if (dayInfo) {
                // 如果鎖定時間超過 840 分鐘 (14小時，代表整天營業時間都鎖了)，標記全日鎖定
                if (dayInfo.totalMins >= 840) {
                    dayElem.classList.add("is-fully-locked");
                } 
                // 如果該天有部分鎖定或是已有其他預約，下方加入紅點提示
                else if (dayInfo.totalMins > 0 || dayInfo.count > 0) {
                    dayElem.classList.add("has-locks");
                }
            }
        },

        // 🟢 當使用者點選了新日期
        onChange: function(selectedDates, dateStr, instance) {
            if (isEditMode) saveCurrentGridToDraft(); // 支援教練模式換日自動暫存
            
            currentSelectedDate = dateStr;
            document.getElementById("current-date-text").textContent = dateStr;
            fetchAndRenderBookings(); 
        }
    });
}

// 渲染教練下拉式選單
function renderCoachSelector() {
    // 假設你在 HTML 中新增了一個 <select id="coach-selector"></select>
    const selector = document.getElementById("coach-selector");
    if (!selector) return;

    selector.innerHTML = "";
    coachesList.forEach(coach => {
        let option = document.createElement("option");
        option.value = coach.line_id;
        option.textContent = coach.display_name;
        if (coach.line_id === currentSelectedCoachId) {
            option.selected = true;
        }
        selector.appendChild(option);
    });

    // 當切換教練時，重新計算權限並重新抓資料
    selector.addEventListener("change", async (e) => {
        currentSelectedCoachId = e.target.value;
        
        // 切換教練時，強制退出編輯模式以策安全
        if (isEditMode) document.getElementById("toggle-edit-btn").click();
        
        updateUIByRoleAndCoach();
        await fetchThirtyDaysLocks();
        
        if (calendarInstance) calendarInstance.redraw(); // 更新月曆紅點
        fetchAndRenderBookings(); 
    });
}

// 根據身分與目前查看的教練，動態顯示/隱藏編輯按鈕
function updateUIByRoleAndCoach() {
    const editControls = document.getElementById("coach-edit-controls");
    const roleBadge = document.getElementById("role-badge");

    const canManageThisSchedule = currentUserIsAdmin || (currentUserIsCoach && currentSelectedCoachId === currentUserProfile.userId);

    if (canManageThisSchedule) {
        editControls.style.display = "flex";
        setupEditModeListeners(); // 確保事件綁定
    } else {
        editControls.style.display = "none";
    }

    // 顯示身分徽章
    if (currentUserIsAdmin || currentUserIsCoach) {
        roleBadge.style.display = "inline-block";
        roleBadge.textContent = currentUserIsAdmin ? "管理員" : "教練";
    }
}

// 核心：從資料庫撈取並渲染網格
async function fetchAndRenderBookings() {
    renderEmptyTimeGrid(); 
    
    const { data, error } = await supabaseClient
        .from('bookings')
        .select('*')
        .eq('booking_date', currentSelectedDate)
        .eq('coach_line_id', currentSelectedCoachId);

    if (error) {
        console.error("讀取資料失敗：", error);
        return;
    }

    todaysBookings = data; 

    data.forEach(booking => {
        const canManageThisSchedule = currentUserIsAdmin || (currentUserIsCoach && currentSelectedCoachId === currentUserProfile.userId);
        const isNormalUser = !currentUserIsAdmin && !currentUserIsCoach;
        
        let isMine = isNormalUser && (currentUserProfile && booking.user_line_id === currentUserProfile.userId);
        
        let title = '';
        let subtitle = '';

        if (booking.status === 'locked') {
            title = "無法預約";
            subtitle = "";
        } else if (canManageThisSchedule) {
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

    if (isEditMode) {
        prepareGridForPainting();
    }
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
                
                // 🟢 【新增】防呆邏輯：普通使用者不能預約今天
                const today = new Date();
                const todayString = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
                
                if (currentSelectedDate === todayString && currentUserRole === 'user') {
                    // 使用我們寫好的 Custom Confirm 來顯示提示，並且只有單個「我知道了」按鈕
                    showCustomConfirm("最早只能從明日開始預約\n如需今日預約請聯繫教練", "我知道了", "#dc3545");
                    return; // 終止執行，不打開預約表單
                }

                openBookingModal(timeString);
            });

            timeGrid.appendChild(row);
        });
    }
}

// 在 addBooking 函數中，綁定點擊事件
// 核心：畫出色塊，並綁定點擊邏輯
function addBooking(booking, title, subtitle, isMine) {
    const timeId = booking.start_time.replace(':', '');
    const slot = document.getElementById(`slot-${timeId}`);
    if (!slot) return;
    
    const slotsSpanned = Math.ceil(booking.duration_mins / 30);
    let block = document.createElement("div");
    block.className = `booking-block status-${booking.status} ${isMine ? "my-booking" : ""}`;
    block.style.height = `calc(${slotsSpanned * 100}% + ${slotsSpanned - 1}px - 6px)`;
    
    const hoursText = (booking.duration_mins >= 60 && booking.status !== 'locked') ? `(${booking.duration_mins / 60}h)` : '';
    const canManageThisSchedule = currentUserIsAdmin || (currentUserIsCoach && currentSelectedCoachId === currentUserProfile.userId);

    // 🟢 【新增】判斷是否為首次試上，並且只有教練或本人才看得到
    let trialHtml = '';
    if (booking.is_first_trial && (canManageThisSchedule || isMine) && booking.status !== 'locked') {
        // 使用原本的 trial-badge 類別，但稍微覆寫大小以適應小色塊
        trialHtml = `<span class="trial-badge" style="font-size: 10px; padding: 2px 6px; margin-left: 4px;">首次試上</span>`;
    }

    // 將 trialHtml 變數加到 div 裡面
    block.innerHTML = `<div>${title} ${hoursText} ${trialHtml}</div>${subtitle ? `<div class="booking-info">${subtitle}</div>` : ''}`;

    // 綁定點擊開啟詳情
    block.addEventListener('click', (e) => {
        e.stopPropagation(); 
        
        if (booking.status === 'locked') return;

        if (canManageThisSchedule || isMine) {
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

    const canManageThisSchedule = currentUserIsAdmin || (currentUserIsCoach && currentSelectedCoachId === currentUserProfile.userId);
    const isNormalUser = !currentUserIsAdmin && !currentUserIsCoach;

    // 取消按鈕邏輯：學員不能取消 confirmed
    if (booking.status === 'confirmed' && isNormalUser) {
        cancelBtn.style.display = "none"; 
    } else {
        cancelBtn.style.display = "block";
    }

    // 確認按鈕邏輯：只有教練且 pending 才顯示
    if (canManageThisSchedule && booking.status === 'pending') {
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

// 取消預約
async function handleCancelBooking() {
    const isConfirmed = await showCustomConfirm("確定要取消這個時段嗎？\n此動作無法復原。", "確定取消", "#dc3545");
    
    const canManageThisSchedule = currentUserIsAdmin || (currentUserIsCoach && currentSelectedCoachId === currentUserProfile.userId);
    
    if (isConfirmed) {
        const { error } = await supabaseClient.from('bookings').delete().eq('id', currentDetailBooking.id);
        if (error) {
            alert("取消失敗，請稍後再試。");
            console.error(error);
        } else {
            document.getElementById("detail-modal").style.display = "none";
            fetchAndRenderBookings();

            const targetStudentId = currentDetailBooking.user_line_id;
            
            // 動態判斷
            const statusText = "已取消";
            const titleText = canManageThisSchedule ? "教練已取消預約" : "您已成功取消預約";
            const subtitleText = canManageThisSchedule ? "若有疑問請聯繫教練" : "該時段已釋出，期待您下次預約";
            const themeColor = "#dc3545"; // 紅色

            const details = [
                { label: "預約人", value: currentDetailBooking.user_name },
                { label: "預約日期", value: currentDetailBooking.booking_date },
                { label: "預約時間", value: currentDetailBooking.start_time },
                { label: "時長", value: `${currentDetailBooking.duration_mins} 分鐘` }
            ];

            const flexCard = buildFlexMessage(statusText, titleText, subtitleText, details, themeColor);
            sendLineNotification(targetStudentId, null, flexCard);
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

            const targetStudentId = currentDetailBooking.user_line_id;
            const details = [
                { label: "預約日期", value: currentDetailBooking.booking_date },
                { label: "預約時間", value: currentDetailBooking.start_time },
                { label: "時長", value: `${currentDetailBooking.duration_mins} 分鐘` },
                { label: "地點", value: currentDetailBooking.location }
            ];

            const flexCard = buildFlexMessage("已確定", "教練已確認預約", "請準時前往上課地點", details, "#00B900");
            sendLineNotification(targetStudentId, null, flexCard);
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

    // 測試用身份切換
    // document.getElementById("user-avatar").addEventListener("click", () => {
    //     avatarClickCount++;
    //     if (avatarClickCount >= 5) {
    //         // 連點五次觸發切換
    //         avatarClickCount = 0; // 歸零
            
    //         // 讀取目前的強制狀態，並反轉
    //         const currentForceRole = sessionStorage.getItem('force_role');
    //         if (currentForceRole === 'coach') {
    //             sessionStorage.setItem('force_role', 'student');
    //             alert("🔄 已切換為【學員視角】，即將重新載入");
    //         } else {
    //             sessionStorage.setItem('force_role', 'coach');
    //             alert("🔄 已切換為【教練視角】，即將重新載入");
    //         }
            
    //         // 重新載入網頁以套用新身分
    //         window.location.reload();
    //     }
    // });
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

    if (newEndMins > 1320) {
        showCustomConfirm("預約時段不可超過 22:00，請重新選擇", "我知道了", "#dc3545");
        return; 
    }

    // 防呆邏輯：檢查重疊
    let hasConflict = todaysBookings.some(existing => {
        let exStart = timeToMins(existing.start_time);
        let exEnd = exStart + existing.duration_mins;
        return (newStartMins < exEnd) && (newEndMins > exStart);
    });

    if (hasConflict) {
        showCustomConfirm("時間段衝突，無法預約", "我知道了", "#dc3545");
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
        coach_line_id: currentSelectedCoachId,
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

        const details = [
            { label: "預約日期", value: currentSelectedDate },
            { label: "預約時間", value: selectedStartTime },
            { label: "時長", value: `${durationMins} 分鐘` },
            { label: "地點", value: insertData.location }
        ];

        const flexCard = buildFlexMessage("待確認", "已送出預約申請", "請等待教練確認此時段", details, "#ffc107"); // 黃色提示
        sendLineNotification(currentUserProfile.userId, null, flexCard);
    }
}

// ================= 2. 編輯模式切換邏輯 =================
function setupEditModeListeners() {
    const toggleBtn = document.getElementById("toggle-edit-btn");
    const saveBtn = document.getElementById("save-lock-btn");
    const selectAllBtn = document.getElementById("select-all-btn");

    toggleBtn.addEventListener("click", () => {
        isEditMode = !isEditMode;
        draftLocksMap = {};
        editedDates.clear();
        if (isEditMode) {
            document.body.classList.add("edit-mode");
            toggleBtn.textContent = "取消";
            toggleBtn.style.backgroundColor = "#6c757d"; 
            saveBtn.style.display = "block";
            saveBtn.textContent = "保存"; 
            selectAllBtn.style.display = "block"; // 顯示全選按鈕
            prepareGridForPainting();
        } else {
            document.body.classList.remove("edit-mode");
            toggleBtn.textContent = "鎖定時段";
            toggleBtn.style.backgroundColor = "#dc3545"; 
            saveBtn.style.display = "none";
            selectAllBtn.style.display = "none"; // 隱藏全選按鈕
            fetchAndRenderBookings(); 
        }
    });

    saveBtn.addEventListener("click", handleSaveLocks);

    // 【新增】全選 / 取消全選邏輯
    selectAllBtn.addEventListener("click", () => {
        const allSlots = document.querySelectorAll('.time-slot');
        
        if (selectAllBtn.textContent === "全選") {
            // 防呆細節一：檢查是否有已存在的非鎖定預約
            const hasBooking = todaysBookings.some(b => b.status !== 'locked');
            if (hasBooking) {
                showCustomConfirm("該日已有預約，無法全選鎖定", "我知道了", "#dc3545");
                return;
            }
            // 執行全選
            allSlots.forEach(slot => slot.classList.add('is-painting-locked'));
        } else {
            // 執行取消全選
            allSlots.forEach(slot => slot.classList.remove('is-painting-locked'));
        }
        updateSelectAllBtnState(); // 更新按鈕文字
    });
}

// 【新增】動態判斷全選按鈕要顯示什麼文字
function updateSelectAllBtnState() {
    if (!isEditMode) return;
    const allSlots = document.querySelectorAll('.time-slot');
    const paintedSlots = document.querySelectorAll('.time-slot.is-painting-locked');
    const selectAllBtn = document.getElementById('select-all-btn');

    if (paintedSlots.length === allSlots.length && allSlots.length > 0) {
        selectAllBtn.textContent = "取消全選";
        selectAllBtn.style.backgroundColor = "#ffc107"; // 變成警告黃色
        selectAllBtn.style.color = "#000";
    } else {
        selectAllBtn.textContent = "全選";
        selectAllBtn.style.backgroundColor = "#17a2b8"; // 變回資訊藍色
        selectAllBtn.style.color = "#fff";
    }
}

// 將資料庫的 locked 狀態轉換為畫布上的格子顏色
// 將資料庫的 locked 狀態轉換為畫布上的格子顏色
function prepareGridForPainting() {
    document.querySelectorAll('.time-slot').forEach(slot => {
        slot.classList.remove('is-painting-locked');
    });

    // 🟢 【修正 3-支援】優先從「暫存草稿」恢復，如果這天還沒被編輯過，才讀取資料庫
    if (editedDates.has(currentSelectedDate)) {
        let savedSlots = draftLocksMap[currentSelectedDate] || [];
        savedSlots.forEach(timeId => {
            let slot = document.getElementById(`slot-${timeId}`);
            if (slot) slot.classList.add('is-painting-locked');
        });
    } else {
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
    }
    
    initDragToSelect();
    updateSelectAllBtnState();
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
        const threshold = 80;
        const maxSpeed = 12;

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
        
        updateSelectAllBtnState(); // 【新增】手指放開時，檢查是否已經全滿
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

    // 1. 先把按下保存當下的這一天存入草稿
    saveCurrentGridToDraft();

    // 檢查是否有做任何修改
    if (editedDates.size === 0) {
        document.getElementById("save-lock-btn").textContent = "保存";
        document.getElementById("toggle-edit-btn").click(); 
        return;
    }

    let allNewLocks = [];
    let datesToDelete = Array.from(editedDates); // 只有被編輯過的天數需要重置

    // 2. 結算所有被修改過的天數
    datesToDelete.forEach(dateStr => {
        let slots = draftLocksMap[dateStr] || [];
        slots.sort(); // 確保時間從小到大排序

        let currentLock = null;
        slots.forEach(timeId => {
            let timeStr = `${timeId.substring(0,2)}:${timeId.substring(2,4)}`;
            
            if (!currentLock) {
                currentLock = { booking_date: dateStr, start_time: timeStr, duration_mins: 30, status: 'locked', coach_line_id: currentSelectedCoachId };
            } else {
                let expectedNextMins = timeToMins(currentLock.start_time) + currentLock.duration_mins;
                if (timeToMins(timeStr) === expectedNextMins) {
                    // 相連的時段，延長長度
                    currentLock.duration_mins += 30;
                } else {
                    // 斷開的時段，先存入上一個，再開一個新的
                    allNewLocks.push(currentLock);
                    currentLock = { booking_date: dateStr, start_time: timeStr, duration_mins: 30, status: 'locked', coach_line_id: currentSelectedCoachId };
                }
            }
        });
        if (currentLock) allNewLocks.push(currentLock);
    });

    // 3. 批次刪除所有編輯過日期的舊鎖定資料
    const { error: deleteError } = await supabaseClient
        .from('bookings')
        .delete()
        .in('booking_date', datesToDelete)
        .eq('status', 'locked')
        .eq('coach_line_id', currentSelectedCoachId);

    if (deleteError) {
        alert("保存失敗：清除舊資料錯誤");
        document.getElementById("save-lock-btn").textContent = "保存";
        return;
    }

    // 4. 批次寫入所有新的鎖定資料
    if (allNewLocks.length > 0) {
        const { error: insertError } = await supabaseClient.from('bookings').insert(allNewLocks);
        if (insertError) {
            alert("保存失敗：寫入新資料錯誤");
            document.getElementById("save-lock-btn").textContent = "保存";
            return;
        }
    }

    // 5. 成功後清空記憶體並退出編輯模式
    draftLocksMap = {};
    editedDates.clear();

    document.getElementById("save-lock-btn").textContent = "保存";
    document.getElementById("toggle-edit-btn").click(); 

    await fetchThirtyDaysLocks();
    calendarInstance.redraw()
}

function saveCurrentGridToDraft() {
    if (!isEditMode) return;
    // 找出畫面上所有被塗成紅色的格子
    const paintedSlots = Array.from(document.querySelectorAll('.time-slot.is-painting-locked'))
                              .map(slot => slot.id.replace('slot-', ''));
    
    draftLocksMap[currentSelectedDate] = paintedSlots;
    editedDates.add(currentSelectedDate);
}