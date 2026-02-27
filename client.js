// ==== Firebase bindings ====
const { auth, db, fs } = window._firebase;
const {
  doc, collection, addDoc, setDoc, updateDoc,
  onSnapshot, serverTimestamp, query, where, getDocs
} = fs;

// ==== DOM ====
const lobbyEl = document.getElementById('lobby');
const tableViewEl = document.getElementById('tableView');
const roomListEl = document.getElementById('roomList');
const roomInfoEl = document.getElementById('roomInfo');
const logEl = document.getElementById('log');
const identityInfoEl = document.getElementById('authStatus');

const seatsBarEl = document.getElementById('seatsBar');
const playInnerEl = document.getElementById('playInner');
const editOverlayEl = document.getElementById('editOverlay');
const handTitleEl = document.getElementById('handTitle');
const handContentEl = document.getElementById('handContent');
const sidebarEl = document.getElementById('sidebar');

const btnToggleEditEl = document.getElementById('btnToggleEdit');
const btnAddSeatEl   = document.getElementById('btnAddSeat');
const btnRemoveSeatEl= document.getElementById('btnRemoveSeat');
const btnResetEl     = document.getElementById('btnReset');
const btnShuffleEl   = document.getElementById('btnShuffle');

const newRoomNameInput = document.getElementById("newRoomName");
const btnCreateRoom = document.getElementById("btnCreateRoom");
const btnSaveName = document.getElementById("btnSaveName");
const playerNameInput = document.getElementById("playerNameInput");

// ==== Estado ====
let currentUser = null;
let currentRoomId = null;
let unsubRooms = null;
let unsubRoomState = null;

let isRoomOwner = false;
let localEditingMode = false;
let objects = [];

let draggingCard = null;
let dragOffsetX = 0;
let dragOffsetY = 0;

// ==== Helpers ====
function showLobby() {
  lobbyEl.style.display = 'block';
  tableViewEl.style.display = 'none';
}

function showTableView() {
  lobbyEl.style.display = 'none';
  tableViewEl.style.display = 'flex';
}

function log(msg) {
  logEl.textContent += msg + "\n";
}

// ==== Auth ====
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    await signIn();
    return;
  }

  currentUser = user;
  identityInfoEl.textContent = `UID: ${user.uid}`;

  if (user.displayName) playerNameInput.value = user.displayName;

  subscribeRooms();
  restoreURL();
});

async function signIn() {
  const { signInAnonymously } = await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js");
  await signInAnonymously(auth);
}

btnSaveName.onclick = async () => {
  if (!currentUser) return;
  const name = playerNameInput.value.trim();
  if (!name) return;

  const { updateProfile } = await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js");
  await updateProfile(currentUser, { displayName: name });
};

// ==== Rooms list ====
function subscribeRooms() {
  if (unsubRooms) unsubRooms();

  const ref = collection(db, "rooms");
  unsubRooms = onSnapshot(ref, (snap) => {
    roomListEl.innerHTML = "";
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      if (data.ownerId !== currentUser.uid) return;

      const li = document.createElement("li");

      const link = document.createElement("a");
      link.href = "?room=" + docSnap.id;
      link.textContent = data.name;
      li.appendChild(link);

      roomListEl.appendChild(li);
    });
  });
}

// ==== Criar sala ====
btnCreateRoom.onclick = async () => {
  if (!currentUser) return;

  const name = newRoomNameInput.value.trim() || "Sala sem nome";
  const ref = await addDoc(collection(db, "rooms"), {
    name,
    ownerId: currentUser.uid,
    ownerName: currentUser.displayName || "Anônimo",
    createdAt: serverTimestamp()
  });

  await createInitialState(ref.id);

  window.location.search = "?room=" + ref.id;
};

async function createInitialState(roomId) {
  const stateRef = doc(db, "rooms", roomId, "meta", "state");
  const initial = {
    tableObjects: [],
    decks: {},
    ownerUserId: currentUser.uid
  };
  await setDoc(stateRef, initial);
}

