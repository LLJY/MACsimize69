var handleFullscreen = readConfig("handleFullscreen", true);
var handleMaximized = readConfig("handleMaximized", true);
var moveToLast = readConfig("moveToLast", false);
var enableIfOnlyOne = readConfig("enableIfOnlyOne", false);
var enablePanelVisibility = readConfig("enablePanelVisibility", false);
var exclusiveDesktops = readConfig("exclusiveDesktops", true)
var debugMode = readConfig("debugMode", false)

function log(msg) {
    if (debugMode) {
        print(`MACsimize6: ${msg}`);
    }
}

const savedData = new Map();
const managedDesktops = [];

const systemSkippedWindows = [
    'kwin',
    'kwin_wayland',
    'ksmserver-logout-greeter',
    'ksmserver',
    'kscreenlocker_greet',
    'ksplash',
    'ksplashqml',
    'plasmashell',
    'org.kde.plasmashell',
    'krunner'
    ];
var configSkippedWindows = readConfig("SkipWindows", "lattedock, latte-dock, org.kde.spectacle, spectable, org.kde.yakuake").toString().toLowerCase().split(/,\s*/);
var alwaysSkippedWindows = systemSkippedWindows.concat(configSkippedWindows)

function shouldSkip(window) {

    // If the window is not a normal window it should be skipped
    if (!window ||
        window.desktopWindow ||
        window.dock ||
        window.toolbar ||
        window.menu ||
        window.dialog ||
        window.splash ||
        window.utility ||
        window.dropdownMenu ||
        window.popupMenu ||
        window.tooltip ||
        window.notification ||
        window.criticalNotification ||
        window.appletPopup ||
        window.onScreenDisplay ||
        window.comboBox ||
        window.popupWindow ||
        window.specialWindow ||
        window.inputMethod) {

        log("Skipped: Special window");
        return true;
    }

    const windowClass = String(window.resourceClass || "").toLowerCase();

    // Windows with empty class should be skipped
    if (!windowClass) {
        log(`Skipped: Null`);
        return true;
    }

    // Some system and user defined windows should be skipped
    if (alwaysSkippedWindows.indexOf(windowClass) != -1) {
        log(`Skipped: ${windowClass}`);
        return true;
    }

    log(`Check passed for: ${windowClass}`);
    return false;
}

function getNextDesktopNumber() {
    log(`Getting next desktop number ${workspace.currentDesktop}`);

    for (let i = 0; i < workspace.desktops.length; i++) {
        let desktop = workspace.desktops[i];

        if (desktop == workspace.currentDesktop) {
            log(`Found: ${desktop.name} Number: ${i}`);
            return i + 1;
        }
    }
}

// Functions to updated and delete saved data
function updateSavedData(windowId, patch) {
    const prev = savedData.get(windowId) || {};
    const merged = Object.assign({}, prev, patch);
    savedData.set(windowId, merged);
}

function deleteSavedData(windowId, field) {
    const data = savedData.get(windowId);

    if (!data) return;

    if (field in data) {
        delete data[field];
    }
}

function findWindowById(windowId) {
    var windowList = workspace.windowList();
    for (var j = 0; j < windowList.length; j++) {
        if (windowList[j].internalId === windowId) {
            return windowList[j];
        }
    }
    return null;
}

function isWindowMaximized(window) {
    var area = workspace.clientArea(KWin.MaximizeArea, window);
    return window.width + 1 >= area.width && window.height + 1 >= area.height;
}

