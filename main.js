const WORD_LENGTH = 5;
const MAX_GUESSES = 6;
const START_DATE = { year: 2026, month: 8, day: 29 }; // 
const SHUFFLE_SEED = 20260929;
const STORAGE_KEY = "sityvi-state";

const KEYBOARD_ROWS = [
  ["ქ", "წ", "ე", "რ", "ტ", "ყ", "უ", "ი", "პ"],
  [  "ა", "ს", "დ", "ფ", "გ", "ჰ", "ჯ", "კ", "ლ",],
  ["ზ", "ძ", "ც", "ვ", "ბ", "ნ", "მ", "ვ", "ბ", "ნ", "მ"],
  ["ჭ","თ", "შ", "ჟ","ძ","ჩ" ,"BACKSPACE", "ENTER"]
];


const LATIN_TO_GEORGIAN = {
  a: "ა", b: "ბ", g: "გ", d: "დ", e: "ე", v: "ვ", z: "ზ", T: "თ", i: "ი",
  k: "კ", l: "ლ", m: "მ", n: "ნ", o: "ო", p: "პ", J: "ჟ", r: "რ", s: "ს",
  t: "ტ", u: "უ", f: "ფ", q: "ქ", R: "ღ", y: "ყ", S: "შ", C: "ჩ", c: "ც",
  Z: "ძ", w: "წ", W: "ჭ", x: "ხ", j: "ჯ", h: "ჰ",
};
const GEORGIAN_LETTERS = new Set(KEYBOARD_ROWS.flat().filter((k) => k.length === 1));

const state = {
  words: [],
  wordSet: new Set(),
  answer: null,
  puzzleNumber: 1,
  guesses: [],
  current: "",
  finished: false,
  busy: false,
};

//day / word selection

function getPuzzleNumber(now = new Date()) {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const start = Date.UTC(START_DATE.year, START_DATE.month, START_DATE.day);
  const days = Math.floor((today - start) / 86400000);
  return Math.max(1, days + 1);
}

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list, seed) {
  const result = list.slice();
  const random = mulberry32(seed);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

async function loadWords() {
  const response = await fetch("words.txt");
  if (!response.ok) throw new Error("words.txt could not be loaded");
  const data = await response.json();
  const seen = new Set();
  const words = [];
  for (const entry of data) {
    const word = (entry.word || "").trim();
    if ([...word].length !== WORD_LENGTH || seen.has(word)) continue;
    seen.add(word);
    words.push({ word, meaning: (entry.meaning || "").trim() });
  }
  words.sort((a, b) => a.word.localeCompare(b.word));
  return words;
}

// rend

const boardEl = document.getElementById("board");
const keyboardEl = document.getElementById("keyboard");
const messageEl = document.getElementById("message");

function buildBoard() {
  boardEl.innerHTML = "";
  for (let r = 0; r < MAX_GUESSES; r++) {
    const row = document.createElement("div");
    row.className = "row";
    for (let c = 0; c < WORD_LENGTH; c++) {
      const tile = document.createElement("div");
      tile.className = "tile";
      row.appendChild(tile);
    }
    boardEl.appendChild(row);
  }
}

function buildKeyboard() {
  keyboardEl.innerHTML = "";
  for (const keys of KEYBOARD_ROWS) {
    const row = document.createElement("div");
    row.className = "key-row";
    for (const key of keys) {
      const button = document.createElement("button");
      button.className = "key";
      button.dataset.key = key;
      if (key === "ENTER") {
        button.textContent = "შეყვანა";
        button.classList.add("wide");
      } else if (key === "BACKSPACE") {
        button.textContent = "⌫";
        button.classList.add("wide");
      } else {
        button.textContent = key;
      }
      button.addEventListener("click", () => {
        handleKey(key);
        button.blur();
      });
      row.appendChild(button);
    }
    keyboardEl.appendChild(row);
  }
}

function getRow(index) {
  return boardEl.children[index];
}

function renderCurrentRow() {
  const row = getRow(state.guesses.length);
  if (!row) return;
  const letters = [...state.current];
  [...row.children].forEach((tile, i) => {
    tile.textContent = letters[i] || "";
    tile.classList.toggle("filled", Boolean(letters[i]));
  });
}

let messageTimer = null;
function showMessage(text, duration = 1800) {
  messageEl.textContent = text;
  messageEl.classList.add("show");
  clearTimeout(messageTimer);
  if (duration > 0) {
    messageTimer = setTimeout(() => messageEl.classList.remove("show"), duration);
  }
}

function shakeRow() {
  const row = getRow(state.guesses.length);
  row.classList.remove("shake");
  void row.offsetWidth;
  row.classList.add("shake");
}

const STATUS_RANK = { absent: 1, present: 2, correct: 3 };
function updateKey(letter, status) {
  const key = keyboardEl.querySelector(`[data-key="${letter}"]`);
  if (!key) return;
  const currentStatus = key.dataset.status;
  if (currentStatus && STATUS_RANK[currentStatus] >= STATUS_RANK[status]) return;
  key.classList.remove("correct", "present", "absent");
  key.classList.add(status);
  key.dataset.status = status;
}

function paintRow(rowIndex, guess, statuses, animate) {
  const row = getRow(rowIndex);
  const letters = [...guess];
  return new Promise((resolve) => {
    [...row.children].forEach((tile, i) => {
      tile.textContent = letters[i];
      tile.classList.add("filled");
      const apply = () => {
        tile.classList.add(statuses[i]);
        updateKey(letters[i], statuses[i]);
      };
      if (animate) {
        setTimeout(() => {
          tile.classList.add("flip");
          setTimeout(apply, 250);
        }, i * 300);
      } else {
        apply();
      }
    });
    setTimeout(resolve, animate ? WORD_LENGTH * 300 + 300 : 0);
  });
}

function showResult(won) {
  document.getElementById("result-title").textContent = won
    ? "საღოლ!"
    : "ბანძო, ვერ გამოიცანი";
  document.getElementById("result-word").textContent = state.answer.word;
  document.getElementById("result-meaning").textContent = state.answer.meaning;
  document.getElementById("result-box").classList.remove("hidden");
}

// modals

const helpModal = document.getElementById("help-modal");
const resultModal = document.getElementById("result-modal");

function openModal(modal) {
  closeModals();
  modal.classList.remove("hidden");
}

function closeModals() {
  document.querySelectorAll(".modal-backdrop").forEach((m) => m.classList.add("hidden"));
}

function isModalOpen() {
  return document.querySelector(".modal-backdrop:not(.hidden)") !== null;
}

document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closeModals();
  });
  backdrop.querySelector(".modal-close").addEventListener("click", closeModals);
});

