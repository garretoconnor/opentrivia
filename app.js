import { initDaily, loadDaily } from "./modules/daily.js";
import { closeHostedRoom, hostPublished, initHost, openHostedPlayCard } from "./modules/host.js";
import { initLibrary, loadLibrary } from "./modules/library.js";
import { initLocalPlay, showSetup } from "./modules/local-play.js";
import { initPlayer } from "./modules/player.js";
import { $, configureViewRenderers, elements, switchView } from "./modules/render.js";
import { initStudio, renderStudio } from "./modules/studio.js";
import { state } from "./modules/state.js";

initDaily();
initStudio();
initHost();
initPlayer();
initLocalPlay({ openHostedPlayCard, closeHostedRoom });
initLibrary({ showSetup, hostPublished });
configureViewRenderers({ renderStudio, loadLibrary, loadDaily });

elements.exitPlay.addEventListener("click", () => {
  if (state.currentView === "host") closeHostedRoom();
  else switchView(state.returnView);
});

$("#home-button").addEventListener("click", () => switchView("library"));
$("#hero-create-button").addEventListener("click", () => switchView("studio"));

document.querySelectorAll(".main-nav button").forEach((button) => {
  button.addEventListener("click", async () => {
    if (state.currentView === "host" && button.dataset.view !== "host") {
      await closeHostedRoom({ quiet: true });
      if (state.hostedRoom) return;
    }
    switchView(button.dataset.view);
  });
});

renderStudio();
switchView("library");