function moveToNewDesktop(window) {
    let windowName = String(window.caption || "");
    let windowId = window.internalId;
    const data = savedData.get(windowId);
    let numMonitors = workspace.screens.length;
    log(`enableIfOnlyOne: ${enableIfOnlyOne}`);

    if (enableIfOnlyOne && numMonitors > 1) {
        log(`Detected ${numMonitors} monitors`);
        return;
    } else if (data && data.macsimized) {
        log(`Window: ${windowId} is already on separate desktop`);
        return;
    } else {
        log(`Creating new desktop with name: ${windowName}`);
        let newDesktopNumber = -1;

        if (moveToLast) {
            newDesktopNumber = workspace.desktops.length;
        } else {
            newDesktopNumber = getNextDesktopNumber();
        }

        // Mapping data for the MACsimized window
        updateSavedData(windowId, {
            resourceClass: String(window.resourceClass || ""),
            desktops: window.desktops,
            macsimized: true
        });

        // Creating a new desktop
        workspace.createDesktop(newDesktopNumber, windowName);
        let newDesktop = workspace.desktops[newDesktopNumber];

        if (!managedDesktops.includes(newDesktop)) {
            managedDesktops.push(newDesktop);
        }

        // Store reference to the dedicated desktop for same-class checking
        updateSavedData(windowId, {
            dedicatedDesktop: newDesktop
        });

        log(`Saved desktops for window ${windowId} : ${JSON.stringify(savedData.get(windowId))}`);
        let ds = [newDesktop];
        // Moving window to the new desktop
        window.desktops = ds;
        // Switching to the new desktop
        workspace.currentDesktop = newDesktop;
    }
}

function cleanDesktop(desktop) {
    log(`Cleaning desktop: ${JSON.stringify(desktop)}`);

    // Going through the list of all windows
    const windows = workspace.windowList();
    for (var i = 0; i < windows.length; i++) {
        let window = windows[i];

        // If a window is assigned the desktop - remove the desktop from the list of desktops
        if (window.desktops.includes(desktop) && !window.skipTaskbar) {
            let windowName = window.resourceName;
            log(`Window: ${windowName} is on the desktop`);
            window.desktops = window.desktops.filter(item => item.id !== desktop.id);

            // If it was a single dektop for this window - move it to the main desktop
            if (window.desktops.length < 1) {
                window.desktops = [workspace.desktops[0]];
            }

            log(`Window ${windowName}: ${JSON.stringify(window.desktops)}`);
        }
    }
}

function restoreDesktop(window) {
    let windowId = window.internalId;
    const data = savedData.get(windowId);
    log(`Restoring desktops for ${windowId}`);
    log(`Saved data: ${JSON.stringify(data)}`)

    // Only move window that has been MACsimized
    if (data && data.macsimized) {
        const dedicated = data.dedicatedDesktop;
        log(`Restoring window ${windowId} to the main desktops`);

        // Remove MACsimized indicator for the window
        deleteSavedData(windowId, "macsimized");
        deleteSavedData(windowId, "dedicatedDesktop");

        // Move window to main desktop and remove the dedicated desktop
        window.desktops = [workspace.desktops[0]];
        workspace.currentDesktop = window.desktops[0];

        if (dedicated && managedDesktops.includes(dedicated)) {
            cleanDesktop(dedicated);
            workspace.removeDesktop(dedicated);

            let idx = managedDesktops.indexOf(dedicated);
            if (idx !== -1) {
                managedDesktops.splice(idx, 1);
            }
        }

    } else {
        log(`${windowId} is not MACSimized. Not restoring.`)
    }
}

function fullScreenChanged(window) {
    let windowId = window.internalId;
    const data = savedData.get(windowId);
    log(`Window : ${windowId} full-screen : ${window.fullScreen}`);

    // Move full-screened window to its new desktop
    // Restore un-full-screened window to the main desktop
    // If the window is still maximized - leave it where it is
    if (window.fullScreen) {
        moveToNewDesktop(window);
    } else if (data && data.macsimized && data.windowMode === 3) {
        log(`Window: ${windowId} is still maximized.`);
        return;
    } else {
        deleteSavedData(windowId, "suspended");
        restoreDesktop(window);
        workspace.raiseWindow(window);
    }
}

