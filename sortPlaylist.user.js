/**
 *  Changelog 09/03/2026
 *  - Improve playlist sorting performance by placing videos directly into target slots
 *  - Fix auto-scroll select handling by parsing boolean values correctly
 *  - Add safer guards for partially loaded or non-standard playlist entries
 *  - Track videos by stable identifiers across Youtube rerenders during drag operations
 *  - Preserve script structure to keep diffs readable
 *
 *  Changelog 08/08/2024
 *  - Attempt to address the most serious of buggy code, script should now work in all but the longest playlist.
 *
 *  Changelog 07/08/2024
 *  - Emergency fix for innerHTML violations
 *  - Script is now loaded at any YT page - allowing the script to load whenever user hot-navigates to a playlist page without reloading
 *
 *  Changelog 24/12/2023
 *  - Fixed an issue where recommended videos at the end of the list breaks sorting (due to the lack of reorder anchors)
 *  - Attempted fix for "Upcoming" or any other non-timestamped based videos, sorting to bottom (operating on principle that split(':') will produce at least 2 elements on timestamps)
 *  - Renaming the script to more accurately reflects its capability
 *  - Change license to fit SPDX license list
 *  - Minor code cleanups
 *
 *  Changelog 11/02/2023
 *  - Migrated to a full proper repo to better support discussions, issues and pull requests
 */

/* jshint esversion: 8 */
// ==UserScript==
// @name              Sort Youtube Playlist by Duration
// @namespace         https://github.com/KohGeek/SortYoutubePlaylistByDuration
// @version           3.2.0
// @description       As the name implies, sorts youtube playlist by duration
// @author            KohGeek
// @license           GPL-2.0-only
// @match             http://*.youtube.com/*
// @match             https://*.youtube.com/*
// @require           https://greasyfork.org/scripts/374849-library-onelementready-es7/code/Library%20%7C%20onElementReady%20ES7.js
// @supportURL        https://github.com/KohGeek/SortYoutubePlaylistByDuration/
// @grant             none
// @run-at            document-start
// ==/UserScript==

/**
 * Variables and constants
 */
const css =
    `
        .sort-playlist-div {
            font-size: 12px;
            padding: 3px 1px;
        }
        .sort-button-wl {
            border: 1px #a0a0a0;
            border-radius: 2px;
            padding: 3px;
            cursor: pointer;
        }
        .sort-button-wl-default {
            background-color: #30d030;
        }
        .sort-button-wl-stop {
            background-color: #d03030;
        }
        .sort-button-wl-default:active {
            background-color: #209020;
        }
        .sort-button-wl-stop:active {
            background-color: #902020;
        }
        .sort-log {
            padding: 3px;
            margin-top: 3px;
            border-radius: 2px;
            background-color: #202020;
            color: #e0e0e0;
            white-space: pre-wrap;
        }
        .sort-margin-right-3px {
            margin-right: 3px;
        }
    `

const modeAvailable = [
    { value: 'asc', label: 'Shortest First' },
    { value: 'desc', label: 'Longest First' }
];

const autoScrollOptions = [
    { value: 'true', label: 'Sort all' },
    { value: 'false', label: 'Sort only loaded' }
]

const debug = false;

var scrollLoopTime = 600;

let sortMode = 'asc';

let autoScrollInitialVideoList = true;

let log = document.createElement('div');

let stopSort = false;

/**
 * Fire a mouse event on an element
 * @param {string=} type
 * @param {Element} elem
 * @param {number} centerX
 * @param {number} centerY
 */
let fireMouseEvent = (type, elem, centerX, centerY) => {
    const event = new MouseEvent(type, {
        view: window,
        bubbles: true,
        cancelable: true,
        clientX: centerX,
        clientY: centerY
    });

    elem.dispatchEvent(event);
};

/**
 * Simulate drag and drop
 * @see: https://ghostinspector.com/blog/simulate-drag-and-drop-javascript-casperjs/
 * @param {Element} elemDrag - Element to drag
 * @param {Element} elemDrop - Element to drop
 */
