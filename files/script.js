
var localClocks = [];
let selectedClockType = "custom";
const notifiedFinishIds = new Set();
const cssroot = document.documentElement;

// --- 1. Polling Loop: Ask background for data every second ---
function syncWithBackground() {
  chrome.runtime.sendMessage({ action: "getClocks" }, (response) => {
    if (response && response.clocks) {
      localClocks = response.clocks;

      // Update UI functions
      loadactiveclocks();
      loadinactiveclocks();

      localClocks.forEach(c => {
        if (c.isfinished && !notifiedFinishIds.has(c.clockid)) {
          notifiedFinishIds.add(c.clockid);
          notif("success", `${c.clockname} finished!`);
        }
      });

      // Main display always reflects the first *active* clock, wherever it sits in the array.
      const topActive = localClocks.find(c => c.isactive && !c.deleted);
      if (topActive) {
        updatemainclock(topActive);
        var timeangel = (topActive.clockseconds / 60) * 360;
        cssroot.style.setProperty("--timeangle", `${timeangel}deg`);
      } else {
        updatemainclock(null);
      }
    }
  });
}

// Run sync immediately and then every second
syncWithBackground();
setInterval(syncWithBackground, 1000);

// --- Settings & Theme ---
let currentSettings = {};

function applyTheme(themeName) {
  cssroot.dataset.theme = themeName || "default";
  document.querySelectorAll(".themeswatch").forEach(sw => {
    sw.classList.toggle("selected", sw.dataset.theme === (themeName || "default"));
  });
}

function loadSettings() {
  chrome.runtime.sendMessage({ action: "getSettings" }, (response) => {
    if (!response || !response.settings) return;
    currentSettings = response.settings;
    applyTheme(currentSettings.theme);
    document.getElementById("togglesound").checked = !!currentSettings.soundEnabled;
    document.getElementById("togglenotif").checked = !!currentSettings.desktopNotifEnabled;
    document.getElementById("toggleautocycle").checked = !!currentSettings.autoCycle;
    document.getElementById("cyclesbeforelong").value = currentSettings.cyclesBeforeLongBreak || 4;
  });
}

function updateSetting(partial) {
  currentSettings = { ...currentSettings, ...partial };
  chrome.runtime.sendMessage({ action: "setSettings", settings: partial });
}

function loadStats() {
  chrome.runtime.sendMessage({ action: "getStats" }, (response) => {
    if (!response || !response.stats) return;
    const stats = response.stats;
    document.getElementById("statsessions").textContent = stats.sessionsCompleted;
    const hrs = Math.floor(stats.totalFocusedSeconds / 3600);
    const mins = Math.floor((stats.totalFocusedSeconds % 3600) / 60);
    document.getElementById("statfocus").textContent = `${hrs}h ${mins}m`;
    document.getElementById("statstreak").textContent = stats.streak;
  });
}

document.querySelectorAll(".themeswatch").forEach(swatch => {
  swatch.addEventListener("click", () => {
    applyTheme(swatch.dataset.theme);
    updateSetting({ theme: swatch.dataset.theme });
  });
});

document.getElementById("togglesound").addEventListener("change", (e) => {
  updateSetting({ soundEnabled: e.target.checked });
});
document.getElementById("togglenotif").addEventListener("change", (e) => {
  updateSetting({ desktopNotifEnabled: e.target.checked });
});
document.getElementById("toggleautocycle").addEventListener("change", (e) => {
  updateSetting({ autoCycle: e.target.checked });
});
document.getElementById("cyclesbeforelong").addEventListener("change", (e) => {
  updateSetting({ cyclesBeforeLongBreak: Number(e.target.value) });
});

function openSettings() {
  document.getElementById("settingspanel").classList.remove("hidden");
  document.getElementById("settingsoverlay").classList.remove("hidden");
  loadSettings();
  loadStats();
}
function closeSettings() {
  document.getElementById("settingspanel").classList.add("hidden");
  document.getElementById("settingsoverlay").classList.add("hidden");
}
document.getElementById("menubtn").addEventListener("click", openSettings);
document.getElementById("closesettings").addEventListener("click", closeSettings);
document.getElementById("settingsoverlay").addEventListener("click", closeSettings);

