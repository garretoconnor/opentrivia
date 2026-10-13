import { initDaily, loadDaily } from "./modules/daily.js?v=0.5.2";
import { closeHostedRoom, hostPublished, initHost, openHostedPlayCard } from "./modules/host.js?v=0.5.2";
import { initLibrary, loadLibrary } from "./modules/library.js?v=0.5.2";
import { initLocalPlay, showSetup } from "./modules/local-play.js?v=0.5.2";
import { initPlayer } from "./modules/player.js?v=0.5.2";
import { $, configureViewRenderers, elements, switchView } from "./modules/render.js?v=0.5.2";
import { initStudio, renderStudio } from "./modules/studio.js?v=0.5.2";
import { state } from "./modules/state.js?v=0.5.2";

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