let simulateDrag = (elemDrag, elemDrop) => {
    // calculate positions
    let pos = elemDrag.getBoundingClientRect();
    let center1X = Math.floor((pos.left + pos.right) / 2);
    let center1Y = Math.floor((pos.top + pos.bottom) / 2);
    pos = elemDrop.getBoundingClientRect();
    let center2X = Math.floor((pos.left + pos.right) / 2);
    let center2Y = Math.floor((pos.top + pos.bottom) / 2);

    // mouse over dragged element and mousedown
    fireMouseEvent("mousemove", elemDrag, center1X, center1Y);
    fireMouseEvent("mouseenter", elemDrag, center1X, center1Y);
    fireMouseEvent("mouseover", elemDrag, center1X, center1Y);
    fireMouseEvent("mousedown", elemDrag, center1X, center1Y);

    // start dragging process over to drop target
    fireMouseEvent("dragstart", elemDrag, center1X, center1Y);
    fireMouseEvent("drag", elemDrag, center1X, center1Y);
    fireMouseEvent("mousemove", elemDrag, center1X, center1Y);
    fireMouseEvent("drag", elemDrag, center2X, center2Y);
    fireMouseEvent("mousemove", elemDrop, center2X, center2Y);

    // trigger dragging process on top of drop target
    fireMouseEvent("mouseenter", elemDrop, center2X, center2Y);
    fireMouseEvent("dragenter", elemDrop, center2X, center2Y);
    fireMouseEvent("mouseover", elemDrop, center2X, center2Y);
    fireMouseEvent("dragover", elemDrop, center2X, center2Y);

    // release dragged element on top of drop target
    fireMouseEvent("drop", elemDrop, center2X, center2Y);
    fireMouseEvent("dragend", elemDrag, center2X, center2Y);
    fireMouseEvent("mouseup", elemDrag, center2X, center2Y);
};

/**
 * Scroll automatically to the bottom of the page
 * @param {number} lastScrollLocation - Last known location for scrollTop
 */
let autoScroll = async (scrollTop = null) => {
    let element = document.scrollingElement;
    let currentScroll = element.scrollTop;
    let scrollDestination = scrollTop !== null ? scrollTop : element.scrollHeight;
    let scrollCount = 0;
    do {
        currentScroll = element.scrollTop;
        element.scrollTop = scrollDestination;
        await new Promise(r => setTimeout(r, scrollLoopTime));
        scrollCount++;
    } while (currentScroll != scrollDestination && scrollCount < 2 && stopSort === false);
};

/**
 * Log activities
 * @param {string=} message
 */
let logActivity = (message) => {
    log.innerText = message;
    if (debug) {
        console.log(message);
    }
};

/**
 * Generate menu container element
 */
let renderContainerElement = () => {
    if (document.querySelector('.sort-playlist')) {
        return;
    }

    const mountPoint = document.querySelector('div.thumbnail-and-metadata-wrapper')
        || document.querySelector('ytd-playlist-sidebar-primary-info-renderer')
        || document.querySelector('#playlist-header-renderer #container');

    if (!mountPoint) {
        return;
    }

    const element = document.createElement('div')
    element.className = 'sort-playlist sort-playlist-div'
    element.style.paddingBottom = '16px'

    // Add buttonChild container
    const buttonChild = document.createElement('div')
    buttonChild.className = 'sort-playlist-div sort-playlist-button'
    element.appendChild(buttonChild)

    // Add selectChild container
    const selectChild = document.createElement('div')
    selectChild.className = 'sort-playlist-div sort-playlist-select'
    element.appendChild(selectChild)

    mountPoint.append(element)
}

/**
 * Generate button element
 * @param {function} click - OnClick handler
 * @param {string=} label - Button Label
 */
let renderButtonElement = (click = () => { }, label = '', red = false) => {
    // Create button
    const element = document.createElement('button')
    if (red) {
        element.className = 'style-scope sort-button-wl sort-button-wl-stop sort-margin-right-3px'
    } else {
        element.className = 'style-scope sort-button-wl sort-button-wl-default sort-margin-right-3px'
    }
    element.innerText = label
    element.onclick = click

    // Render button
    document.querySelector('.sort-playlist-button').appendChild(element)
};

/**
 * Generate select element
 * @param {number} variable - Variable to update
 * @param {Object[]} options - Options to render
 * @param {string=} label - Select Label
 */
let renderSelectElement = (variable = 0, options = [], label = '') => {
    // Create select
    const element = document.createElement('select');
    element.className = 'style-scope sort-margin-right-3px';
    element.onchange = (e) => {
        if (variable === 0) {
            sortMode = e.target.value;
        } else if (variable === 1) {
            autoScrollInitialVideoList = e.target.value === 'true';
        }
    };

    // Create options
    options.forEach((option) => {
        const optionElement = document.createElement('option')
        optionElement.value = option.value
        optionElement.innerText = option.label
        element.appendChild(optionElement)
    });

    if (variable === 0) {
        element.value = sortMode;
    } else if (variable === 1) {
        element.value = String(autoScrollInitialVideoList);
    }

    // Render select
    document.querySelector('.sort-playlist-select').appendChild(element);
};