function maximizedStateChanged(window, mode) {
    let windowId = window.internalId;

    // Save the window mode
    updateSavedData(windowId, {
        windowMode: mode
    });

    log(`Window : ${windowId} maximized mode : ${mode}`);

    // If window is maximized - move it to it's new desktop
    // If window is un-maximized - restore it to the main desktop
    if (mode == 3) {
        moveToNewDesktop(window);
    } else {
        deleteSavedData(windowId, "suspended");
        restoreDesktop(window);
        workspace.raiseWindow(window);
    }
}

function minimizedStateChanged(window) {
    let windowId = window.internalId;
    const data = savedData.get(windowId);

    // If window is minimized resore it to the main desktop
    // If unminimized, create a new desktop for it
    // Only do it for MACsimized windows
    if (window.minimized && data && data.macsimized) {
        log(`window: ${windowId} is minimized. Restoring desktops`);
        updateSavedData(windowId, {
            minimized: true
        });
        restoreDesktop(window);
    } else if (data && data.minimized && data.windowMode === 3) {
        log(`Window: ${windowId} is un-minimized and was maximized before.`);
        deleteSavedData(windowId, "minimized");
        moveToNewDesktop(window);
    } else {
        log(`Nothing to do for window ${windowId}`);
        return;
    }
}

function windowCaptionChanged(window) {
    let windowId = window.internalId;
    let windowName = String(window.caption || "");
    const data = savedData.get(windowId);

    // Update the name of the MACsimized window desktop
    if (data && data.macsimized) {
        log(`Updating desktop name for ${windowId}`);
        window.desktops[0].name = windowName;
    }
}

function togglePanelVisibility() {
    let defaultDesktop = workspace.desktops[0];
    // Default panel visibility
    let panelVisibility = 'none';

    // If we are not on the main desktop, set panel visibility to DodgeWindows
    if (workspace.currentDesktop !== defaultDesktop) {
        panelVisibility = 'dodgewindows';
    }

    // Script to go theough all panels and set visibility
    var script = `
    for (let id of panelIds) {
        let p = panelById(id);
        p.hiding = "${panelVisibility}";
    }
    `;

    // Call DBus and execute the script
    callDBus(
        "org.kde.plasmashell",
        "/PlasmaShell",
        "org.kde.PlasmaShell",
        "evaluateScript",
        script
    );
}

function sameClassDesktop(window) {
    const windowClass = String(window.resourceClass || "");
    const currentDesktop = workspace.currentDesktop;
    log(`Checking ${window.internalId} - ${windowClass} for same-class desktop`);

    if (savedData.size === 0) {
        log(`saved Desktops is empty`);
        return false;
    }

    // Go though tracked windows
    for (const [windowId, saved] of savedData) {
        log(`Testing saved entry for windowId: ${windowId}, ${saved.resourceClass}`);

        // Skip non macsimized and windows that don't match the class
        if (!saved.macsimized) continue;
        if (saved.resourceClass !== windowClass) continue;

        // If macsimized window with the same class owns the current desktop
        if (saved.dedicatedDesktop && saved.dedicatedDesktop === currentDesktop) {
            log(`Match found for class ${windowClass} on current desktop`);
            // Yes the window has the same class as the macsimized window on the current desktop
            return true;
        }
    }

    log(`No matches found for ${windowClass} in saved data`);
    return false;
}

function cleanupStaleDesktops() {
    log("Cleaning up stale virtual desktops from previous session");
    const mainDesktop = workspace.desktops[0];

    // Move all windows to the main desktop
    const allWindows = workspace.windowList();
    for (var i = 0; i < allWindows.length; i++) {
        var win = allWindows[i];
        if (!win.desktops.includes(mainDesktop)) {
            win.desktops = [mainDesktop];
        }
    }

    // Remove all desktops except the main one (from the end to avoid index shift)
    while (workspace.desktops.length > 1) {
        var last = workspace.desktops[workspace.desktops.length - 1];
        log(`Removing stale desktop: ${last.name}`);
        workspace.removeDesktop(last);
    }

    workspace.currentDesktop = mainDesktop;
}