// --- Mini floating widget ---
document.getElementById("minibtn").addEventListener("click", () => {
  window.open("files/mini.html", "PomoriMini", "width=270,height=270");
});

// --- 2. Button Handlers (Send messages instead of calling functions) ---

// ADD CLOCK
async function addclock() {
  const name = document.getElementById("clockname").value;
  const time = document.getElementById("clocktime").value;

  // Tell background to create it
  chrome.runtime.sendMessage({ action: "add", name: name, time: time, clocktype: selectedClockType }, () => {
    syncWithBackground(); // Update UI immediately
    toglenewclock();
    clearinput();
  });
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
// PAUSE CLOCK
function pauseclock(cid) {
  chrome.runtime.sendMessage({ action: "pause", id: cid }, async () => {
    await sleep(200);
    syncWithBackground()
  })
}

// CLOSE CLOCK
function closetimer(cid) {
  chrome.runtime.sendMessage({ action: "close", id: cid }, async () => {
    await sleep(200);
    syncWithBackground()
  });
}

// RESET CLOCK
function resetclock(cid) {
  chrome.runtime.sendMessage({ action: "reset", id: cid }, async () => {
    await sleep(200);
    syncWithBackground()
  });
}
function removeclock(cid) {
  chrome.runtime.sendMessage({ action: "remove", id: cid }, async () => {
    await sleep(200);
    syncWithBackground()
  });
}
// --- 3. UI Helpers (Mostly unchanged) ---

function formatNumber(num) {
  return num.toString().padStart(2, "0");
}

function loadactiveclocks() {
  const clockcont = document.getElementById("clocklistactive");
  // Use localClocks array received from background
  const htmlContent = localClocks.map(clock => {
    if (!clock.isactive) return "";
    if (clock.deleted)
      return ""

    const timeDisplay = `${formatNumber(clock.clockhrs)}:${formatNumber(clock.clockmins)}:${formatNumber(clock.clockseconds)}`;
    const iconName = clock.ispaused ? "pause" : "play"; // Note: I swapped this logic slightly to match standard UI icons

    return `
      <div class="clock" draggable="true" data-cid="${clock.clockid}">
        <span class="clockname">${clock.clockname}</span>
        <div class="clockdet">
          <img src="files/images/${iconName}.png" class="playbtn" alt="Toggle Timer" />
          <span>${timeDisplay}</span>
          <img src="files/images/x.png" class="closebtn" alt="Close Timer" />
        </div>
      </div>
    `;
  }).join('');
  clockcont.innerHTML = htmlContent;
  refreshactiveclockbtn();
  setupDragAndDrop(clockcont);
}

function loadinactiveclocks() {
  const offclockcont = document.getElementById("clocklistinactive");
  const htmlContent = localClocks.map(clock => {
    if (clock.isactive) return "";
    if (clock.deleted)
      return ""


    const timeDisplay = `${formatNumber(clock.clockhrs)}:${formatNumber(clock.clockmins)}:${formatNumber(clock.clockseconds)}`;
    return `
      <div class="inactiveclock" draggable="true" data-cid="${clock.clockid}">
        <span class="clockname">${clock.clockname}</span>
        <div class="clockdet">
        <img src="files/images/reset.png" class="restartbtn" alt="Reset">
          <span>${timeDisplay}</span>
          <img src="files/images/trash.png" class="trashbtn" alt="Remove">
        </div>
      </div>
    `;
  }).join('');
  offclockcont.innerHTML = htmlContent;
  refreshinactiveclockbtn();
  setupDragAndDrop(offclockcont);
}

// --- Drag to reorder ---
let draggedEl = null;

function setupDragAndDrop(container) {
  const items = container.querySelectorAll(".clock, .inactiveclock");
  items.forEach(el => {
    el.addEventListener("dragstart", () => {
      draggedEl = el;
      el.classList.add("dragging");
    });
    el.addEventListener("dragend", () => {
      el.classList.remove("dragging");
      items.forEach(i => i.classList.remove("drag-over"));
      persistOrder(container);
    });
    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (el !== draggedEl) el.classList.add("drag-over");
    });
    el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.classList.remove("drag-over");
      if (draggedEl && draggedEl !== el && container.contains(draggedEl)) {
        const rect = el.getBoundingClientRect();
        const before = (e.clientY - rect.top) < rect.height / 2;
        container.insertBefore(draggedEl, before ? el : el.nextSibling);
      }
    });
  });
}