/**
 * Generate number element
 * @param {number} variable
 * @param {number} defaultValue
 */
let renderNumberElement = (defaultValue = 0, label = '') => {
    // Create div
    const elementDiv = document.createElement('div');
    elementDiv.className = 'sort-playlist-div sort-margin-right-3px';
    elementDiv.innerText = label;

    // Create input
    const element = document.createElement('input');
    element.type = 'number';
    element.value = defaultValue;
    element.className = 'style-scope';
    element.oninput = (e) => { scrollLoopTime = +(e.target.value) };

    // Render input
    elementDiv.appendChild(element);
    document.querySelector('div.sort-playlist').appendChild(elementDiv);
};

/**
 * Generate log element
 */
let renderLogElement = () => {
    // Populate div
    log.className = 'style-scope sort-log';
    log.innerText = 'Logging...';

    // Render input
    document.querySelector('div.sort-playlist').appendChild(log);
};

/**
 * Add CSS styling
 */
let addCssStyle = () => {
    if (document.querySelector('style[data-sort-playlist-style="true"]')) {
        return;
    }

    const element = document.createElement('style');
    element.setAttribute('data-sort-playlist-style', 'true');
    element.textContent = css;
    document.head.appendChild(element);
};

/**
 * Parse a timestamp string to seconds.
 * Supported formats:
 * - mm:ss
 * - hh:mm:ss
 *
 * Returns null for items that are not standard timestamped videos.
 *
 * @param {string} raw
 * @return {?number}
 */
let parseDurationToSeconds = (raw) => {
    if (!raw) {
        return null;
    }

    let text = raw.trim();
    if (!/^\d+(?::\d+){1,2}$/.test(text)) {
        return null;
    }

    let timeDigits = text.split(":").map(Number).reverse();
    let time = 0;

    if (Number.isFinite(timeDigits[0])) time += timeDigits[0];
    if (Number.isFinite(timeDigits[1])) time += timeDigits[1] * 60;
    if (Number.isFinite(timeDigits[2])) time += timeDigits[2] * 3600;

    return time;
};

/**
 * Obtain a stable identifier for a playlist video where possible.
 * This allows the script to continue tracking a specific item after
 * Youtube rerenders the playlist DOM following a drag operation.
 *
 * @param {Element} thumb
 * @param {number} fallbackIndex
 * @return {string}
 */
let getVideoIdFromThumbnail = (thumb, fallbackIndex) => {
    let fallback = `index-${fallbackIndex}`;

    try {
        let href = thumb?.getAttribute("href") || "";
        if (!href) {
            return fallback;
        }

        let url = new URL(href, location.origin);
        return url.searchParams.get("v") || href || fallback;
    } catch {
        return thumb?.getAttribute("href") || fallback;
    }
};

/**
 * Build a normalized representation of all currently loaded playlist videos.
 *
 * Each returned entry contains:
 * - row: playlist row element
 * - anchor: drag handle used by simulateDrag
 * - time: duration in seconds, or a sentinel value for special entries
 * - originalIndex: current DOM index
 * - videoId: stable identifier used across rerenders
 *
 * @return {Object[]}
 */
let getLoadedVideos = () => {
    let rows = Array.from(document.querySelectorAll("ytd-playlist-video-renderer"));
    let videos = [];

    for (let j = 0; j < rows.length; j++) {
        let row = rows[j];

        let drag = row.querySelector("yt-icon#reorder")
            || row.querySelector("#reorder");

        let thumb = row.querySelector("a#thumbnail")
            || row.querySelector("a.ytd-thumbnail");

        if (!drag || !thumb) {
            continue;
        }

        let timeSpan = thumb.querySelector("#text")
            || row.querySelector("ytd-thumbnail-overlay-time-status-renderer #text");

        let parsedTime = parseDurationToSeconds(timeSpan ? timeSpan.innerText : "");
        let time;

        if (parsedTime === null) {
            sortMode == "asc" ? time = Number.MAX_SAFE_INTEGER : time = -1;
        } else {
            time = parsedTime;
        }

        videos.push({
            row: row,
            anchor: drag,
            time: time,
            originalIndex: j,
            videoId: getVideoIdFromThumbnail(thumb, j)
        });
    }

    return videos;
};

/**
 * Build the target order from a set of loaded videos.
 * Ties are broken by original DOM order so the sort remains stable.
 *
 * @param {Object[]} videos
 * @return {Object[]}
 */
