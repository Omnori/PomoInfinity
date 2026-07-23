const cssroot = document.documentElement;
let activeClock = null;

function formatNumber(num) {
  return num.toString().padStart(2, "0");
}

function applyTheme(themeName) {
  cssroot.dataset.theme = themeName || "default";
}

function loadSettings() {
  chrome.runtime.sendMessage({ action: "getSettings" }, (response) => {
    if (response && response.settings) applyTheme(response.settings.theme);
  });
}

function sync() {
  chrome.runtime.sendMessage({ action: "getClocks" }, (response) => {
    if (!response || !response.clocks) return;
    const clocks = response.clocks;
    activeClock = clocks.find(c => c.isactive && !c.deleted) || null;

    const nameEl = document.getElementById("mininame");
    const hrsEl = document.getElementById("mainhrs");
    const minEl = document.getElementById("mainmin");
    const toggleBtn = document.getElementById("minitoggle");

    if (!activeClock) {
      nameEl.textContent = "No active task";
      hrsEl.textContent = "00";
      minEl.textContent = "00";
      return;
    }

    nameEl.textContent = activeClock.clockname;
    if (activeClock.clockhrs > 0) {
      hrsEl.textContent = formatNumber(activeClock.clockhrs);
      minEl.textContent = formatNumber(activeClock.clockmins);
    } else {
      hrsEl.textContent = formatNumber(activeClock.clockmins);
      minEl.textContent = formatNumber(activeClock.clockseconds);
    }

    toggleBtn.src = activeClock.ispaused ? "images/play.png" : "images/pause.png";

    const timeangle = (activeClock.clockseconds / 60) * 360;
    cssroot.style.setProperty("--timeangle", `${timeangle}deg`);
  });
}

document.getElementById("minitoggle").addEventListener("click", () => {
  if (!activeClock) return;
  chrome.runtime.sendMessage({ action: "pause", id: activeClock.clockid }, () => setTimeout(sync, 150));
});

document.getElementById("miniskip").addEventListener("click", () => {
  if (!activeClock) return;
  chrome.runtime.sendMessage({ action: "close", id: activeClock.clockid }, () => setTimeout(sync, 150));
});

loadSettings();
sync();
setInterval(sync, 1000);
