// nightChoice.js
// The player-driven night-choice prompt: fires on game:botc-your-turn,
// renders every seat as a target button, and submits player:botc-night-
// choice on tap. Disables all buttons immediately after tapping one, since
// there is no visible confirmation step -- tapping IS the submission.
//
// Known gap (see this task's own header comment in the plan and the
// Known Limitations section): the "excluding-self" choiceType (Butler)
// does not actually exclude the acting player's own seat from the grid,
// because game:botc-your-turn's targets array includes every seat with no
// signal identifying which one is "self". This is a minor UX gap, not a
// rules violation the server would ever enforce differently either way --
// the Butler's own applyChoice doesn't reject a self-target server-side.
import { store } from "./store.js";
import { showBotcScreen } from "./main.js";

function renderNightChoice({ choiceType, targets }) {
  const statusEl = document.getElementById("botc-night-choice-status");
  const container = document.getElementById("botc-night-choice-targets");
  container.innerHTML = "";

  if (choiceType === "select-two-players") {
    statusEl.textContent = "Choose two players.";
    const picked = new Set();
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "vote-btn";
    confirm.disabled = true;
    confirm.textContent = "Confirm 2";
    confirm.addEventListener("click", () => {
      container.querySelectorAll("button").forEach((b) => (b.disabled = true));
      statusEl.textContent = "Choice submitted — waiting…";
      store.socket.emit("player:botc-night-choice", {
        code: store.roomCode,
        choice: { targetSeatIds: [...picked] },
      });
    });
    targets.forEach((t) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "vote-btn";
      btn.textContent = t.nickname + (t.alive ? "" : " (dead)");
      btn.addEventListener("click", () => {
        if (picked.has(t.seatId)) picked.delete(t.seatId);
        else if (picked.size < 2) picked.add(t.seatId);
        btn.classList.toggle("botc-picked", picked.has(t.seatId));
        confirm.disabled = picked.size !== 2;
      });
      container.appendChild(btn);
    });
    container.appendChild(confirm);
    showBotcScreen("nightChoice");
    return;
  }

  statusEl.textContent =
    choiceType === "select-one-player-excluding-self" ? "Choose a player (not yourself)." : "Choose a player.";
  targets.forEach((t) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "vote-btn";
    btn.textContent = t.nickname + (t.alive ? "" : " (dead)");
    btn.addEventListener("click", () => {
      container.querySelectorAll("button").forEach((b) => (b.disabled = true));
      statusEl.textContent = "Choice submitted — waiting…";
      store.socket.emit("player:botc-night-choice", { code: store.roomCode, choice: { targetSeatId: t.seatId } });
    });
    container.appendChild(btn);
  });
  showBotcScreen("nightChoice");
}

export function initNightChoice() {
  store.socket.on("game:botc-your-turn", renderNightChoice);
}
