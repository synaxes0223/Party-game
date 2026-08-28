// vote.js
// The player-driven vote prompt: fires on game:botc-your-turn-to-vote,
// shows who's nominated, and submits player:botc-vote on Yes/No. Disables
// both buttons immediately after voting, since there is no visible
// confirmation step -- tapping IS the vote.
import { store } from "./store.js";
import { showBotcScreen } from "./main.js";

function renderVotePrompt({ nomineeSeatId, nomineeNickname }) {
  document.getElementById("botc-vote-nominee").textContent =
    `${nomineeNickname || "Someone"} has been nominated. How do you vote?`;
  document.getElementById("botc-vote-status").textContent = "";

  const yesBtn = document.getElementById("btn-botc-vote-yes");
  const noBtn = document.getElementById("btn-botc-vote-no");
  yesBtn.disabled = false;
  noBtn.disabled = false;

  function submit(voted) {
    yesBtn.disabled = true;
    noBtn.disabled = true;
    document.getElementById("botc-vote-status").textContent = "Vote submitted — waiting…";
    store.socket.emit("player:botc-vote", { code: store.roomCode, voted });
  }

  // Re-assigning onclick each time this renders (rather than
  // addEventListener) is deliberate and safe: this function only ever runs
  // in response to a fresh game:botc-your-turn-to-vote for THIS voter, so
  // there is exactly one live prompt to bind at a time, and the previous
  // handler (if any) is fully replaced rather than accumulating.
  yesBtn.onclick = () => submit(true);
  noBtn.onclick = () => submit(false);

  showBotcScreen("vote");
}

export function initVotePrompt() {
  store.socket.on("game:botc-your-turn-to-vote", renderVotePrompt);
}
