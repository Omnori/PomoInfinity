
// background.js

let clocks = [];

const DEFAULT_SETTINGS = {
    theme: "default",
    soundEnabled: true,
    desktopNotifEnabled: true,
    autoCycle: false,
    cyclesBeforeLongBreak: 4,
};

const DEFAULT_STATS = {
    sessionsCompleted: 0,
    totalFocusedSeconds: 0,
    workCyclesSinceLongBreak: 0,
    streak: 0,
    lastActiveDate: null, // "YYYY-MM-DD"
    dailyLog: {}, // { "YYYY-MM-DD": { sessions, seconds } }
};

let settings = { ...DEFAULT_SETTINGS };
let stats = { ...DEFAULT_STATS };

// --- 1. The Clock Logic (Moved here) ---
class Clock {
    constructor(name, timeStr, savedData = {}) {
        this.createdtime = savedData.createdtime ? savedData.createdtime : new Date().getTime().toString();
        this.clockid = savedData.clockid || `CID${this.createdtime}`;
        this.clockname = name;
        this.clocktype = savedData.clocktype || "custom"; // "work" | "break" | "custom"

        this.clocktime = timeStr.split(":");
        if (savedData.clockhrs !== undefined) {
            this.clockhrs = savedData.clockhrs;
            this.clockmins = savedData.clockmins;
            this.clockseconds = savedData.clockseconds;
        }
        else {
            const parts = timeStr.split(":");
            this.clockhrs = Number(parts[0]);
            this.clockmins = Number(parts[1]);
            this.clockseconds = Number(parts[2]);
        }
        this.ispaused = savedData.ispaused !== undefined ? savedData.ispaused : false;
        this.isfinished = savedData.isfinished !== undefined ? savedData.isfinished : false;
        this.isactive = savedData.isactive !== undefined ? savedData.isactive : true;
        this.deleted = savedData.exists !== undefined ? savedData.exists : false;
    }

    totalDurationSeconds() {
        return (Number(this.clocktime[0]) * 3600) + (Number(this.clocktime[1]) * 60) + Number(this.clocktime[2]);
    }

    update() {
        if (!this.ispaused && this.isactive) {
            if (this.clockhrs === 0 && this.clockmins === 0 && this.clockseconds === 0) {
                this.finish();
                return;
            }

            if (this.clockseconds > 0) {
                this.clockseconds--;
            } else {
                this.clockseconds = 59;
                if (this.clockmins > 0) {
                    this.clockmins--;
                } else {
                    this.clockmins = 59;
                    if (this.clockhrs > 0) {
                        this.clockhrs--;
                    }
                }
            }
        }
    }

    // Countdown reached zero on its own.
    finish() {
        this.isactive = false;
        this.ispaused = true;
        this.isfinished = true;
        onClockFinished(this);
    }

    // User pressed the X button.
    close() { this.isactive = false; this.ispaused = true; }

    pause() { this.ispaused = !this.ispaused; }
    reset() {
        [this.clockhrs, this.clockmins, this.clockseconds] = [
            Number(this.clocktime[0]),
            Number(this.clocktime[1]),
            Number(this.clocktime[2]),
        ];
        this.ispaused = false;
        this.isfinished = false;
        this.isactive = true;
    }

}

// --- 2. Side effects when a clock finishes naturally ---
function todayKey() {
    return new Date().toISOString().slice(0, 10);
}

function recordStats(clock) {
    if (clock.clocktype !== "work") return;

    const seconds = clock.totalDurationSeconds();
    stats.sessionsCompleted += 1;
    stats.totalFocusedSeconds += seconds;

    const today = todayKey();
    if (!stats.dailyLog[today]) stats.dailyLog[today] = { sessions: 0, seconds: 0 };
    stats.dailyLog[today].sessions += 1;
    stats.dailyLog[today].seconds += seconds;

    if (stats.lastActiveDate === today) {
        // already active today, streak unchanged
    } else {
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        stats.streak = stats.lastActiveDate === yesterday ? stats.streak + 1 : 1;
        stats.lastActiveDate = today;
    }

    saveStats();
}

function notifyFinished(clock) {
    if (settings.desktopNotifEnabled) {
        chrome.notifications.create(`finish-${clock.clockid}`, {
            type: "basic",
            iconUrl: chrome.runtime.getURL("files/images/logo/logo-128.png"),
            title: "Pomori",
            message: `"${clock.clockname}" finished!`,
            priority: 1,
        });
    }
    if (settings.soundEnabled) {
        playFinishSound();
    }
}

function autoCycle(clock) {
    if (!settings.autoCycle) return;

    if (clock.clocktype === "work") {
        stats.workCyclesSinceLongBreak = (stats.workCyclesSinceLongBreak || 0) + 1;
        const isLong = stats.workCyclesSinceLongBreak >= settings.cyclesBeforeLongBreak;
        if (isLong) stats.workCyclesSinceLongBreak = 0;
        saveStats();

        const breakClock = isLong
            ? new Clock("Long Break", "00:15:00", { clocktype: "break" })
            : new Clock("Break", "00:05:00", { clocktype: "break" });
        clocks.unshift(breakClock);
    } else if (clock.clocktype === "break") {
        const workClock = new Clock("Work", "00:25:00", { clocktype: "work" });
        clocks.unshift(workClock);
    }
}