document.getElementById("help-button").addEventListener("click", (event) => {
  openModal(helpModal);
  event.currentTarget.blur();
});

document.getElementById("timer-button").addEventListener("click", (event) => {
  openModal(resultModal);
  event.currentTarget.blur();
});

// game logic

function evaluate(guess, answer) {
  const g = [...guess];
  const a = [...answer];
  const statuses = Array(WORD_LENGTH).fill("absent");
  const remaining = {};
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (g[i] === a[i]) statuses[i] = "correct";
    else remaining[a[i]] = (remaining[a[i]] || 0) + 1;
  }
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (statuses[i] !== "correct" && remaining[g[i]] > 0) {
      statuses[i] = "present";
      remaining[g[i]]--;
    }
  }
  return statuses;
}

function saveState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ puzzle: state.puzzleNumber, guesses: state.guesses })
    );
  } catch (e) {
  }
}

function loadSavedGuesses() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && saved.puzzle === state.puzzleNumber && Array.isArray(saved.guesses)) {
      return saved.guesses.filter((g) => state.wordSet.has(g)).slice(0, MAX_GUESSES);
    }
  } catch (e) {
  }
  return [];
}

async function submitGuess() {
  const guess = state.current;
  if ([...guess].length < WORD_LENGTH) {
    showMessage("არ არის საკმარისი ასოები.");
    shakeRow();
    return;
  }
  if (!state.wordSet.has(guess)) {
    showMessage("სიტყვა ლექსიკონში არ არის, მომწერე ჩავამატებ");
    shakeRow();
    return;
  }

  state.busy = true;
  const rowIndex = state.guesses.length;
  state.guesses.push(guess);
  state.current = "";
  saveState();

  await paintRow(rowIndex, guess, evaluate(guess, state.answer.word), true);
  state.busy = false;
  checkFinished(true);
}

function checkFinished(announce) {
  const last = state.guesses[state.guesses.length - 1];
  const won = last === state.answer.word;
  if (!won && state.guesses.length < MAX_GUESSES) return;
  state.finished = true;
  showResult(won);
  if (announce) {
    if (won) showMessage("ბრწყინვალეა!");
    setTimeout(() => openModal(resultModal), 1200);
  }
}

function handleKey(key) {
  if (state.finished || state.busy || !state.answer) return;
  if (key === "ENTER") {
    submitGuess();
  } else if (key === "BACKSPACE") {
    state.current = [...state.current].slice(0, -1).join("");
    renderCurrentRow();
  } else if (GEORGIAN_LETTERS.has(key) && [...state.current].length < WORD_LENGTH) {
    state.current += key;
    renderCurrentRow();
  }
}

document.addEventListener("keydown", (event) => {
  if (isModalOpen()) {
    if (event.key === "Escape") closeModals();
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === "Enter") {
    event.preventDefault();
    handleKey("ENTER");
  } else if (event.key === "Backspace") {
    handleKey("BACKSPACE");
  } else if (GEORGIAN_LETTERS.has(event.key)) {
    handleKey(event.key);
  } else if (LATIN_TO_GEORGIAN[event.key]) {
    handleKey(LATIN_TO_GEORGIAN[event.key]);
  }
});

// countdown

function startCountdown() {
  const elements = document.querySelectorAll(".countdown");
  const tick = () => {
    const now = new Date();
    if (getPuzzleNumber(now) !== state.puzzleNumber) {
      window.location.reload();
      return;
    }
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const total = Math.max(0, Math.floor((midnight - now) / 1000));
    const h = String(Math.floor(total / 3600)).padStart(2, "0");
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
    const s = String(total % 60).padStart(2, "0");
    elements.forEach((el) => (el.textContent = `${h}:${m}:${s}`));
  };
  tick();
  setInterval(tick, 1000);
}

// start

async function init() {
  buildBoard();
  buildKeyboard();
  state.puzzleNumber = getPuzzleNumber();
  document.getElementById("puzzle-number").textContent = `#${state.puzzleNumber}`;
  startCountdown();

  try {
    state.words = await loadWords();
  } catch (e) {
    showMessage("სიტყვების ჩატვირთვა ვერ მოხერხდა", 0);
    return;
  }
  state.wordSet = new Set(state.words.map((w) => w.word));
  const order = shuffled(state.words, SHUFFLE_SEED);
  state.answer = order[(state.puzzleNumber - 1) % order.length];

  const saved = loadSavedGuesses();
  for (const guess of saved) {
    const rowIndex = state.guesses.length;
    state.guesses.push(guess);
    paintRow(rowIndex, guess, evaluate(guess, state.answer.word), false);
  }
  if (saved.length) checkFinished(false);

  // todays game already played, show the result, otherwise explain how to play
  openModal(state.finished ? resultModal : helpModal);
}

init();