// ==== Entrar na sala ====
function restoreURL() {
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get('room');
  if (roomId) joinRoom(roomId);
  else showLobby();
}

function joinRoom(roomId) {
  currentRoomId = roomId;
  showTableView();
  roomInfoEl.textContent = roomId;

  subscribeRoomState(roomId);
}

function subscribeRoomState(roomId) {
  if (unsubRoomState) unsubRoomState();

  const ref = doc(db, "rooms", roomId, "meta", "state");
  unsubRoomState = onSnapshot(ref, (snap) => {
    if (!snap.exists()) {
      roomInfoEl.textContent = "Sala inexistente";
      return;
    }

    const data = snap.data();
    objects = data.tableObjects || [];
    isRoomOwner = data.ownerUserId === currentUser.uid;

    updateEditingUI();
    renderRoom();
  });
}

// ==== Atualizar modo edição ====
function updateEditingUI() {
  if (isRoomOwner) {
    btnToggleEditEl.style.display = 'inline-block';
    btnAddSeatEl.style.display   = 'inline-block';
    btnRemoveSeatEl.style.display= 'inline-block';
  } else {
    btnToggleEditEl.style.display = 'none';
    btnAddSeatEl.style.display   = 'none';
    btnRemoveSeatEl.style.display= 'none';
  }

  editOverlayEl.style.display = (isRoomOwner && localEditingMode) ? 'block' : 'none';
  sidebarEl.style.display     = (isRoomOwner && localEditingMode) ? 'flex' : 'none';
}

// ==== Render sala ====
function renderRoom() {
  playInnerEl.innerHTML = "";
  seatsBarEl.innerHTML = "";

  const seats = objects.filter(o => o.type === "seat");
  renderSeats(seats);

  const cards = objects.filter(o => o.type === "card");
  renderCards(cards);

  renderHand(seats);
}

function renderSeats(seats) {
  for (const seat of seats) {
    const seatEl = document.createElement("div");
    seatEl.className = "seat-card";

    const header = document.createElement("div");
    header.textContent = seat.baseLabel || "Jogador";
    seatEl.appendChild(header);

    const nameLine = document.createElement("div");
    const actionsLine = document.createElement("div");
    actionsLine.style.display = "flex";
    actionsLine.style.gap = "4px";

    if (seat.occupantUserId) {
      nameLine.textContent = seat.occupantName || "(?)";

      if (seat.occupantUserId === currentUser.uid) {
        const leave = document.createElement("span");
        leave.textContent = "Sair";
        leave.style.cursor = "pointer";
        leave.onclick = () => updateSeat(seat.id, { occupantUserId: null });
        actionsLine.appendChild(leave);
      }

      if (isRoomOwner) {
        const free = document.createElement("span");
        free.textContent = "Liberar";
        free.style.cursor = "pointer";
        free.style.color = "red";
        free.onclick = () => updateSeat(seat.id, { occupantUserId: null });
        actionsLine.appendChild(free);
      }
    } else {
      nameLine.textContent = seat.baseLabel;

      const take = document.createElement("span");
      take.textContent = "Pegar";
      take.style.cursor = "pointer";
      take.style.color = "green";
      take.onclick = () => updateSeat(seat.id, {
        occupantUserId: currentUser.uid,
        occupantName: currentUser.displayName || "?"
      });

      actionsLine.appendChild(take);
    }

    seatEl.appendChild(nameLine);
    seatEl.appendChild(actionsLine);

    seatsBarEl.appendChild(seatEl);
  }
}

function renderCards(cards) {
  for (const card of cards) {
    const el = document.createElement("div");
    el.style.position = "absolute";
    el.style.left = card.x + "px";
    el.style.top  = card.y + "px";
    el.style.width = card.width + "px";
    el.style.height= card.height + "px";
    el.style.border = "2px solid #222";
    el.style.borderRadius = "6px";
    el.style.display = "flex";
    el.style.justifyContent = "center";
    el.style.alignItems = "center";
    el.style.background = card.faceUp ? "#fff" : "#555";
    el.style.color = card.faceUp ? "#000" : "#fff";
    el.style.userSelect = "none";
    el.style.cursor = "grab";

    el.textContent = card.faceUp ? ("F " + card.id) : ("B " + card.id);

    el.onmousedown = (e) => {
      draggingCard = card;
      const rect = playInnerEl.getBoundingClientRect();
      dragOffsetX = e.clientX - rect.left - card.x;
      dragOffsetY = e.clientY - rect.top  - card.y;
    };

    el.ondblclick = () => updateObject(card.id, { faceUp: !card.faceUp });

    playInnerEl.appendChild(el);
  }
}