function suspendAllMacsimized() {
    log("Suspending all MACsimized windows (multi-screen detected)");

    // Collect window IDs to suspend first (avoid modifying map during iteration)
    var toSuspend = [];
    for (const [windowId, data] of savedData) {
        if (data.macsimized) {
            toSuspend.push(windowId);
        }
    }

    // Build ID lookup map once
    const byId = new Map(workspace.windowList().map(w => [w.internalId, w]));

    for (var i = 0; i < toSuspend.length; i++) {
        var windowId = toSuspend[i];
        var win = byId.get(windowId) || null;

        if (!win) {
            log(`Window ${windowId} not found, cleaning stale state`);
            deleteSavedData(windowId, "macsimized");
            deleteSavedData(windowId, "dedicatedDesktop");
            continue;
        }

        log(`Suspending MACsimized window: ${windowId}`);
        updateSavedData(windowId, { suspended: true });
        restoreDesktop(win);
    }
}

function restoreSuspended() {
    log("Restoring suspended windows (single-screen detected)");

    var toRestore = [];
    for (const [windowId, data] of savedData) {
        if (data.suspended) {
            toRestore.push(windowId);
        }
    }

    // Build ID lookup map once
    const byId = new Map(workspace.windowList().map(w => [w.internalId, w]));

    for (var i = 0; i < toRestore.length; i++) {
        var windowId = toRestore[i];
        var win = byId.get(windowId) || null;

        if (!win) {
            log(`Window ${windowId} not found, cleaning up suspended state`);
            deleteSavedData(windowId, "suspended");
            continue;
        }

        deleteSavedData(windowId, "suspended");
        const data = savedData.get(windowId);

        // Re-MACsimize if still fullscreen or maximized
        if (handleFullscreen && win.fullScreen) {
            log(`Re-MACsimizing fullscreen window: ${windowId}`);
            moveToNewDesktop(win);
        } else if (handleMaximized && (data && data.windowMode === 3 || isWindowMaximized(win))) {
            log(`Re-MACsimizing maximized window: ${windowId}`);
            moveToNewDesktop(win);
        }
    }
}

function scanAndMacsimize() {
    log("Scanning windows for fullscreen/maximized state...");
    var allWindows = workspace.windowList();
    for (var i = 0; i < allWindows.length; i++) {
        var win = allWindows[i];
        if (shouldSkip(win)) continue;
        installWindowHandlers(win);

        var data = savedData.get(win.internalId);
        if (data && data.macsimized) continue; // already handled

        if (handleFullscreen && win.fullScreen) {
            log(`MACsimizing fullscreen window: ${String(win.resourceClass || "")}`);
            moveToNewDesktop(win);
        } else if (handleMaximized && win.maximizable && isWindowMaximized(win)) {
            log(`MACsimizing maximized window: ${String(win.resourceClass || "")}`);
            moveToNewDesktop(win);
        }
    }
}

function onScreensChanged() {
    if (!enableIfOnlyOne) return;

    let numScreens = workspace.screens.length;
    log(`Screens changed. Count: ${numScreens}`);

    if (numScreens > 1) {
        suspendAllMacsimized();
    } else if (numScreens === 1) {
        restoreSuspended();
        // Also pick up any fullscreen/maximized windows that were never
        // MACsimized (e.g. maximized while on multi-screen where it was blocked)
        scanAndMacsimize();
    }
}

