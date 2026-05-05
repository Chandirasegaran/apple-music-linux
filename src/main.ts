import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  session
} from "electron";
import path from "node:path";

const APPLE_MUSIC_URL = "https://music.apple.com/in/home";
const PERSIST_PARTITION = "persist:com.segar.applemusic";
const APP_USER_MODEL_ID = "com.segar.applemusic";
const NETWORK_ERROR_CODES = new Set([-2, -6, -21, -100, -101, -102, -104, -105, -106, -109]);

let mainWindow: BrowserWindow | null = null;

app.setName("Apple Music");

function createWindow(): void {
  const persistentSession = session.fromPartition(PERSIST_PARTITION);
  configurePermissionHandling(persistentSession);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    icon: path.join(__dirname, "..", "build", "icons", "512x512.png"),
    title: "Apple Music",
    webPreferences: {
      session: persistentSession,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
      sandbox: true
    }
  });

  mainWindow.loadURL(APPLE_MUSIC_URL).catch((error: Error) => {
    console.error("Failed to load Apple Music:", error);
  });

  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, _errorDescription, _validatedURL, isMainFrame) => {
      if (!isMainFrame || !NETWORK_ERROR_CODES.has(errorCode)) {
        return;
      }
      loadOfflinePage();
    }
  );

  // Apple Music can register beforeunload handlers during playback.
  // Allow app/window close to proceed without being blocked.
  mainWindow.webContents.on("will-prevent-unload", (event) => {
    event.preventDefault();
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function loadOfflinePage(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const offlinePath = path.join(app.getAppPath(), "build", "offline.html");
  mainWindow.loadFile(offlinePath).catch((error: Error) => {
    console.error("Failed to load offline page:", error);
  });
}

function retryMainLoad(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.loadURL(APPLE_MUSIC_URL).catch((error: Error) => {
    console.error("Retry load failed:", error);
    loadOfflinePage();
  });
}

function configurePermissionHandling(appSession: Electron.Session): void {
  appSession.setPermissionRequestHandler(
    (
      _webContents,
      permission: string,
      callback: (allow: boolean) => void,
      _details: unknown
    ) => {
      const allowed: string[] = [
        "notifications",
        "media",
        "fullscreen",
        "clipboard-read"
      ];
      callback(allowed.includes(permission));
    }
  );
}

function setupMediaControls(): void {
  ipcMain.on(
    "media-control",
    (_event, action: "playpause" | "nexttrack" | "previoustrack") => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }

      const mediaSessionAction =
        action === "nexttrack"
          ? "nexttrack"
          : action === "previoustrack"
            ? "previoustrack"
            : "playpause";

      const script = `
        if (navigator.mediaSession && navigator.mediaSession.setActionHandler) {
          try {
            navigator.mediaSession.setActionHandler("${mediaSessionAction}", () => {});
          } catch {}
        }
        const media = document.querySelector('audio');
        if (!media) {
          false;
        } else if ("${action}" === "playpause") {
          if (media.paused) media.play(); else media.pause();
          true;
        } else if ("${action}" === "nexttrack") {
          const button = document.querySelector('[aria-label*="Next"], [data-testid*="next"]');
          button instanceof HTMLElement ? (button.click(), true) : false;
        } else {
          const button = document.querySelector('[aria-label*="Previous"], [data-testid*="previous"]');
          button instanceof HTMLElement ? (button.click(), true) : false;
        }
      `;

      mainWindow.webContents.executeJavaScript(script).catch(() => undefined);
    }
  );

  ipcMain.on("retry-load", () => {
    retryMainLoad();
  });
}

async function waitForWidevineComponents(): Promise<void> {
  type ComponentsApi = {
    whenReady: () => Promise<void>;
    status?: () => unknown;
  };

  const electronModule = require("electron") as { components?: ComponentsApi };
  if (!electronModule.components?.whenReady) {
    return;
  }

  await electronModule.components.whenReady();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) {
      createWindow();
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    if (process.platform === "linux") {
      (app as unknown as { setDesktopName?: (desktopName: string) => void }).setDesktopName?.(
        "AppleMusic.desktop"
      );
    }
    app.setAppUserModelId(APP_USER_MODEL_ID);
    Menu.setApplicationMenu(null);
    await waitForWidevineComponents();
    createWindow();
    setupMediaControls();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
