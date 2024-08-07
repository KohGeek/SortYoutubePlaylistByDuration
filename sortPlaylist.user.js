/**
 *  Changelog 07/08/2024
 *  - Emergency fix for innerHTML violations (untested)
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
// @version           3.0.2
// @description       As the name implies, sorts youtube playlist by duration
// @author            KohGeek
// @license           GPL-2.0-only
// @match             http://*.youtube.com/playlist*
// @match             https://*.youtube.com/playlist*
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
    { value: true, label: 'Sort all' },
    { value: false, label: 'Sort only loaded' }
]

const debug = false;

var scrollLoopTime = 500;

var waitTimeAfterDrag = 1800;

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
 */
let autoScroll = async () => {
    let element = document.scrollingElement;
    let currentScroll = element.scrollTop;
    do {
        currentScroll = element.scrollTop;
        element.scrollTop = element.scrollHeight;
        await new Promise((r) => setTimeout(r, scrollLoopTime));
    } while (currentScroll != element.scrollTop);
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

    document.querySelector('div.thumbnail-and-metadata-wrapper').append(element)
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
            autoScrollInitialVideoList = e.target.value;
        }
    };

    // Create options
    options.forEach((option) => {
        const optionElement = document.createElement('option')
        optionElement.value = option.value
        optionElement.innerText = option.label
        element.appendChild(optionElement)
    });

    // Render select
    document.querySelector('.sort-playlist-select').appendChild(element);
};

/**
 * Generate number element
 * @param {number} variable
 * @param {number} defaultValue
 * @param {string=} label
 */
let renderNumberElement = (variable = 0, defaultValue = 0, label = '') => {
    // Create div
    const elementDiv = document.createElement('div');
    elementDiv.className = 'sort-playlist-div sort-margin-right-3px';
    elementDiv.innerText = label;

    // Create input
    const element = document.createElement('input');
    element.type = 'number';
    element.value = defaultValue;
    element.className = 'style-scope';
    element.oninput = (e) => {
        if (variable === 0) {
            scrollLoopTime = +(e.target.value);
        } else if (variable === 1) {
            waitTimeAfterDrag = +(e.target.value);
        }
    };

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
    const element = document.createElement('style');
    element.textContent = css;
    document.head.appendChild(element);
};

/**
 * Sort videos by time
 * @param {Element[]} allAnchors - Array of anchors
 * @param {Element[]} allDragPoints - Array of draggable elements
 * @return {number} - Number of videos sorted
 */
let sortVideos = (allAnchors, allDragPoints) => {
    let videos = [];
    let sorted = 0;
    let dragged = false;

    // Sometimes after dragging, the page is not fully loaded yet
    // This can be seen by the number of anchors not being a multiple of 100
    if (allAnchors.length % 100 !== 0 && document.querySelector(".ytd-continuation-item-renderer") !== null) {
        logActivity("Playlist is not fully loaded, waiting...");
        return 0;
    }

    for (let j = 0; j < allAnchors.length; j++) {
        let thumb = allAnchors[j];
        let drag = allDragPoints[j];

        let timeSpan = thumb.querySelector("#text");
        let timeDigits = timeSpan.innerText.trim().split(":").reverse();
        let time;
        if (timeDigits.length == 1) {
            sortMode == "asc" ? time = 999999999999999999 : time = -1;
        } else {
            time = parseInt(timeDigits[0]);
            if (timeDigits[1]) time += parseInt(timeDigits[1]) * 60;
            if (timeDigits[2]) time += parseInt(timeDigits[2]) * 3600;
        }
        videos.push({ anchor: drag, time: time, originalIndex: j });
    }

    if (sortMode == "asc") {
        videos.sort((a, b) => a.time - b.time);
    } else {
        videos.sort((a, b) => b.time - a.time);
    }

    for (let j = 0; j < videos.length; j++) {
        let originalIndex = videos[j].originalIndex;

        if (debug) {
            console.log("Loaded: " + videos.length + ". Current: " + j + ". Original: " + originalIndex + ".");
        }

        if (originalIndex !== j) {
            let elemDrag = videos[j].anchor;
            let elemDrop = videos.find((v) => v.originalIndex === j).anchor;

            logActivity("Drag " + originalIndex + " to " + j);
            simulateDrag(elemDrag, elemDrop);
            dragged = true;
        }

        sorted = j;
        if (stopSort || dragged) {
            break;
        }
    }

    return sorted;
};

/**
 * There is an inherent limit in how fast you can sort the videos, due to Youtube refreshing
 * This limit also applies if you do it manually
 * It is also much worse if you have a lot of videos, for every 100 videos, it's about an extra 2-4 seconds, maybe longer
 */
let activateSort = async () => {
    let allAnchors = document.querySelectorAll("ytd-item-section-renderer:first-of-type div#content a#thumbnail.inline-block.ytd-thumbnail");
    let allDragPoints;

    let sortedCount = 0;
    let initialVideoCount = allAnchors.length;
    stopSort = false;

    while (document.querySelector(".ytd-continuation-item-renderer") !== null
        && document.URL.includes("playlist?list=")
        && stopSort === false
        && autoScrollInitialVideoList === true) {
        logActivity("Loading more videos - " + allAnchors.length + " videos loaded");

        if (allAnchors.length > 300) {
            logActivity(log.innerText + "\nNumber of videos loaded is high, sorting may take a long time");
        } else if (allAnchors.length > 600) {
            logActivity(log.innerText + "\nSorting may take extremely long time/is likely to bug out");
        }

        await autoScroll();

        allAnchors = document.querySelectorAll("ytd-item-section-renderer:first-of-type div#content a#thumbnail.inline-block.ytd-thumbnail");
        initialVideoCount = allAnchors.length;
    }

    logActivity(initialVideoCount + " videos loaded.");

    while (sortedCount < initialVideoCount && stopSort === false) {
        allAnchors = document.querySelectorAll("ytd-item-section-renderer:first-of-type div#content a#thumbnail.inline-block.ytd-thumbnail");
        allDragPoints = document.querySelectorAll("ytd-item-section-renderer:first-of-type yt-icon#reorder");

        let anchorListLength = allAnchors.length;
        if (!allAnchors[anchorListLength - 1].querySelector("#text")) {
            logActivity("Video " + anchorListLength + " is not loaded yet, waiting " + waitTimeAfterDrag + "ms");
            await new Promise((r) => setTimeout(r, waitTimeAfterDrag));
            continue;
        }

        sortedCount = sortVideos(allAnchors, allDragPoints) + 1;
        await new Promise((r) => setTimeout(r, waitTimeAfterDrag));
    }

    if (stopSort === true) {
        logActivity("Sort cancelled");
        stopSort = false;
    } else {
        logActivity("Sort complete. Video sorted: " + sortedCount);
    }
};

/**
 * Initialise script - IIFE
 */
(() => {
    onElementReady('div.thumbnail-and-metadata-wrapper', false, () => {
        renderContainerElement();
        addCssStyle();
        renderButtonElement(activateSort, 'Sort Videos', false);
        renderButtonElement(() => { stopSort = true }, 'Stop Sort', true);
        renderSelectElement(0, modeAvailable, 'Sort Mode');
        renderSelectElement(1, autoScrollOptions, 'Auto Scroll');
        renderNumberElement(1, 1800, 'Wait Time After Drag (ms)');
        renderLogElement();
    });
})();