let buildDesiredOrder = (videos) => {
    let desiredOrder = [...videos];

    if (sortMode == "asc") {
        desiredOrder.sort((a, b) => {
            let primary = a.time - b.time;
            return primary !== 0 ? primary : a.originalIndex - b.originalIndex;
        });
    } else {
        desiredOrder.sort((a, b) => {
            let primary = b.time - a.time;
            return primary !== 0 ? primary : a.originalIndex - b.originalIndex;
        });
    }

    return desiredOrder;
};

/**
 * Read the reported video count from the playlist metadata area.
 *
 * @return {number}
 */
let getReportedVideoCount = () => {
    let element = document.querySelector(".metadata-stats span.yt-formatted-string:first-of-type")
        || document.querySelector("ytd-playlist-sidebar-primary-info-renderer .metadata-stats span")
        || document.querySelector("#stats yt-formatted-string:first-child");

    if (!element || !element.innerText) {
        return 0;
    }

    let match = element.innerText.replace(/,/g, "").match(/\d+/);
    return match ? Number(match[0]) : 0;
};

/**
 * Sort videos by time
 * @param {Element[]} allAnchors - Array of anchors
 * @param {Element[]} allDragPoints - Array of draggable elements
 * @param {number} expectedCount - Expected length for video list
 * @return {number} sorted - Number of videos sorted
 */
let sortVideos = async (allAnchors, allDragPoints, expectedCount) => {
    let initialVideos = getLoadedVideos();
    let sorted = 0;

    // Sometimes after dragging, the page is not fully loaded yet
    // This can be seen by the number of anchors not being a multiple of 100
    if (initialVideos.length !== expectedCount) {
        logActivity("Playlist is not fully loaded, waiting...");
        return 0;
    }

    /**
     * Build the desired order once for the currently loaded set of videos,
     * then walk through each target slot from top to bottom.
     *
     * For each slot:
     * - if the correct video is already present, continue
     * - otherwise locate the required video in the current DOM
     * - drag it into the target position
     * - wait for Youtube to rerender before reading the DOM again
     *
     * This ensures that each drag operation places a specific video into
     * its intended final position within the loaded set.
     */
    let desiredOrder = buildDesiredOrder(initialVideos);

    for (let j = 0; j < desiredOrder.length; j++) {
        let currentVideos = getLoadedVideos();

        if (currentVideos.length !== expectedCount) {
            logActivity("Playlist changed while sorting, retrying...");
            break;
        }

        let desiredVideoId = desiredOrder[j].videoId;
        let currentAtTarget = currentVideos[j];

        if (!currentAtTarget) {
            logActivity("Target slot missing, retrying...");
            break;
        }

        if (currentAtTarget.videoId === desiredVideoId) {
            sorted = j + 1;
            if (debug) {
                console.log("Position " + j + " already correct.");
            }
            continue;
        }

        let sourceIndex = currentVideos.findIndex((v) => v.videoId === desiredVideoId);

        if (sourceIndex === -1) {
            logActivity("Could not find target video in current DOM, retrying...");
            break;
        }

        let elemDrag = currentVideos[sourceIndex].anchor;
        let elemDrop = currentVideos[j].anchor;

        if (debug) {
            console.log("Loaded: " + currentVideos.length + ". Current target: " + j + ". Source: " + sourceIndex + ".");
        }

        logActivity("Drag " + sourceIndex + " to " + j);
        simulateDrag(elemDrag, elemDrop);

        sorted = j + 1;

        if (stopSort) {
            break;
        }

        // Wait for Youtube to settle after each drag before reading DOM again.
        await new Promise(r => setTimeout(r, scrollLoopTime * 4));
    }

    return sorted;
}

/**
 * There is an inherent limit in how fast you can sort the videos, due to Youtube refreshing
 * This limit also applies if you do it manually
 * It is also much worse if you have a lot of videos, for every 100 videos, it's about an extra 2-4 seconds, maybe longer
 */
