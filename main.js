import "./app.js";
import "./storage/life-store.js";
import { registerOffline } from "./offline/register.js";

window.orbitOfflineReady = registerOffline();
