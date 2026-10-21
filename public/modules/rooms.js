import { TriviaRoom } from "../../src/server/api.mjs?v=0.11.0";
import { allowsLocalFallback, api } from "./data.js?v=0.11.0";
import { state } from "./state.js?v=0.11.0";

const LOCAL_ROOMS_KEY = "opentrivia.rooms.v0.3";
const localRoomObjects = new Map();

export function localRoomStore() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_ROOMS_KEY) || "{}");
  } catch {
    return {};
  }
}

export function saveLocalRooms(rooms) {
  localStorage.setItem(LOCAL_ROOMS_KEY, JSON.stringify(rooms));
}

function localRoomObject(code) {
  if (localRoomObjects.has(code)) return localRoomObjects.get(code);
  const storage = {
    async get(key) { return key === "room" ? localRoomStore()[code] : undefined; },
    async put(key, value) {
      if (key !== "room") return;
      const rooms = localRoomStore();
      rooms[code] = value;
      saveLocalRooms(rooms);
    },
    async deleteAll() {
      const rooms = localRoomStore();
      delete rooms[code];
      saveLocalRooms(rooms);
    },
    async setAlarm() {},
    async deleteAlarm() {},
  };
  const object = new TriviaRoom({ storage });
  localRoomObjects.set(code, object);
  return object;
}

async function localRoomFetch(code, action = "", options = {}) {
  const response = await localRoomObject(code).fetch(new Request(`https://room/${action}`, {
    method: options.method || "GET",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...(options.body === undefined ? {} : { body: options.body }),
  }));
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const requestError = new Error(result.error || `Request failed (${response.status}).`);
    requestError.status = response.status;
    throw requestError;
  }
  return result;
}

export async function makeLocalRoom(game) {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const rooms = localRoomStore();
  let code;
  do {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    code = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
  } while (rooms[code]);
  const created = await localRoomFetch(code, "create", { method: "POST", body: JSON.stringify({ game }) });
  return { code, ...created };
}

export async function roomRequest(code, action = "", options = {}) {
  const path = `/api/rooms/${code}${action ? `/${action}` : ""}`;
  try {
    return await api(path, options);
  } catch (remoteError) {
    if (!allowsLocalFallback(remoteError)) throw remoteError;
    return localRoomFetch(code, action, options);
  }
}

export function stopRoomPolling() {
  clearTimeout(state.roomPollTimer);
  state.roomPollTimer = null;
}

export function scheduleRoomPoll(role, syncRoom, onMissing, delay = 600) {
  stopRoomPolling();
  state.roomPollTimer = setTimeout(async () => {
    const connection = role === "host" ? state.hostedRoom : state.joinedRoom;
    if (!connection) return;
    try {
      const tokenHeader = role === "host"
        ? { "x-host-token": connection.host_token || "" }
        : { "x-player-token": connection.player_token || "" };
      const result = await roomRequest(connection.code, "", { headers: tokenHeader });
      syncRoom(result.room);
    } catch (error) {
      if (error.status === 404) {
        onMissing(error);
        return;
      }
    }
    scheduleRoomPoll(role, syncRoom, onMissing);
  }, delay);
}