let activateSort = async () => {
    let reportedVideoCount = getReportedVideoCount();
    let allDragPoints = document.querySelectorAll("ytd-item-section-renderer:first-of-type yt-icon#reorder");
    let allAnchors;

    let sortedCount = 0;
    let initialVideoCount = getLoadedVideos().length;
    let scrollRetryCount = 0;
    let attemptCount = 0;
    let maxAttempts;
    stopSort = false;

    while (reportedVideoCount !== 0
        && reportedVideoCount !== initialVideoCount
        && document.URL.includes("playlist?list=")
        && stopSort === false
        && autoScrollInitialVideoList === true) {
        logActivity("Loading more videos - " + initialVideoCount + " videos loaded");
        if (scrollRetryCount > 5) {
            break;
        } else if (scrollRetryCount > 0) {
            logActivity(log.innerText + "\nReported video count does not match actual video count.\nPlease make sure you remove all unavailable videos.\nAttempt: " + scrollRetryCount + "/5")
        }

        if (initialVideoCount > 300) {
            logActivity(log.innerText + "\nNumber of videos loaded is high, sorting may take a long time");
        } else if (initialVideoCount > 600) {
            logActivity(log.innerText + "\nSorting may take extremely long time/is likely to bug out");
        }

        await autoScroll();

        allDragPoints = document.querySelectorAll("ytd-item-section-renderer:first-of-type yt-icon#reorder");
        initialVideoCount = getLoadedVideos().length;
        reportedVideoCount = getReportedVideoCount() || reportedVideoCount;

        if (((reportedVideoCount - initialVideoCount) / 10) < 1) {
            // Here, we already waited for the scrolling so things should already be loaded.
            // However, due to either unavailable video, or other discrepancy, the count do not match.
            // We increment until it's time to break the loop.
            scrollRetryCount++;
        } else {
            scrollRetryCount = 0;
        }
    }

    logActivity(initialVideoCount + " videos loaded.");
    if (scrollRetryCount > 5) logActivity(log.innerText + "\nScroll attempt exhausted. Proceeding with sort despite video count mismatch.");

    /**
     * Run sorting passes until the loaded set is sorted, sorting is cancelled,
     * or retry attempts are exhausted.
     *
     * A pass may stop early if Youtube rerenders or changes the loaded DOM
     * while items are being moved. In that case the script waits briefly,
     * reads the playlist again, and continues from the current state.
     */
    maxAttempts = initialVideoCount + 10;

    while (sortedCount < initialVideoCount && stopSort === false && attemptCount < maxAttempts) {
        allDragPoints = document.querySelectorAll("ytd-item-section-renderer:first-of-type yt-icon#reorder");
        allAnchors = document.querySelectorAll("ytd-item-section-renderer:first-of-type div#content a#thumbnail.inline-block.ytd-thumbnail");
        attemptCount++;

        // Recalculate count from normalized row parser in case recommended/special entries exist.
        initialVideoCount = getLoadedVideos().length;

        if (initialVideoCount === 0) {
            logActivity("No sortable videos found.");
            break;
        }

        sortedCount = Number(await sortVideos(allAnchors, allDragPoints, initialVideoCount));

        if (sortedCount < initialVideoCount && stopSort === false) {
            logActivity("Progress interrupted at " + sortedCount + "/" + initialVideoCount + ". Retrying...");
            await new Promise(r => setTimeout(r, scrollLoopTime * 2));
        }
    }

    if (stopSort === true) {
        logActivity("Sort cancelled.");
        stopSort = false;
    } else if (sortedCount >= initialVideoCount) {
        logActivity("Sort complete. Video sorted: " + sortedCount);
    } else {
        logActivity("Sort stopped before full completion. Final progress: " + sortedCount + "/" + initialVideoCount);
    }
};

/**
 * Initialisation wrapper for all on-screen elements.
 */
let init = () => {
    onElementReady('div.thumbnail-and-metadata-wrapper, ytd-playlist-sidebar-primary-info-renderer, ytd-playlist-video-renderer', false, () => {
        if (document.querySelector('.sort-playlist')) {
            return;
        }

        renderContainerElement();
        addCssStyle();
        renderButtonElement(async () => { await activateSort() }, 'Sort Videos', false);
        renderButtonElement(() => { stopSort = true }, 'Stop Sort', true);
        renderSelectElement(0, modeAvailable, 'Sort Mode');
        renderSelectElement(1, autoScrollOptions, 'Auto Scroll');
        renderNumberElement(600, 'Scroll Retry Time (ms)');
        renderLogElement();
    });
};

/**
 * Initialise script - IIFE
 */
(() => {
    init();

    if (window.navigation && typeof navigation.addEventListener === "function") {
        navigation.addEventListener('navigate', navigateEvent => {
            const url = new URL(navigateEvent.destination.url);
            if (url.pathname.includes('playlist') || url.search.includes('list=')) {
                setTimeout(() => init(), 300);
            }
        });
    } else {
        let lastUrl = location.href;
        setInterval(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                if (location.href.includes('playlist?list=') || location.href.includes('&list=')) {
                    init();
                }
            }
        }, 1000);
    }
})();