function onClockFinished(clock) {
    recordStats(clock);
    notifyFinished(clock);
    autoCycle(clock);
}

// --- 3. Offscreen document for playing a sound from the service worker ---
let creatingOffscreen;
async function ensureOffscreenDocument() {
    const existing = await chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
    });
    if (existing.length > 0) return;

    if (creatingOffscreen) {
        await creatingOffscreen;
    } else {
        creatingOffscreen = chrome.offscreen.createDocument({
            url: "files/offscreen.html",
            reasons: ["AUDIO_PLAYBACK"],
            justification: "Play a short sound when a timer finishes",
        });
        await creatingOffscreen;
        creatingOffscreen = null;
    }
}

async function playFinishSound() {
    try {
        await ensureOffscreenDocument();
        chrome.runtime.sendMessage({ action: "playSound" });
    } catch (e) {
        console.log("Could not play sound", e);
    }
}

// --- 4. The Main Loop (Runs forever in background) ---
setInterval(() => {
    if (clocks.length > 0) {
        clocks.forEach(clock => clock.update());
    }

    // adding the badge (based on the first *active* clock, not array position)
    const topActive = clocks.find(c => c.isactive);
    if (topActive && !topActive.ispaused) {
        if (topActive.clockhrs > 0) {
            var text = topActive.clockhrs.toString().padStart(2, "0") + ":" + topActive.clockmins.toString().padStart(2, "0");
        } else {
            var text = topActive.clockmins.toString().padStart(2, "0") + ":" + topActive.clockseconds.toString().padStart(2, "0");
        }

        chrome.action.setBadgeText({ text: text });
        chrome.action.setBadgeBackgroundColor({ color: "#282828ff" });
    }
    else {
        chrome.action.setBadgeText({ text: "" }); // Clear it if paused
    }
    saveclocks();
}, 1000);
function deletectime(clock) {
    const index = clocks.indexOf(clock)
    if (index > -1) {
        clocks.splice(index, 1);

    }

}
function saveclocks() {
    chrome.storage.local.set({ pomoClocks: clocks })
}
function saveSettings() {
    chrome.storage.local.set({ pomoSettings: settings });
}
function saveStats() {
    chrome.storage.local.set({ pomoStats: stats });
}
function getsavedclocks() {

    chrome.storage.local.get(["pomoClocks", "pomoSettings", "pomoStats"]).then((result) => {
        const pomoclocks = result.pomoClocks
        if (pomoclocks) {
            pomoclocks.forEach(clock => {
                const newclock = new Clock(clock.clockname, clock.clocktime.join(":"), clock)
                clocks.push(newclock);
            });
        }
        if (result.pomoSettings) settings = { ...DEFAULT_SETTINGS, ...result.pomoSettings };
        if (result.pomoStats) stats = { ...DEFAULT_STATS, ...result.pomoStats };
    })
}
chrome.runtime.onStartup.addListener(() => {
    getsavedclocks()
})
chrome.runtime.onInstalled.addListener(() => {
    getsavedclocks()
})




chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // A. Popup asks for data to draw the UI
    if (request.action === "getClocks") {
        sendResponse({ clocks: clocks });
    }

    // B. Popup wants to add a clock
    else if (request.action === "add") {
        const newClock = new Clock(request.name, request.time, { clocktype: request.clocktype || "custom" });
        clocks.push(newClock);
        sendResponse({ status: "success" });
    }

    else if (request.action === "reorder") {
        const order = request.order; // array of clockids in desired order
        const byId = new Map(clocks.map(c => [c.clockid, c]));
        const reordered = order.map(id => byId.get(id)).filter(Boolean);
        const remaining = clocks.filter(c => !order.includes(c.clockid));
        clocks = [...reordered, ...remaining];
        sendResponse({ status: "reordered" });
    }

    else if (request.action === "getSettings") {
        sendResponse({ settings: settings });
    }

    else if (request.action === "setSettings") {
        settings = { ...settings, ...request.settings };
        saveSettings();
        sendResponse({ settings: settings });
    }

    else if (request.action === "getStats") {
        sendResponse({ stats: stats });
    }

    // C. Popup wants to pause/close/reset
    else {
        const targetClock = clocks.find(c => c.clockid === request.id);
        if (targetClock) {
            if (request.action === "pause") targetClock.pause();
            if (request.action === "close") targetClock.close();
            if (request.action === "reset") targetClock.reset();
            if (request.action === "remove") deletectime(targetClock);

            // Sort logic (rearrange) inside background now
            clocks.sort((a, b) => {
                if (a.ispaused === b.ispaused) return 0;
                return a.ispaused ? 1 : -1;
            });
        }
        sendResponse({ status: "updated" });
    }
});