function installWindowHandlers(window) {
    log(`Checking window ${String(window.resourceClass || "")} before installing handler`);

    // Check if the window is normal and can be maximized and full-screened.
    if (window !== null &&
        window.normalWindow &&
        !window.skipTaskbar &&
        !window.splash &&
        (window.fullScreenable || window.maximizable)) {

        log(`Window is good: ${String(window.resourceClass || "")}`);
        let windowId = window.internalId;
        const data = savedData.get(windowId);

        // Skipt if the window s already being tracked
        if (data && data.tracked) {
            log(`${windowId} is already being tracked`);
            return;
        }

        log(`Now tracking ${windowId}`);

        // Mark window as tracked
        updateSavedData(windowId, {
            tracked: true
        });

        log(`Installing handles for ${windowId}`);

        // Install handlers for maximized state if enabled
        if (handleMaximized && window.maximizable) {
            window.maximizedAboutToChange.connect(function(mode) {
                log(`${windowId}: maximized changed`);
                maximizedStateChanged(window, mode);
            });
            window.minimizedChanged.connect(function() {
                log(`${windowId}: minimized changed`);
                minimizedStateChanged(window);
            });
        }

        // Install handlers for full-screen state if enabled
        if (handleFullscreen && window.fullScreenable) {
            window.fullScreenChanged.connect(function() {
                log(`${windowId}: full-screem changed`);
                fullScreenChanged(window);
            });
        }

        // Install handlers for window caption chage
        if ((handleFullscreen && window.fullScreenable) || (handleMaximized && window.maximizable)) {
            window.captionChanged.connect(function() {
                log(`${windowId}: caption changed`);
                windowCaptionChanged(window);
            });
        }

        // Restore desktop and purge data for closed windows
        window.closed.connect(function() {
            log(`${windowId}: closed`);
            restoreDesktop(window);
            savedData.delete(windowId);
        });
    }
}

function install() {
    log(`Installing handler for workspace to track activated windows`);
    workspace.windowActivated.connect(window => {
        // Check if window should be skipped (ignored list)
        if (shouldSkip(window)) {
            return;
        }

        installWindowHandlers(window)
    });
    workspace.windowAdded.connect(window => {
        // Check if window should be skipped (ignored list)
        if (shouldSkip(window)) {
            return; // Skipped windows can open anywhere without restrictions
        }

        // Handle transient windows (dialogs, toolbars, etc.) - logic requirement #3
        // Move them to the same desktop as their parent window
        if (window.transient && window.transientFor) {
            let parentWindow = window.transientFor;
            let parentId = parentWindow.internalId;
            log(`Transient window detected. Parent: ${parentId}`);

            // If parent is on a dedicated desktop, move this transient window there too
            const parentData = savedData.get(parentId);
            if (parentData && parentData.macsimized) {
                log(`Moving transient window to parent's desktop`);
                window.desktops = parentWindow.desktops;
                return; // Don't process further for transient windows
            }
        }

        installWindowHandlers(window);
        // Get workspace area for maximized windows
        var area = workspace.clientArea(KWin.MaximizeArea, window);

        // If window is "maximized" move it to a new desktop right away
        if (window.width + 1 >= area.width && window.height + 1 >= area.height && handleMaximized) {
            moveToNewDesktop(window);
        } else {
            // If we're on a non-main desktop and the new window is not maximized,
            // force it to open on the main desktop and switch to main desktop (logic requirement #5)
            let mainDesktop = workspace.desktops[0];

            if (workspace.currentDesktop !== mainDesktop &&
                managedDesktops.includes(workspace.currentDesktop) &&
                !sameClassDesktop(window) &&
                exclusiveDesktops) {
                log(`New non-maximized window opened on non-main desktop. Moving to main desktop and switching.`);
                window.desktops = [mainDesktop];
                workspace.currentDesktop = mainDesktop;
            }
        }
    });

    // Install handler for panel visibility if enabled
    if (enablePanelVisibility) {
        workspace.currentDesktopChanged.connect(togglePanelVisibility)
    }

    // Install handler for screen changes (connect/disconnect monitors)
    workspace.screensChanged.connect(onScreensChanged);

    // Clean up stale virtual desktops from a previous session, then re-scan.
    // This ensures a clean slate: if no fullscreen apps exist, only the main
    // desktop remains. If fullscreen apps exist, fresh dedicated desktops
    // are created for them.
    cleanupStaleDesktops();
    scanAndMacsimize();

    log(`Workspace handler installed`);
}

log(`Initializing...`);
install();