function persistOrder(container) {
  const ids = Array.from(container.children)
    .map(c => c.dataset.cid)
    .filter(Boolean);
  if (ids.length > 0) {
    chrome.runtime.sendMessage({ action: "reorder", order: ids });
  }
}

function updatemainclock(_clock) {
  if (!_clock) {
    document.getElementById("mainhrs").innerHTML = formatNumber(0);
    document.getElementById("mainmin").innerHTML = formatNumber(0);
    return;
  }

  document.getElementById("mainhrs").innerHTML = _clock.isactive == true ? formatNumber(
    _clock.clockhrs == 0 ? _clock.clockmins : _clock.clockhrs
  ) : formatNumber(0);
  document.getElementById("mainmin").innerHTML = _clock.isactive == true ? formatNumber(
    _clock.clockhrs == 0 ? _clock.clockseconds : _clock.clockmins
  ) : formatNumber(0);
}

// --- Event Listeners (Keep your existing ones) ---
document.getElementById("pop").addEventListener("click", () => {
  window.open("popup.html", "Pomori", "height=602,width=352");
});
document.getElementById("addbtnalt").addEventListener("click", toglenewclock);
document.getElementById("closenewclock").addEventListener("click", toglenewclock);
document.getElementById("addclockbtn").addEventListener("click", () => {
  if (verifyinput()) addclock();
});
var formats = document.getElementsByClassName("format")

Array.from(formats).forEach((ele) => {
  ele.addEventListener("click", () => {
    var time = ele.dataset.time
    var text = ele.dataset.text
    document.getElementById("clockname").value = text
    document.getElementById("clocktime").value = time
    selectedClockType = ele.dataset.type || "custom"
  })

})

function verifyinput() {
  let cname = document.getElementById("clockname").value;
  let ctime = document.getElementById("clocktime").value;
  if (cname == "" || ctime == "00:00:00" || ctime == "") {
    notif("error", "Missing name or time");
    return false;
  }
  return true;
}

function clearinput() {
  document.getElementById("clockname").value = "";
  document.getElementById("clocktime").value = "00:10:00";
  selectedClockType = "custom";
}

function toglenewclock() {
  var newclockform = document.getElementById("newclockform");
  var addbtninform = document.getElementById("addbtnalt");
  if (newclockform.style.display == "none") {
    newclockform.style.display = "grid";
    addbtninform.style.display = "none";
  } else {
    newclockform.style.display = "none";
    addbtninform.style.display = "flex";
  }
}

// Keep the button refresh logic
function refreshactiveclockbtn() {
  var activeclocks = document.getElementsByClassName("clock");
  Array.from(activeclocks).forEach(clock => {
    var cid = clock.dataset.cid;
    clock.getElementsByClassName("playbtn")[0]?.addEventListener("click", () => pauseclock(cid));
    clock.getElementsByClassName("closebtn")[0]?.addEventListener("click", () => closetimer(cid));
  });
}

function refreshinactiveclockbtn() {
  var inactiveclocks = document.getElementsByClassName("inactiveclock");
  Array.from(inactiveclocks).forEach(clock => {
    var cid = clock.dataset.cid;
    clock.getElementsByClassName("restartbtn")[0]?.addEventListener("click", () => resetclock(cid));
    clock.getElementsByClassName("trashbtn")[0]?.addEventListener("click", () => removeclock(cid));

  });
}

// Notification logic
const notifcont = document.getElementById("notifcont");
function notif(type, text) {
  const notif = `<div class="notif notif${type}">
        <img src="files/images/${type}.png" alt="" />
        <span>${text}</span>
        <img class="notifclosebtn" src="files/images/x.png" alt="" />
      </div>`;
  notifcont.innerHTML += notif;
  var closenotifs = document.getElementsByClassName("notifclosebtn");
  for (let i = 0; i < closenotifs.length; i++) {
    closenotifs[i].addEventListener("click", function () {
      this.parentElement.style.display = "none";
    });
  }
}