function renderHand(seats) {
  const mySeat = seats.find(s => s.occupantUserId === currentUser.uid);
  if (!mySeat) {
    handContentEl.textContent = "Você não está em nenhum assento.";
    return;
  }
  handContentEl.textContent = mySeat.occupantName;
}

// ==== Eventos de drag ====
playInnerEl.addEventListener("mousemove", (e) => {
  if (!draggingCard) return;
  const rect = playInnerEl.getBoundingClientRect();

  draggingCard.x = e.clientX - rect.left - dragOffsetX;
  draggingCard.y = e.clientY - rect.top  - dragOffsetY;

  renderRoom();
});

playInnerEl.addEventListener("mouseup", () => {
  if (!draggingCard) return;
  updateObject(draggingCard.id, { x: draggingCard.x, y: draggingCard.y });
  draggingCard = null;
});

// ==== Firestore updates ====
async function updateSeat(id, updates) {
  if (!currentRoomId) return;
  const ref = doc(db, "rooms", currentRoomId, "meta", "state");

  const stateSnap = await (await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js")).getDoc(ref);
  if (!stateSnap.exists()) return;

  const data = stateSnap.data();
  const objs = data.tableObjects.map(o => o.id === id ? { ...o, ...updates } : o);

  await updateDoc(ref, { tableObjects: objs });
}

async function updateObject(id, updates) {
  if (!currentRoomId) return;
  const ref = doc(db, "rooms", currentRoomId, "meta", "state");

  const stateSnap = await (await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js")).getDoc(ref);
  if (!stateSnap.exists()) return;

  const data = stateSnap.data();
  const objs = data.tableObjects.map(o => o.id === id ? { ...o, ...updates } : o);

  await updateDoc(ref, { tableObjects: objs });
}

// ==== Botões ====
btnAddSeatEl.onclick = async () => {
  if (!currentRoomId) return;

  const ref = doc(db, "rooms", currentRoomId, "meta", "state");
  const snap = await (await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js")).getDoc(ref);
  const data = snap.data();

  const seats = data.tableObjects.filter(o => o.type === "seat");
  const seatNum = seats.length + 1;

  const seat = {
    id: "seat-" + seatNum + "-" + Date.now(),
    type: "seat",
    baseLabel: "Jogador " + seatNum,
    occupantUserId: null,
    occupantName: null
  };

  await updateDoc(ref, {
    tableObjects: [...data.tableObjects, seat]
  });
};

btnRemoveSeatEl.onclick = async () => {
  if (!currentRoomId) return;
  const ref = doc(db, "rooms", currentRoomId, "meta", "state");

  const snap = await (await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js")).getDoc(ref);
  const data = snap.data();
  const objs = [...data.tableObjects];

  const idx = objs.map(o => o.type).lastIndexOf("seat");
  if (idx === -1) return;

  objs.splice(idx, 1);
  await updateDoc(ref, { tableObjects: objs });
};

document.getElementById('btnBackToLobby').onclick = () => {
  window.location.search = "";
};

btnToggleEditEl.onclick = () => {
  localEditingMode = !localEditingMode;
  updateEditingUI();
};

// ==== Reset / Shuffle (versão simples Firebase) ====
btnResetEl.onclick = async () => {
  if (!currentRoomId) return;

  const ref = doc(db, "rooms", currentRoomId, "meta", "state");
  await updateDoc(ref, {
    tableObjects: [],
    decks: {}
  });
};

btnShuffleEl.onclick = () => alert("Shuffle real será implementado depois.");
